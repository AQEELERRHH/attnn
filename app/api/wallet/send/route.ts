import { NextRequest, NextResponse } from "next/server";
import { stableUuid } from "@/lib/bid-rules";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { mainWallet, walletByAddress } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { parseRequestId, rejectedByCircle, transferUSDC } from "@/lib/circle";
import { dollarsToAtomic } from "@/lib/format";
import {
  WITHDRAWAL_LIMIT_24H,
  WithdrawalError,
  confirmWithdrawalAddress,
  isConfirmedAddress,
  markWithdrawal,
  notifyWithdrawal,
  remainingLast24h,
  reserveWithdrawal,
  sendWithdrawalCode,
} from "@/lib/withdrawals";

/** What the Send form shows: the 24-hour limit and what's left of it. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const remaining = await remainingLast24h(session.user.id);
    return NextResponse.json({ limit: WITHDRAWAL_LIMIT_24H.toString(), remaining: remaining.toString() });
  } catch (err) {
    return serverError("wallet/send GET", err, "Couldn't load your sending limit.");
  }
}

/**
 * Sends USDC from the user's main wallet (decision D4):
 *   - a new address needs the 6-digit code emailed to the account: without `code` the
 *     route emails one and answers 202 { needsCode: true }; with it, the address is
 *     confirmed for next time;
 *   - at most $500 in any 24 hours;
 *   - the browser's requestId makes it idempotent.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.walletSend, userId));
    if (blocked) return blocked;

    const { to, amount, requestId: rawRequestId, code } = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }
    // Dollars in ("12.5"), atomic USDC out, without float maths.
    const atomic = dollarsToAtomic(String(amount ?? ""));
    if (atomic === null || atomic <= BigInt(0)) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    const requestId = parseRequestId(rawRequestId);
    if (!requestId) return NextResponse.json({ error: "Missing request id. Please reload the page and try again." }, { status: 400 });

    const wallet = await mainWallet(userId);
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    if (to.toLowerCase() === wallet.address.toLowerCase()) {
      return NextResponse.json({ error: "That's this wallet's own address." }, { status: 400 });
    }

    // Moving USDC to your own agent wallet is done on the Agent tab, not here; any
    // other new address needs the emailed code first.
    const own = !!(await walletByAddress(userId, to));
    if (!own && !(await isConfirmedAddress(userId, to))) {
      if (typeof code !== "string" || code.trim() === "") {
        const blockedCode = await limitOrNull(LIMITS.withdrawalCode, userId);
        if (blockedCode) return blockedCode;
        const { sentTo } = await sendWithdrawalCode(userId, to);
        return NextResponse.json({ needsCode: true, sentTo }, { status: 202 });
      }
      await confirmWithdrawalAddress(userId, to, code.trim());
    }

    // Same request id → same transfer: a double click or retry never sends twice.
    const requestKey = `send:${stableUuid(`${userId}:${requestId}`)}`;
    const { row, retry } = await reserveWithdrawal({ userId, requestKey, to, amount: atomic });
    if (retry && row.status === "failed") {
      return NextResponse.json({ error: "That send didn't go through and nothing was sent. Please start it again.", restart: true }, { status: 409 });
    }
    if (retry && row.status === "submitted" && row.circleTxId) {
      return NextResponse.json({ success: true, txId: row.circleTxId });
    }

    try {
      const result = await transferUSDC(wallet.circleWalletId, row.toAddress, row.amountUsdc, requestKey);
      await markWithdrawal(row.id, { circleTxId: result.txId });
      if (!retry) await notifyWithdrawal(userId, row.toAddress, BigInt(row.amountUsdc));
      return NextResponse.json({ success: true, txId: result.txId });
    } catch (err) {
      // Refused outright: nothing was sent, so it doesn't count against the limit.
      // Otherwise it may have gone through; it stays counted and a retry with the same
      // request id finishes it (Circle's idempotency returns the original transfer).
      if (rejectedByCircle(err)) await markWithdrawal(row.id, { failed: true });
      throw err;
    }
  } catch (err) {
    if (err instanceof WithdrawalError) return NextResponse.json({ error: err.message }, { status: err.status });
    return serverError("wallet/send", err, "We couldn't confirm the transfer. Check your balance before trying again.");
  }
}
