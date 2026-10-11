import { handleIs } from "@/lib/profiles";
import { NextRequest, NextResponse } from "next/server";
import { formatUsd, parseAtomicUsdc, stableUuid } from "@/lib/bid-rules";
import { parseRequestId } from "@/lib/circle";
import { AllowanceExceeded, WithdrawalError, approveWithCode, codeSubject, requestSecurityCode } from "@/lib/withdrawals";
import { sameOrigin } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { BidError, createBidIntent } from "@/lib/bids";

/**
 * Records a bid and queues it for on-chain placement. Returns 202 straight away:
 * the bid shows as "placing" until the placeBid job has escrowed it on Arc
 * ("pending") or it fails with a reason ("failed", no USDC moved).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.bidPlace, session.user.id));
    if (blocked) return blocked;

    const body = await req.json().catch(() => null);
    const { creatorHandle, amountUsdc, message, isPrivate, code, requestId: rawRequestId } = (body ?? {}) as Record<string, unknown>;
    // The browser's request id: a retried request returns the same bid, never a second one.
    const requestId = parseRequestId(rawRequestId);
    if (!requestId) return NextResponse.json({ error: "Missing request id. Please reload the page and try again." }, { status: 400 });
    if (typeof creatorHandle !== "string" || !creatorHandle) {
      return NextResponse.json({ error: "creatorHandle is required" }, { status: 400 });
    }
    if (message !== undefined && message !== null && (typeof message !== "string" || message.length > 2000)) {
      return NextResponse.json({ error: "Message must be text under 2000 characters" }, { status: 400 });
    }

    const creatorProfile = await db.query.profiles.findFirst({ where: handleIs(creatorHandle) });
    if (!creatorProfile) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    // Bids count against the shared 24-hour allowance (D4). Over it, the route emails a
    // code (202 { needsCode }); the same bid sent again with that code goes ahead.
    const amount = parseAtomicUsdc(typeof amountUsdc === "number" ? String(amountUsdc) : amountUsdc);
    const subject = codeSubject.bid(creatorProfile.userId, amount ?? BigInt(0));
    const givenCode = typeof code === "string" ? code.trim() : "";

    let bid;
    try {
      bid = await createBidIntent({
        bidderUserId: session.user.id,
        creatorUserId: creatorProfile.userId,
        amountUsdc: typeof amountUsdc === "number" ? String(amountUsdc) : (amountUsdc as string),
        message: (message as string | undefined) ?? null,
        isPrivate: isPrivate === true,
        requestKey: `bid:${stableUuid(`${session.user.id}:${requestId}`)}`,
        // The code is only used up if this exact bid is over the allowance and valid.
        approveOverAllowance: givenCode && amount !== null ? approveWithCode(session.user.id, subject, givenCode, amount) : undefined,
      });
    } catch (err) {
      if (!(err instanceof AllowanceExceeded) || amount === null) throw err;
      const blockedCode = await limitOrNull(LIMITS.withdrawalCode, session.user.id);
      if (blockedCode) return blockedCode;
      const { sentTo } = await requestSecurityCode(
        session.user.id,
        subject,
        `approve a ${formatUsd(amount)} bid to @${creatorProfile.handle} (over your 24-hour allowance)`,
      );
      return NextResponse.json({ needsCode: true, sentTo, error: err.message }, { status: 202 });
    }

    return NextResponse.json(
      { success: true, status: "placing", bid: { id: bid.id, status: bid.status, amountUsdc: bid.amountUsdc } },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof BidError || err instanceof WithdrawalError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("bid/place:", err);
    return NextResponse.json({ error: "Could not place bid" }, { status: 500 });
  }
}
