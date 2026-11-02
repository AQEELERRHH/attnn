import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { bearer, clientIp } from "@/lib/api-request";
import { REFUND_PERIOD_MS } from "@/lib/bid-rules";
import { BidError } from "@/lib/bids";
import { loadIntent, recordExternalPlacement, tokenMatches, viewIntent } from "@/lib/external-bids";

/**
 * POST /api/v1/bids/<id>/confirm { txHash }: "I sent placeBid". Attnn. reads that
 * transaction from Arc itself and records the bid only if it really escrowed this one
 * (lib/external-bids.ts recordExternalPlacement). Needs the bid's access token.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const blocked = await limitOrNull(LIMITS.externalBidRead, clientIp(req));
    if (blocked) return blocked;
    const { id } = await params;
    const intent = await loadIntent(id);
    if (!intent || !tokenMatches(intent.id, bearer(req))) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { txHash?: unknown } | null;
    const txHash = typeof body?.txHash === "string" ? body.txHash.trim() : "";
    if (!intent.bidId) {
      const result = await recordExternalPlacement(txHash, intent.id);
      if (!result.recorded.length) {
        const view = await viewIntent((await loadIntent(id)) ?? intent, REFUND_PERIOD_MS);
        // Recorded meanwhile by the webhook: that's success too.
        if (view.status !== "waiting") return NextResponse.json(view);
        return NextResponse.json({ error: result.reason ?? "Not escrowed yet", bid: view }, { status: 409 });
      }
    }
    return NextResponse.json(await viewIntent((await loadIntent(id)) ?? intent, REFUND_PERIOD_MS));
  } catch (err) {
    if (err instanceof BidError) return NextResponse.json({ error: err.message }, { status: err.status });
    return serverError("v1/bids/[id]/confirm", err, "Couldn't check the transaction. Please try again.");
  }
}
