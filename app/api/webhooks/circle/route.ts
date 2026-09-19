import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { webhookEvents, bids } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { verifyCircleSignature } from "@/lib/circle-webhook";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    const verified = await verifyCircleSignature(
      body,
      req.headers.get("x-circle-signature"),
      req.headers.get("x-circle-key-id"),
    );
    if (!verified) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    const eventId = payload?.id ?? payload?.eventId ?? crypto.randomUUID();

    // Idempotency check
    const existing = await db.query.webhookEvents.findFirst({
      where: eq(webhookEvents.eventId, eventId),
    });
    if (existing) return NextResponse.json({ received: true });

    await db.insert(webhookEvents).values({
      source: "circle", eventId, payload,
    });

    // Handle specific event types
    if (payload.type === "transactions.outbound" || payload.type === "transactions.inbound") {
      const txHash = payload.data?.transaction?.transactionHash;
      const status = payload.data?.transaction?.state;
      if (txHash && status === "SETTLED") {
        // Find matching bid and update
        const matchingBids = await db.query.bids.findMany({
          where: eq(bids.settlementTxHash, txHash),
        });
        for (const _bid of matchingBids) {
          if (status === "SETTLED") {
            // Transaction confirmed
          }
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : undefined }, { status: 500 });
  }
}
