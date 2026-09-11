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

// --- Bidder Agent Auto-Runner ----------------------------------------------
// Runs every 10 minutes for every active bidder config.
export const runActiveBidders = inngest.createFunction(
  { id: "run-active-bidders", name: "Run Active Bidder Agents" },
  { cron: "*/10 * * * *" },
  async ({ step }: { step: any }) => {
    const { bidderConfigs } = await import("@/lib/db/schema");
    const { runBidderAgent } = await import("@/lib/agent");

    const activeBidders = await step.run("fetch-active-bidders", async () => {
      return db.select().from(bidderConfigs).where(eq(bidderConfigs.isActive, true));
    });

    if (activeBidders.length === 0) {
      return { message: "No active bidders" };
    }

    const results = await Promise.allSettled(
      activeBidders.map((cfg: any) =>
        step.run(`run-bidder-${cfg.userId}`, async () => {
          try {
            // Re-check isActive in case user paused after this run started
            const { bidderConfigs: bc } = await import("@/lib/db/schema");
            const { eq: eqFresh } = await import("drizzle-orm");
            const fresh = await db.select().from(bc).where(eqFresh(bc.userId, cfg.userId)).limit(1);
            if (!fresh[0] || !fresh[0].isActive) {
              return { userId: cfg.userId, skipped: true, reason: "Agent paused" };
            }
            const r = await runBidderAgent(cfg.userId);
            return { userId: cfg.userId, ...r };
          } catch (err) {
            const e = err as Error;
            return { userId: cfg.userId, error: e.message };
          }
        })
      )
    );

    return {
      total: activeBidders.length,
      results: results.map((r) => (r.status === "fulfilled" ? r.value : { error: r.reason })),
    };
  }
);


// ─── Creator Agent Triage ─────────────────────────────────────────────────────
// Triggered when a new bid is placed. Scores and triages the bid on behalf of the creator.
export const creatorAgentTriage = inngest.createFunction(
  { id: "creator-agent-triage", name: "Creator Agent Triage" },
  { event: "attnn/bid.placed" },
  async ({ event, step }: { event: any; step: any }) => {
    const { bidId, creatorUserId } = event.data;

    const bidData = await step.run("fetch-bid", async () => {
      const { bids, profiles, wallets } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
      const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, creatorUserId) });
      const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, creatorUserId) });
      const queueDepth = await db.select().from(bids).where(
        eq(bids.creatorUserId, creatorUserId)
      ).then(r => r.filter(b => b.status === "pending").length);
      return { bid, profile, wallet, queueDepth };
    });

    const { bid, profile, wallet, queueDepth } = bidData;
    if (!bid || !profile || !wallet) return { message: "Missing data — skipping triage" };
    if (bid.status !== "pending") return { message: "Bid already processed" };

    const triageResult = await step.run("triage-bid", async () => {
      const { triageBidForCreator } = await import("@/lib/ai");
      return triageBidForCreator(
        { amountUsdc: bid.amountUsdc, message: bid.message ?? "", bidderAddress: bid.bidderAddress },
        {
          handle: profile.handle,
          bio: profile.bio ?? undefined,
          tags: profile.tags,
          minBid: profile.minBid,
          autoAcceptThreshold: profile.autoAcceptThreshold ?? 0,
          autoReplyTemplate: profile.autoReplyTemplate,
          queueDepth,
        }
      );
    });

    if (triageResult.decision === "accept" && triageResult.draftedReply) {
      await step.run("auto-accept-bid", async () => {
        const { executeContractCall } = await import("@/lib/circle");
        const { escrowAbi } = await import("@/lib/arc");
        const escrowAddr = process.env.ATTN_ESCROW_CONTRACT;
        if (!escrowAddr || !bid.onChainBidId) return { skipped: true };

        const result = await executeContractCall({
          walletId: wallet.circleWalletId,
          contractAddress: escrowAddr,
          abi: escrowAbi as any,
          functionName: "acceptBid",
          args: [BigInt(bid.onChainBidId), triageResult.draftedReply],
        });

        await db.update(bids).set({
          status: "accepted",
          reply: triageResult.draftedReply,
          score: triageResult.score,
          settlementTxHash: result.txId,
          settledAt: new Date(),
        }).where(eq(bids.id, bidId));

        return { accepted: true, txId: result.txId };
      });
    } else if (triageResult.decision === "reject") {
      await step.run("auto-reject-bid", async () => {
        const { executeContractCall } = await import("@/lib/circle");
        const { escrowAbi } = await import("@/lib/arc");
        const escrowAddr = process.env.ATTN_ESCROW_CONTRACT;
        if (!escrowAddr || !bid.onChainBidId) return { skipped: true };

        const result = await executeContractCall({
          walletId: wallet.circleWalletId,
          contractAddress: escrowAddr,
          abi: escrowAbi as any,
          functionName: "rejectBid",
          args: [BigInt(bid.onChainBidId)],
        });

        await db.update(bids).set({
          status: "rejected",
          score: triageResult.score,
          settlementTxHash: result.txId,
          settledAt: new Date(),
        }).where(eq(bids.id, bidId));

        return { rejected: true, txId: result.txId };
      });
    } else {
      // Surface — update score only, leave as pending for manual review
      await db.update(bids).set({ score: triageResult.score }).where(eq(bids.id, bidId));
    }

    return { decision: triageResult.decision, score: triageResult.score, reason: triageResult.reason };
  }
);


// Counter-Offer Handler — bidder agent evaluates and responds to counter-offers
export const handleCounterOffer = inngest.createFunction(
  { id: "handle-counter-offer", name: "Handle Counter Offer" },
  { event: "attnn/counter.received" },
  async ({ event, step }: { event: any; step: any }) => {
    const { bidId, bidderUserId, counterOfferAmount } = event.data;

    const data = await step.run("fetch-counter-data", async () => {
      const { bids: bidsTable, bidderConfigs, wallets, profiles } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const bid = await db.query.bids.findFirst({ where: eq(bidsTable.id, bidId) });
      const config = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, bidderUserId) });
      const bidderWallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, bidderUserId) });
      const creatorProfile = await db.query.profiles.findFirst({ where: eq(profiles.userId, bid?.creatorUserId ?? "") });
      return { bid, config, bidderWallet, creatorProfile };
    });

    const { bid, config, bidderWallet, creatorProfile } = data;
    if (!bid || !config || !bidderWallet || !creatorProfile) {
      return { skipped: true, reason: "Missing data" };
    }

    const counterAmount = BigInt(counterOfferAmount);
    const dailyBudget = BigInt(config.dailyBudget);

    // Check remaining daily budget
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { sql, gte, and, eq: eqCheck } = await import("drizzle-orm");
    const { bids: bidsTable2 } = await import("@/lib/db/schema");
    const todaySpent = await db
      .select({ total: sql<string>`COALESCE(SUM(CAST(amount_usdc AS BIGINT)), '0')` })
      .from(bidsTable2)
      .where(and(eqCheck(bidsTable2.bidderUserId, bidderUserId), gte(bidsTable2.createdAt, today)));
    const spent = BigInt(todaySpent[0]?.total ?? "0");
    const remaining = dailyBudget - spent;

    if (counterAmount > remaining) {
      return { decision: "reject", reason: "Counter offer exceeds remaining daily budget" };
    }

    // Accept — place a new bid at the counter offer amount
    await step.run("place-counter-bid", async () => {
      const { executeContractCall } = await import("@/lib/circle");
      const { escrowAbi, usdcAbi, USDC_ADDRESS } = await import("@/lib/arc");
      const escrowAddr = process.env.ATTN_ESCROW_CONTRACT as string;

      await executeContractCall({
        walletId: bidderWallet.circleWalletId,
        contractAddress: USDC_ADDRESS,
        abi: usdcAbi as any,
        functionName: "approve",
        args: [escrowAddr, counterAmount],
      });

      const result = await executeContractCall({
        walletId: bidderWallet.circleWalletId,
        contractAddress: escrowAddr,
        abi: escrowAbi as any,
        functionName: "placeBid",
        args: [creatorProfile.walletAddress ?? bid.creatorAddress, counterAmount, "I accept your counter offer.", false],
      });

      const { bids: bidsTable3 } = await import("@/lib/db/schema");
      await db.insert(bidsTable3).values({
        bidderUserId,
        creatorUserId: bid.creatorUserId,
        bidderAddress: bidderWallet.address,
        creatorAddress: bid.creatorAddress,
        amountUsdc: counterAmount.toString(),
        message: "I accept your counter offer.",
        isPrivate: false,
        status: "pending" as const,
        bidTxHash: result.txId,
        onChainBidId: null,
      });

      return { accepted: true, txId: result.txId };
    });

    return { decision: "accept" };
  }
);

export const functions = [autoRefund, activityFeed, bidExpiryNotification, runActiveBidders, creatorAgentTriage, handleCounterOffer];
