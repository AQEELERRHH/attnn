import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { webhookEvents, bids } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const expected = hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("x-circle-signature") ?? "";
    const secret = process.env.CIRCLE_WEBHOOK_SECRET ?? "";

    if (secret && !verifySignature(body, signature, secret)) {
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
  } catch (err: any) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
