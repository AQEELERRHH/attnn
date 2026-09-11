import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bids } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
    if (bid.creatorUserId !== session.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (bid.status !== "pending") return NextResponse.json({ error: "Bid already processed" }, { status: 400 });

    const minBid = 5_000_000;
    if (Number(counterOfferAmount) < minBid) {
      return NextResponse.json({ error: "Counter offer must be at least $5 USDC" }, { status: 400 });
    }

    if (Number(counterOfferAmount) <= Number(bid.amountUsdc)) {
      return NextResponse.json({ error: "Counter offer must be higher than the original bid" }, { status: 400 });
    }

    await db.update(bids).set({
      status: "counter_offered",
      counterOfferAmount: counterOfferAmount.toString(),
    }).where(eq(bids.id, bidId));

    await inngest.send({
      name: "attnn/counter.received",
      data: { bidId, bidderUserId: bid.bidderUserId, counterOfferAmount },
    }).catch(() => {});

    return NextResponse.json({ success: true, bidId, counterOfferAmount });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
