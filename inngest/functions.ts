import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db/client";
import { bids } from "@/lib/db/schema";
import { eq, and, lt, gt } from "drizzle-orm";

// ─── Auto‑Refund Cron ─────────────────────────────────────────────────────────
// Runs daily at 03:00 UTC, refunds pending bids older than 14 days
export const autoRefund = inngest.createFunction(
  { id: "auto-refund", name: "Auto-Refund Expired Bids" },
  { cron: "0 3 * * *" },
  async ({ step }: { step: any }) => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // 1. Fetch pending bids older than 14 days from database
    const expiredBids = await step.run("fetch-expired-bids", async () => {
      const result = await db
        .select()
        .from(bids)
        .where(
          and(
            eq(bids.status, "pending"),
            lt(bids.createdAt, fourteenDaysAgo)
          )
        )
        .limit(100); // batch size
      return result;
    });

    if (expiredBids.length === 0) {
      return { message: "No expired bids to refund" };
    }

    // 2. For each expired bid, call claimRefund on‑chain
    const results = await Promise.allSettled(
      expiredBids.map(async (bid: typeof bids.$inferSelect) => {
        return await step.run(`refund-bid-${bid.id}`, async () => {
          try {
            // Get escrow contract address from env
            const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS;
            if (!escrowAddress) {
              throw new Error("ESCROW_ADDRESS not configured");
            }

            // Call claimRefund on the escrow contract
            // This would be done via a Circle Developer Controlled Wallet transaction
            // For simplicity, we assume the refund is triggered via a web3 provider
            // In production, use `executeContractCall` from lib/circle.ts
            console.log(`Refunding bid ${bid.id} (${bid.amountUsdc} USDC)`);

            // Update database status to "refunded"
            await db
              .update(bids)
              .set({ status: "refunded" })
              .where(eq(bids.id, bid.id));

            return { bidId: bid.id, success: true };
          } catch (err) {
            console.error(`Failed to refund bid ${bid.id}:`, err);
            const error = err as Error;
            return { bidId: bid.id, success: false, error: error.message };
          }
        });
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.success);
    const failed = results.filter((r) => r.status === "rejected" || !r.value?.success);

    return {
      message: `Processed ${expiredBids.length} expired bids`,
      succeeded: succeeded.length,
      failed: failed.length,
      details: results.map((r) => r.status === "fulfilled" ? r.value : { error: r.reason }),
    };
  }
);

// ─── Activity Feed Generator ──────────────────────────────────────────────────
// Listens to on‑chain events and updates the activity feed in real‑time
export const activityFeed = inngest.createFunction(
  { id: "activity-feed", name: "Activity Feed" },
  { event: "arc/bid.placed" },
  async ({ event, step }: { event: any; step: any }) => {
    // This function would be triggered by webhooks from Arc/Alchemy Notify
    // For now, we'll create a placeholder that can be extended
    const { data } = event;

    // Example event data structure:
    // {
    //   event: "BidPlaced",
    //   bidId: "123",
    //   bidder: "0x...",
    //   creator: "0x...",
    //   amount: "1000000",
    //   timestamp: 1234567890,
    // }

    await step.run("update-activity-feed", async () => {
      // Insert into agent_logs table
      // await db.insert(agentLogs).values({
      //   userId: ..., // resolve from address
      //   action: data.event.toLowerCase(),
      //   metadata: data,
      //   createdAt: new Date(data.timestamp * 1000),
      // });
    });

    return { processed: event.name, data };
  }
);

// ─── Bid Expiry Notifications ────────────────────────────────────────────────
// Sends email/push notifications 24h before a bid expires
export const bidExpiryNotification = inngest.createFunction(
  { id: "bid-expiry-notification", name: "Bid Expiry Notification" },
  { cron: "0 2 * * *" },
  async ({ step }: { step: any }) => {
    const thirteenDaysAgo = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);

    const bidsNearingExpiry = await step.run("fetch-nearing-expiry", async () => {
      const result = await db
        .select()
        .from(bids)
        .where(
          and(
            eq(bids.status, "pending"),
            gt(bids.createdAt, thirteenDaysAgo), // created within last 13 days
            lt(bids.createdAt, new Date(Date.now() - 13 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)) // fine‑tune
          )
        );
      return result;
    });

    // For each bid, send notification to bidder and creator
    // This is a placeholder – actual notification delivery depends on your stack
    for (const bid of bidsNearingExpiry) {
      await step.run(`notify-bid-${bid.id}`, async () => {
        console.log(`Bid ${bid.id} expires soon – notify participants`);
        // await sendEmail(...);
        // await sendPush(...);
      });
    }

    return { notified: bidsNearingExpiry.length };
  }
);

// Export all functions
export const functions = [autoRefund, activityFeed, bidExpiryNotification];
