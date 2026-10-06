import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { decodeEventLog, type DecodeEventLogReturnType } from "viem";
import { db } from "@/lib/db/client";
import { bids, webhookEvents } from "@/lib/db/schema";
import { escrowAbi } from "@/lib/arc";
import { arc, escrowAddress } from "@/lib/chain";
import { verifyCircleSignature } from "@/lib/circle-webhook";
import { finalizePlacement, finalizeSettlement, notifyBidEscrowed } from "@/lib/bids";

/**
 * Circle Smart Contract Platform event monitor → AttnnEscrow logs.
 *
 * These events are a fast trigger, not the source of truth for placement: a
 * BidPlaced log makes us re-check the placing bids of that bidder through
 * finalizePlacement, which reads the bid id from the transaction receipt. There is
 * no more guessing which DB row a log belongs to by bidder + amount.
 *
 * Settlement logs (BidAccepted / BidRejected / BidRefunded) are on-chain facts from
 * our own escrow, so they may set the final status directly.
 *
 * Only events from the CURRENT escrow contract are processed: every deployment
 * numbers bids from 1, so an old contract's "bid 5" is a different bid.
 *
 * A notification is recorded as processed only after handling succeeds, and
 * failures return 500 so Circle retries.
 */
const SOURCE = "circle-events";
const SETTLEABLE = ["pending", "counter_offered"] as const;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const verified = await verifyCircleSignature(
    rawBody,
    req.headers.get("x-circle-signature"),
    req.headers.get("x-circle-key-id"),
  );
  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: {
    notificationId?: string;
    notificationType?: string;
    notification?: {
      txHash?: string;
      contractAddress?: string;
      blockchain?: string;
      topics?: string[];
      data?: string;
      eventName?: string;
    };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const notificationId = body.notificationId;
  if (notificationId) {
    const seen = await db.query.webhookEvents.findFirst({
      where: and(eq(webhookEvents.source, SOURCE), eq(webhookEvents.eventId, notificationId)),
    });
    if (seen) return NextResponse.json({ ok: true, duplicate: true });
  } else {
    console.warn("circle-events: notification has no notificationId, processing without replay check");
  }

  try {
    const result = await handle(body);
    if (notificationId) {
      await db.insert(webhookEvents).values({
        source: SOURCE,
        eventId: notificationId,
        payload: body,
        processedAt: new Date(),
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Not recorded as seen, so Circle's retry gets processed.
    console.error("circle-events: handling failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

async function handle(body: {
  notificationType?: string;
  notification?: { txHash?: string; contractAddress?: string; blockchain?: string; topics?: string[]; data?: string };
}): Promise<Record<string, unknown>> {
  if (body.notificationType !== "contracts.eventLog" || !body.notification) return { ignored: "not an event log" };
  const { txHash, contractAddress, blockchain, topics, data } = body.notification;

  if (blockchain !== arc.circleBlockchain) return { ignored: `blockchain ${blockchain}` };
  const escrow = escrowAddress();
  if (!escrow || contractAddress?.toLowerCase() !== escrow) {
    return { ignored: `contract ${contractAddress} is not the current escrow` };
  }

  let decoded: DecodeEventLogReturnType<typeof escrowAbi>;
  try {
    decoded = decodeEventLog({
      abi: escrowAbi,
      data: (data ?? "0x") as `0x${string}`,
      topics: (topics ?? []) as [`0x${string}`, ...`0x${string}`[]],
    });
  } catch {
    return { ignored: "not an escrow event" };
  }

  if (decoded.eventName === "BidPlaced") {
    const bidder = decoded.args.bidder.toLowerCase();
    // Placing bids from this bidder in this escrow that have a submitted transaction.
    const candidates = await db
      .select({ id: bids.id, bidderAddress: bids.bidderAddress })
      .from(bids)
      .where(and(eq(bids.status, "placing"), eq(bids.escrowAddress, escrow)));
    let escrowed = 0;
    for (const c of candidates.filter((c) => c.bidderAddress.toLowerCase() === bidder)) {
      if ((await finalizePlacement(c.id)) === "escrowed") {
        const full = await db.query.bids.findFirst({ where: eq(bids.id, c.id) });
        if (full) await notifyBidEscrowed(full);
        escrowed++;
      }
    }
    return { event: "BidPlaced", escrowed };
  }

  const onChainBidId = decoded.args.bidId.toString();
  const bid = await db.query.bids.findFirst({
    where: and(
      eq(bids.onChainBidId, onChainBidId),
      // Only rows known to live in this escrow. Bid ids restart at 1 in every
      // deployment, so a NULL-escrow row with the same id is a different bid
      // (submitSettlement resolves and stamps those itself).
      eq(bids.escrowAddress, escrow),
    ),
  });
  if (!bid) return { ignored: `no bid for on-chain id ${onChainBidId}` };

  // If we sent the settlement, confirm it through Circle (also bumps retries correctly).
  if (bid.settlementTxHash) {
    const outcome = await finalizeSettlement(bid.id);
    if (outcome !== "in_flight") return { event: decoded.eventName, outcome };
  }

  // Otherwise (or Circle not caught up yet) the log itself is the on-chain fact.
  const finalStatus =
    decoded.eventName === "BidAccepted" ? "accepted" : decoded.eventName === "BidRejected" ? "rejected" : "refunded";
  const updated = await db
    .update(bids)
    .set({ status: finalStatus, settlementOnChainTxHash: txHash ?? null, settledAt: new Date() })
    .where(and(eq(bids.id, bid.id), inArray(bids.status, [...SETTLEABLE])))
    .returning({ id: bids.id });
  return { event: decoded.eventName, updated: updated.length };
}
