import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { bids } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { decodeEventLog } from "viem";
import { escrowAbi } from "@/lib/arc";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.notificationType !== "contracts.eventLog") {
      return NextResponse.json({ ok: true });
    }
    const { txHash, eventName, topics, data, blockchain } = body.notification;
    if (blockchain !== "ARC-TESTNET") return NextResponse.json({ ok: true });
    console.log("Circle event:", eventName, txHash);

    let decoded: any;
    try {
      decoded = decodeEventLog({
        abi: escrowAbi,
        data: data as `0x${string}`,
        topics: topics as [`0x${string}`, ...(`0x${string}`)[]],
      });
    } catch (e) {
      console.error("Failed to decode:", e);
      return NextResponse.json({ ok: true });
    }

    if (decoded.eventName === "BidPlaced") {
      const onChainBidId = (decoded.args as any).bidId?.toString();
      const bidderAddress = (decoded.args as any).bidder?.toLowerCase();
      const amount = (decoded.args as any).amount?.toString();
      if (!onChainBidId || !bidderAddress) return NextResponse.json({ ok: true });

      const matchingBid = await db.query.bids.findFirst({
        where: (b, { eq, and, isNull }) => and(
          eq(b.bidderAddress, bidderAddress),
          eq(b.amountUsdc, amount),
          isNull(b.onChainBidId),
        ),
      });

      if (matchingBid) {
        await db.update(bids).set({
          onChainBidId,
          onChainTxHash: txHash,
        }).where(eq(bids.id, matchingBid.id));
        console.log("Updated bid", matchingBid.id, "onChainBidId:", onChainBidId, "txHash:", txHash);
      }
    }

    if (decoded.eventName === "BidAccepted") {
      const onChainBidId = (decoded.args as any).bidId?.toString();
      if (!onChainBidId) return NextResponse.json({ ok: true });
      const matchingBid = await db.query.bids.findFirst({
        where: (b, { eq }) => eq(b.onChainBidId, onChainBidId),
      });
      if (matchingBid) {
        await db.update(bids).set({
          settlementOnChainTxHash: txHash,
          status: "accepted",
        }).where(eq(bids.id, matchingBid.id));
        console.log("Bid accepted:", matchingBid.id, txHash);
      }
    }

    if (decoded.eventName === "BidRejected") {
      const onChainBidId = (decoded.args as any).bidId?.toString();
      if (!onChainBidId) return NextResponse.json({ ok: true });
      const matchingBid = await db.query.bids.findFirst({
        where: (b, { eq }) => eq(b.onChainBidId, onChainBidId),
      });
      if (matchingBid) {
        await db.update(bids).set({
          settlementOnChainTxHash: txHash,
          status: "rejected",
        }).where(eq(bids.id, matchingBid.id));
        console.log("Bid rejected:", matchingBid.id, txHash);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
