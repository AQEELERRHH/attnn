import { NextRequest, NextResponse } from "next/server";
import { stableUuid } from "@/lib/bid-rules";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { parseRequestId, rejectedByCircle, transferUSDC } from "@/lib/circle";
import {
  AllowanceExceeded,
  WithdrawalError,
  approveWithCode,
  codeSubject,
  markWithdrawal,
  notifyAccount,
  requestSecurityCode,
  reserveWithdrawal,
} from "@/lib/withdrawals";
import { getUsdcBalance } from "@/lib/activation";
import { formatUsd } from "@/lib/bid-rules";
import { dollarsToAtomic } from "@/lib/format";
import { AGENT_WALLET_GAS_RESERVE, agentWallet, ensureAgentWallet, mainWallet } from "@/lib/wallets";
import { READ_BALANCE_MAX, READ_FUNDING_OPTIONS, agentReadsEnabled, gatewayBalance } from "@/lib/gateway";
import { inngest } from "@/lib/inngest";

/**
 * The bidder agent's separate wallet. Only the signed-in user can call this; the
 * agent itself never moves money between wallets.
 *
 *   { action: "create" }                  → create the agent wallet (idempotent)
 *   { action: "fund", amount: "25.00" }   → main wallet → agent wallet. Counts against the
 *                                            shared $500 / 24 h allowance (D4); above it the
 *                                            route emails a code (202 { needsCode }) and goes
 *                                            ahead when called again with { code }.
 *   { action: "withdraw", amount }        → agent wallet → main wallet
 *   { action: "fund_reads", amount }      → agent wallet → its x402 read balance in Circle
 *                                            Gateway ($0.10, $0.50 or $1.00; at most $2 held),
 *                                            which the agent spends at $0.001 per profile read
 *
 * Transfers return as soon as Circle accepts them; balances (read from Arc)
 * update a few seconds later.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.walletAgent, session.user.id));
  if (blocked) return blocked;
  const userId = session.user.id;

  const body = (await req.json().catch(() => null)) as { action?: unknown; amount?: unknown; requestId?: unknown; code?: unknown } | null;
  const action = body?.action;

  try {
    if (action === "create") {
      const wallet = await ensureAgentWallet(userId);
      return NextResponse.json({ success: true, address: wallet.address });
    }

    if (action === "fund_reads") return await fundReads(userId, body?.amount, body?.requestId);

    if (action !== "fund" && action !== "withdraw") {
      return NextResponse.json({ error: 'action must be "create", "fund", "withdraw" or "fund_reads"' }, { status: 400 });
    }
    const amount = dollarsToAtomic(String(body?.amount ?? ""));
    if (amount === null || amount <= BigInt(0)) return NextResponse.json({ error: "Enter an amount like 25" }, { status: 400 });
    const requestId = parseRequestId(body?.requestId);
    if (!requestId) return NextResponse.json({ error: "Missing request id. Please reload the page and try again." }, { status: 400 });

    const [main, agent] = await Promise.all([mainWallet(userId), agentWallet(userId)]);
    if (!main) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    if (!agent) return NextResponse.json({ error: "Create the agent wallet first" }, { status: 404 });

    const from = action === "fund" ? main : agent;
    const to = action === "fund" ? agent : main;

    // Clear errors before Circle: the sending wallet also pays the network fee in USDC.
    const balance = await getUsdcBalance(from.address).catch(() => null);
    if (balance !== null && amount + AGENT_WALLET_GAS_RESERVE > balance) {
      const max = balance > AGENT_WALLET_GAS_RESERVE ? balance - AGENT_WALLET_GAS_RESERVE : BigInt(0);
      return NextResponse.json(
        {
          error: `Not enough USDC in your ${action === "fund" ? "wallet" : "agent wallet"}. You can move up to ${formatUsd(max)} (a little stays behind for the network fee).`,
          max: max.toString(),
        },
        { status: 400 },
      );
    }

    // Same request id → same transfer: a double click or retry never moves the money twice.
    const opKey = `move:${stableUuid(`${userId}:${requestId}`)}`;
    if (action === "withdraw") {
      // Agent → main stays within the user's own control: not part of the allowance.
      const tx = await transferUSDC(from.circleWalletId, to.address, amount.toString(), opKey);
      return NextResponse.json({ success: true, txId: tx.txId, amount: amount.toString() }, { status: 202 });
    }

    // Main → agent: the agent can bid it away, so it counts against the shared allowance.
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const subject = codeSubject.agentFund(amount);
    let reserved;
    try {
      // A retry of the same request finds its row before the code is looked at; a new
      // one uses the code only if it's over the allowance.
      reserved = await reserveWithdrawal({
        userId,
        kind: "agent_fund",
        requestKey: opKey,
        to: to.address,
        amount,
        approve: code ? approveWithCode(userId, subject, code, amount) : undefined,
      });
    } catch (err) {
      if (!(err instanceof AllowanceExceeded)) throw err;
      const blockedCode = await limitOrNull(LIMITS.withdrawalCode, userId);
      if (blockedCode) return blockedCode;
      const { sentTo } = await requestSecurityCode(userId, subject, `approve moving ${formatUsd(amount)} USDC into your agent's wallet (over your 24-hour allowance)`);
      return NextResponse.json({ needsCode: true, sentTo, error: err.message }, { status: 202 });
    }
    const { row, retry } = reserved;
    if (retry && row.status === "failed") {
      return NextResponse.json({ error: "That move didn't go through and nothing moved. Please start it again.", restart: true }, { status: 409 });
    }
    try {
      const tx = await transferUSDC(from.circleWalletId, to.address, amount.toString(), opKey);
      if (await markWithdrawal(row.id, { circleTxId: tx.txId })) {
        await notifyAccount(userId, `You moved ${formatUsd(amount)} USDC to your Attnn. agent`, [
          `${formatUsd(amount)} USDC is moving from your main wallet to your bidder agent's wallet, where the agent can bid with it.`,
        ]);
      }
      return NextResponse.json({ success: true, txId: tx.txId, amount: amount.toString() }, { status: 202 });
    } catch (err) {
      if (!retry && rejectedByCircle(err)) await markWithdrawal(row.id, { failed: true });
      throw err;
    }
  } catch (err) {
    if (err instanceof WithdrawalError) return NextResponse.json({ error: err.message }, { status: err.status });
    return serverError("wallet/agent", err, "We couldn't confirm the transfer. Check your balances before trying again.");
  }
}

/**
 * Agent wallet → its Gateway read balance. The USDC stays the user's (it pays only for
 * profile reads), so like agent → main it isn't part of the D4 allowance; the amounts are
 * fixed and small, and the balance is capped at READ_BALANCE_MAX.
 */
async function fundReads(userId: string, rawAmount: unknown, rawRequestId: unknown) {
  if (!agentReadsEnabled()) return NextResponse.json({ error: "Paid profile reads aren't switched on" }, { status: 400 });
  const amount = dollarsToAtomic(String(rawAmount ?? ""));
  if (amount === null || !READ_FUNDING_OPTIONS.some((o) => o === amount)) {
    return NextResponse.json({ error: `Choose ${READ_FUNDING_OPTIONS.map((o) => formatUsd(o)).join(", ")}` }, { status: 400 });
  }
  const requestId = parseRequestId(rawRequestId);
  if (!requestId) return NextResponse.json({ error: "Missing request id. Please reload the page and try again." }, { status: 400 });

  const agent = await agentWallet(userId);
  if (!agent) return NextResponse.json({ error: "Create the agent wallet first" }, { status: 404 });

  const [balance, readBalance] = await Promise.all([getUsdcBalance(agent.address), gatewayBalance(agent.address)]);
  // Two transactions (approve + deposit), each paying a small network fee in USDC.
  if (amount + AGENT_WALLET_GAS_RESERVE * BigInt(2) > balance) {
    return NextResponse.json({ error: "Not enough USDC in your agent wallet. Move some in first (a little stays behind for network fees)." }, { status: 400 });
  }
  if (readBalance + amount > READ_BALANCE_MAX) {
    return NextResponse.json(
      { error: `Your read balance is ${formatUsd(readBalance)}; it can hold up to ${formatUsd(READ_BALANCE_MAX)}.` },
      { status: 400 },
    );
  }

  // Same request id → same op keys and the same event: a retry never deposits twice.
  const opKey = `reads:${stableUuid(`${userId}:${requestId}`)}`;
  await inngest.send({ id: opKey, name: "attnn/agent.reads-fund", data: { userId, amount: amount.toString(), opKey } });
  return NextResponse.json({ success: true, amount: amount.toString() }, { status: 202 });
}
