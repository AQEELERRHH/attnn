import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { clientIp } from "@/lib/api-request";
import { BidError } from "@/lib/bids";
import { callsFor, createExternalBidIntent, intentToken } from "@/lib/external-bids";

/**
 * POST /api/v1/bids: an outside agent asks to bid from its own wallet (docs/AGENTS.md).
 * Body: { handle, amount (atomic USDC, string), bidder (0x wallet), message? }.
 * Header Idempotency-Key (optional): a retry returns the same bid.
 * Returns the two calls to send from that wallet, and an access token for GET /api/v1/bids/<id>.
 * No session and no cookies: this is an API for agents, not the app.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Send a JSON body: { handle, amount, bidder, message? }" }, { status: 400 });

    const blocked =
      (await limitOrNull(LIMITS.externalBidIp, clientIp(req))) ??
      (typeof body.bidder === "string" ? await limitOrNull(LIMITS.externalBidWallet, body.bidder.toLowerCase()) : null);
    if (blocked) return blocked;

    const { intent, created } = await createExternalBidIntent({
      handle: body.handle,
      amount: body.amount,
      message: body.message,
      bidder: body.bidder,
      idempotencyKey: req.headers.get("idempotency-key"),
    });
    return NextResponse.json(
      {
        id: intent.id,
        accessToken: intentToken(intent.id),
        status: intent.bidId ? "recorded" : "waiting",
        escrow: intent.escrowAddress,
        amount: intent.amountUsdc,
        messageHash: intent.messageHash,
        calls: callsFor(intent),
        next: `Send both calls from ${intent.bidderAddress} on Arc, in order, then POST /api/v1/bids/${intent.id}/confirm with { "txHash": <the placeBid transaction> }.`,
      },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof BidError) return NextResponse.json({ error: err.message }, { status: err.status });
    return serverError("v1/bids", err, "Couldn't prepare the bid. Please try again.");
  }
}
