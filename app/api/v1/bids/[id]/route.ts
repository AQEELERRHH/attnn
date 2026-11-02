import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { bearer, clientIp } from "@/lib/api-request";
import { REFUND_PERIOD_MS } from "@/lib/bid-rules";
import { BidError } from "@/lib/bids";
import { loadIntent, tokenMatches, viewIntent } from "@/lib/external-bids";

/**
 * GET /api/v1/bids/<id>: the bid's status, and the creator's reply once it is accepted.
 * Needs the bid's access token: the reply is for the bidder only.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const blocked = await limitOrNull(LIMITS.externalBidRead, clientIp(req));
    if (blocked) return blocked;
    const { id } = await params;
    const intent = await loadIntent(id);
    // Same answer for "no such bid" and "wrong token", so ids can't be probed.
    if (!intent || !tokenMatches(intent.id, bearer(req))) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    return NextResponse.json(await viewIntent(intent, REFUND_PERIOD_MS));
  } catch (err) {
    if (err instanceof BidError) return NextResponse.json({ error: err.message }, { status: err.status });
    return serverError("v1/bids/[id]", err, "Couldn't read the bid. Please try again.");
  }
}
