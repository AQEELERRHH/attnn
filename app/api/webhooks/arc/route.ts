import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { webhookEvents, bids, wallets, agentLogs } from "@/lib/db/schema";
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
    const signature = req.headers.get("x-alchemy-signature") ?? req.headers.get("x-hub-signature-256") ?? "";
    const secret = process.env.ALCHEMY_WEBHOOK_SECRET ?? "";

    if (secret && !verifySignature(body, signature, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    const eventId = payload?.id ?? payload?.event?.id ?? crypto.randomUUID();

    // Idempotency
    const existing = await db.query.webhookEvents.findFirst({
      where: eq(webhookEvents.eventId, eventId),
    });
    if (existing) return NextResponse.json({ received: true });

    await db.insert(webhookEvents).values({
      source: "arc", eventId, payload,
    });

    // Handle Arc events
    const event = payload?.event;
    if (event?.name === "BidPlaced") {
      const { bidId, bidder, creator, amount } = event.args ?? {};

      // Find creator's profile and auto-score
      const creatorWallet = await db.query.wallets.findFirst({
        where: eq(wallets.address, creator?.toLowerCase() ?? ""),
      });
      const bidderWallet = await db.query.wallets.findFirst({
        where: eq(wallets.address, bidder?.toLowerCase() ?? ""),
      });

      if (creatorWallet && bidderWallet) {
        const existingBids = await db.query.bids.findMany({
          where: eq(bids.bidderAddress, bidder?.toLowerCase() ?? ""),
          limit: 1,
        });

        if (existingBids.length === 0) {
          // New bid discovered via webhook, log it
          await db.insert(agentLogs).values({
            userId: creatorWallet.userId,
            action: "webhook_received",
            data: { bidId: bidId?.toString(), amount: amount?.toString(), bidder },
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("Arc webhook error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
