import { NextRequest, NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { webhookEvents, bids } from "@/lib/db/schema";
import { verifyCircleSignature } from "@/lib/circle-webhook";
import { classifyTxState } from "@/lib/circle";
import { finalizePlacement, finalizeSettlement, notifyBidEscrowed } from "@/lib/bids";

/**
 * Circle Wallets transaction notifications (transactions.outbound / inbound).
 *
 * When one of our transactions reaches a terminal state (COMPLETE, FAILED,
 * CANCELLED, DENIED) we finish the matching bid right away instead of waiting for
 * the next poll. Earlier code waited for a "SETTLED" state, which Circle never
 * sends, so it never did anything.
 *
 * Handlers are idempotent; a notification is recorded only after it succeeds, and
 * failures return 500 so Circle retries.
 */
const SOURCE = "circle";

interface CircleTxNotification {
  notificationId?: string;
  notificationType?: string;
  notification?: { id?: string; state?: string; txHash?: string };
  // Older payload shape, kept for safety.
  id?: string;
  type?: string;
  data?: { transaction?: { id?: string; state?: string } };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const verified = await verifyCircleSignature(
    raw,
    req.headers.get("x-circle-signature"),
    req.headers.get("x-circle-key-id"),
  );
  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: CircleTxNotification;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = payload.notificationId ?? payload.id;
  if (eventId) {
    const existing = await db.query.webhookEvents.findFirst({
      where: and(eq(webhookEvents.source, SOURCE), eq(webhookEvents.eventId, eventId)),
    });
    if (existing) return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const type = payload.notificationType ?? payload.type;
    const txId = payload.notification?.id ?? payload.data?.transaction?.id;
    const state = payload.notification?.state ?? payload.data?.transaction?.state;
    let handled = 0;

    if ((type === "transactions.outbound" || type === "transactions.inbound") && txId && classifyTxState(state) !== "in_flight") {
      const matches = await db
        .select({ id: bids.id, status: bids.status, bidTxHash: bids.bidTxHash, settlementTxHash: bids.settlementTxHash })
        .from(bids)
        .where(or(eq(bids.bidTxHash, txId), eq(bids.settlementTxHash, txId)));

      for (const m of matches) {
        if (m.status === "placing" && m.bidTxHash === txId) {
          if ((await finalizePlacement(m.id)) === "escrowed") {
            const full = await db.query.bids.findFirst({ where: eq(bids.id, m.id) });
            if (full) await notifyBidEscrowed(full);
          }
          handled++;
        } else if (m.settlementTxHash === txId) {
          await finalizeSettlement(m.id);
          handled++;
        }
      }
    }

    if (eventId) {
      await db.insert(webhookEvents).values({ source: SOURCE, eventId, payload, processedAt: new Date() });
    }
    return NextResponse.json({ received: true, handled });
  } catch (err) {
    console.error("circle webhook: handling failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
