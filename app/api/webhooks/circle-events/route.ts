import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { bids, webhookEvents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { decodeEventLog, type DecodeEventLogReturnType } from "viem";
import { escrowAbi } from "@/lib/arc";
import { verifyCircleSignature } from "@/lib/circle-webhook";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    const verified = await verifyCircleSignature(
      rawBody,
      req.headers.get("x-circle-signature"),
      req.headers.get("x-circle-key-id"),
    );
    if (!verified) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // Replay protection: a verified notification is still replayable, so each
    // notificationId is processed once.
    const notificationId = body.notificationId;
    if (notificationId) {
      const seen = await db.query.webhookEvents.findFirst({
        where: and(
          eq(webhookEvents.source, "circle-events"),
          eq(webhookEvents.eventId, notificationId),
        ),
      });
      if (seen) return NextResponse.json({ ok: true });

      await db.insert(webhookEvents).values({
        source: "circle-events",
        eventId: notificationId,
        payload: body,
      });
    } else {
      console.warn("Circle events webhook: notification has no notificationId, processing without replay check");
    }

    if (body.notificationType !== "contracts.eventLog") {
      return NextResponse.json({ ok: true });
    }
    const { txHash, eventName, topics, data, blockchain } = body.notification;
    if (blockchain !== "ARC-TESTNET") return NextResponse.json({ ok: true });
    console.log("Circle event:", eventName, txHash);

    let decoded: DecodeEventLogReturnType<typeof escrowAbi>;
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
      const onChainBidId = decoded.args.bidId?.toString();
      const bidderAddress = decoded.args.bidder?.toLowerCase();
      const amount = decoded.args.amount?.toString();
      if (!onChainBidId || !bidderAddress) return NextResponse.json({ ok: true });

      const matchingBid = await db.query.bids.findFirst({
        where: (b, { eq, and, isNull }) => and(
          eq(b.bidderAddress, bidderAddress),
          eq(b.amountUsdc, amount ?? "0"),
          isNull(b.onChainBidId),
          eq(b.status, "pending"),
        ),
        orderBy: (b, { desc }) => [desc(b.createdAt)],
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
      const onChainBidId = decoded.args.bidId?.toString();
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

    if (decoded.eventName === "BidRefunded") {
      const onChainBidId = decoded.args.bidId?.toString();
      if (!onChainBidId) return NextResponse.json({ ok: true });
      const matchingBid = await db.query.bids.findFirst({
        where: (b, { eq }) => eq(b.onChainBidId, onChainBidId),
      });
      if (matchingBid) {
        await db.update(bids).set({
          settlementOnChainTxHash: txHash,
          status: "refunded",
        }).where(eq(bids.id, matchingBid.id));
        console.log("Bid refunded:", matchingBid.id, txHash);
      }
    }

    if (decoded.eventName === "BidRejected") {
      const onChainBidId = decoded.args.bidId?.toString();
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
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
