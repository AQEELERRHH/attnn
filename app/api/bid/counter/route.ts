import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bids } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ESCROW_MAX_BID, ESCROW_MIN_BID, formatUsd, parseAtomicUsdc } from "@/lib/bid-rules";
import { inngest } from "@/lib/inngest";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { bidId, counterOfferAmount } = await req.json();

    if (!bidId || !counterOfferAmount) {
      return NextResponse.json({ error: "Missing bidId or counterOfferAmount" }, { status: 400 });
    }

    const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
    if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    if (bid.creatorUserId !== session.user.id) return NextResponse.json({ error: "Only the creator can counter this bid" }, { status: 403 });
    if (bid.status !== "pending") return NextResponse.json({ error: "Bid already processed" }, { status: 400 });
    if (bid.settlementTxHash) return NextResponse.json({ error: "This bid is already being settled" }, { status: 409 });

    const amount = parseAtomicUsdc(counterOfferAmount);
    if (amount === null || amount < ESCROW_MIN_BID || amount > ESCROW_MAX_BID) {
      return NextResponse.json({ error: `Counter offer must be between ${formatUsd(ESCROW_MIN_BID)} and $1,000 USDC` }, { status: 400 });
    }
    if (amount <= BigInt(bid.amountUsdc)) {
      return NextResponse.json({ error: "Counter offer must be higher than the original bid" }, { status: 400 });
    }

    const updated = await db
      .update(bids)
      .set({ status: "counter_offered", counterOfferAmount: amount.toString() })
      .where(and(eq(bids.id, bidId), eq(bids.status, "pending"), isNull(bids.settlementTxHash)))
      .returning({ id: bids.id });
    if (!updated.length) return NextResponse.json({ error: "Bid already processed" }, { status: 409 });

    try {
      await inngest.send({
        name: "attnn/counter.received",
        data: { bidId, bidderUserId: bid.bidderUserId, counterOfferAmount: amount.toString() },
      });
    } catch (err) {
      // Without the event the bidder's agent never hears about the counter; undo it.
      console.error("bid/counter: inngest.send failed", err);
      await db
        .update(bids)
        .set({ status: "pending", counterOfferAmount: null })
        .where(and(eq(bids.id, bidId), eq(bids.status, "counter_offered"), isNull(bids.settlementTxHash)));
      return NextResponse.json({ error: "Couldn't send the counter right now. Please try again." }, { status: 503 });
    }

    return NextResponse.json({ success: true, bidId, counterOfferAmount: amount.toString() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
