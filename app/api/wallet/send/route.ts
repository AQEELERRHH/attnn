import { NextRequest, NextResponse } from "next/server";
import { stableUuid } from "@/lib/bid-rules";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { mainWallet, walletByAddress } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { parseRequestId, rejectedByCircle, transferUSDC } from "@/lib/circle";
import { dollarsToAtomic } from "@/lib/format";
import {
  DAILY_ALLOWANCE,
  AllowanceExceeded,
  WithdrawalError,
  allowanceRemaining,
  codeSubject,
  confirmWithdrawalAddress,
  isConfirmedAddress,
  markWithdrawal,
  notifyWithdrawal,
  requestSecurityCode,
  reserveWithdrawal,
} from "@/lib/withdrawals";

/** What the Send form shows: the shared 24-hour allowance and what's left of it. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const remaining = await allowanceRemaining(session.user.id);
    return NextResponse.json({ limit: DAILY_ALLOWANCE.toString(), remaining: remaining.toString() });
  } catch (err) {
    return serverError("wallet/send GET", err, "Couldn't load your sending limit.");
  }
}

/**
 * Sends USDC from the user's main wallet (decision D4):
 *   - a new address needs the 6-digit code emailed to the account: without `code` the
 *     route emails one and answers 202 { needsCode: true }; with it, the address is
 *     confirmed for next time;
 *   - counts against the shared $500 / 24 h allowance (sends never go over it);
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
        // Don't email a code for a send the allowance would refuse anyway.
        const remaining = await allowanceRemaining(userId);
        if (atomic > remaining) throw new AllowanceExceeded(remaining, false);
        const blockedCode = await limitOrNull(LIMITS.withdrawalCode, userId);
        if (blockedCode) return blockedCode;
        const { sentTo } = await requestSecurityCode(userId, codeSubject.address(to), `confirm sending USDC to the new address ${to}`);
        return NextResponse.json({ needsCode: true, sentTo }, { status: 202 });
      }
      await confirmWithdrawalAddress(userId, to, code.trim());
    }

    // Same request id → same transfer: a double click or retry never sends twice.
    const requestKey = `send:${stableUuid(`${userId}:${requestId}`)}`;
    const { row, retry } = await reserveWithdrawal({ userId, kind: "send", requestKey, to, amount: atomic });
    if (retry && row.status === "failed") {
      return NextResponse.json({ error: "That send didn't go through and nothing was sent. Please start it again.", restart: true }, { status: 409 });
    }
    if (retry && row.status === "submitted" && row.circleTxId) {
      return NextResponse.json({ success: true, txId: row.circleTxId });
    }

    try {
      const result = await transferUSDC(wallet.circleWalletId, row.toAddress, row.amountUsdc, requestKey);
      // The notice goes out once, when the row first becomes "submitted" (also after a retry).
      if (await markWithdrawal(row.id, { circleTxId: result.txId })) await notifyWithdrawal(userId, row.toAddress, BigInt(row.amountUsdc));
      return NextResponse.json({ success: true, txId: result.txId });
    } catch (err) {
      // Refused outright on the FIRST try: nothing was sent, so it doesn't count. On a
      // retry an earlier attempt may have gone through, so it stays counted; so does any
      // unclear error (a retry with the same request id finishes it idempotently).
      if (!retry && rejectedByCircle(err)) await markWithdrawal(row.id, { failed: true });
      throw err;
    }
  } catch (err) {
    if (err instanceof WithdrawalError) return NextResponse.json({ error: err.message }, { status: err.status });
    return serverError("wallet/send", err, "We couldn't confirm the transfer. Check your balance before trying again.");
  }
}
