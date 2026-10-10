import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { transferUSDC } from "@/lib/circle";
import { getUsdcBalance } from "@/lib/activation";
import { formatUsd } from "@/lib/bid-rules";
import { dollarsToAtomic } from "@/lib/format";
import { AGENT_WALLET_GAS_RESERVE, agentWallet, ensureAgentWallet, mainWallet } from "@/lib/wallets";

/**
 * The bidder agent's separate wallet. Only the signed-in user can call this; the
 * agent itself never moves money between wallets.
 *
 *   { action: "create" }                  → create the agent wallet (idempotent)
 *   { action: "fund", amount: "25.00" }   → main wallet → agent wallet
 *   { action: "withdraw", amount }        → agent wallet → main wallet
 *
 * Transfers return as soon as Circle accepts them; balances (read from Arc)
 * update a few seconds later.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = (await req.json().catch(() => null)) as { action?: unknown; amount?: unknown } | null;
  const action = body?.action;

  try {
    if (action === "create") {
      const wallet = await ensureAgentWallet(userId);
      return NextResponse.json({ success: true, address: wallet.address });
    }

    if (action !== "fund" && action !== "withdraw") {
      return NextResponse.json({ error: 'action must be "create", "fund" or "withdraw"' }, { status: 400 });
    }
    const amount = dollarsToAtomic(String(body?.amount ?? ""));
    if (amount === null || amount <= BigInt(0)) return NextResponse.json({ error: "Enter an amount like 25" }, { status: 400 });

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

    const tx = await transferUSDC(from.circleWalletId, to.address, amount.toString());
    return NextResponse.json({ success: true, txId: tx.txId, amount: amount.toString() }, { status: 202 });
  } catch (err) {
    console.error("wallet/agent:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status: 500 });
  }
}
