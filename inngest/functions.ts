import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db/client";
import { bids, wallets } from "@/lib/db/schema";
import { eq, and, lt, gt, isNull, isNotNull } from "drizzle-orm";
import { executeContractCall, getTransactionStatus } from "@/lib/circle";
import { escrowAbi } from "@/lib/arc";

// ─── Auto‑Refund Cron ─────────────────────────────────────────────────────────
// Runs daily at 03:00 UTC. Calls claimRefund() on-chain from the bidder's wallet for
// pending bids past the escrow's 14-day refund window. The status flips to "refunded"
// when the BidRefunded log arrives at /api/webhooks/circle-events, not here.
const REFUND_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
// The escrow stores createdAt when the bid lands on Arc, which is later than the DB row's
// createdAt. Waiting an extra 2 hours avoids "refund period not passed" reverts.
const REFUND_MARGIN_MS = 2 * 60 * 60 * 1000;
// Circle transaction states that mean the claim will never land, so it can be retried.
const FAILED_TX_STATES = new Set(["FAILED", "DENIED", "CANCELLED"]);

export const autoRefund = inngest.createFunction(
  { id: "auto-refund", name: "Auto-Refund Expired Bids" },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const expiredBefore = new Date(Date.now() - REFUND_PERIOD_MS);
    const claimableBefore = new Date(Date.now() - REFUND_PERIOD_MS - REFUND_MARGIN_MS);

    // 0. Reconcile claims submitted by an earlier run. A settlementTxHash on a still-pending
    //    bid means claimRefund was submitted but BidRefunded never arrived. If Circle says the
    //    transaction failed, clear the hash so the claim step below retries it in this run.
    const submittedClaims = await step.run("fetch-submitted-refund-claims", async () => {
      return db
        .select()
        .from(bids)
        .where(
          and(
            eq(bids.status, "pending"),
            isNotNull(bids.onChainBidId),
            isNotNull(bids.settlementTxHash),
          ),
        )
        .limit(100);
    });

    const reconcileResults = await Promise.allSettled(
      submittedClaims.map(async (bid) => {
        return await step.run(`reconcile-bid-${bid.id}`, async () => {
          const txId = bid.settlementTxHash;
          if (!txId) return { bidId: bid.id, reset: false };

          try {
            const status = await getTransactionStatus(txId);
            if (!FAILED_TX_STATES.has(status.state)) {
              // Still in flight or already confirmed — leave it for the webhook.
              return { bidId: bid.id, reset: false, state: status.state };
            }

            await db
              .update(bids)
              .set({ settlementTxHash: null })
              .where(eq(bids.id, bid.id));

            const reason = [status.errorReason, status.errorDetails].filter(Boolean).join(" — ");
            console.warn(
              `Auto-refund: claim ${txId} for bid ${bid.id} ended in ${status.state}${reason ? `: ${reason}` : ""}; cleared settlementTxHash for retry`,
            );
            return { bidId: bid.id, reset: true, state: status.state, reason: reason || null };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Auto-refund: could not reconcile claim ${txId} for bid ${bid.id}: ${message}`);
            return { bidId: bid.id, reset: false, error: message };
          }
        });
      }),
    );

    const resetCount = reconcileResults.filter(
      (r) => r.status === "fulfilled" && r.value.reset,
    ).length;

    // 1. Bids that can actually be claimed on-chain: synced to a bid id, no settlement
    //    transaction submitted yet, and past the refund window plus the safety margin.
    const refundableBids = await step.run("fetch-refundable-bids", async () => {
      return db
        .select()
        .from(bids)
        .where(
          and(
            eq(bids.status, "pending"),
            isNotNull(bids.onChainBidId),
            isNull(bids.settlementTxHash),
            lt(bids.createdAt, claimableBefore),
          ),
        )
        .limit(100); // batch size
    });

    // 2. Expired bids that never got an on-chain bid id. claimRefund() needs that id, so
    //    these cannot be refunded automatically — report them for manual follow-up.
    const unsyncedBids = await step.run("report-unsynced-expired-bids", async () => {
      const rows = await db
        .select()
        .from(bids)
        .where(
          and(
            eq(bids.status, "pending"),
            isNull(bids.onChainBidId),
            lt(bids.createdAt, expiredBefore),
          ),
        )
        .limit(100);

      for (const bid of rows) {
        console.warn(
          `Auto-refund: bid ${bid.id} (${bid.amountUsdc} USDC) is past the refund window but has no onChainBidId; skipping chain call, left pending`,
        );
      }
      // bid_status has no "failed"/"expired" member, so the status is left as "pending".
      return rows.map((bid) => ({ bidId: bid.id, amountUsdc: bid.amountUsdc }));
    });

    if (refundableBids.length === 0) {
      return { message: "No refundable bids", resetCount, unsyncedCount: unsyncedBids.length, unsynced: unsyncedBids };
    }

    const escrowAddress = process.env.ATTN_ESCROW_CONTRACT;
    if (!escrowAddress) {
      console.error("Auto-refund: ATTN_ESCROW_CONTRACT is not configured, no refunds claimed");
      return {
        message: "ATTN_ESCROW_CONTRACT not configured",
        refundableCount: refundableBids.length,
        resetCount,
        unsyncedCount: unsyncedBids.length,
      };
    }

    // 3. Claim each refund from the bidder's own wallet — the escrow requires
    //    msg.sender == bid.bidder.
    const results = await Promise.allSettled(
      refundableBids.map(async (bid) => {
        return await step.run(`refund-bid-${bid.id}`, async () => {
          try {
            const onChainBidId = bid.onChainBidId;
            if (!onChainBidId) {
              return { bidId: bid.id, success: false, error: "Missing onChainBidId" };
            }

            const wallet = await db.query.wallets.findFirst({
              where: and(eq(wallets.userId, bid.bidderUserId), eq(wallets.state, "active")),
            });
            if (!wallet) {
              console.error(`Auto-refund: no active wallet for bidder ${bid.bidderUserId} (bid ${bid.id})`);
              return { bidId: bid.id, success: false, error: "No active wallet for bidder" };
            }

            const result = await executeContractCall({
              walletId: wallet.circleWalletId,
              contractAddress: escrowAddress,
              abi: escrowAbi,
              functionName: "claimRefund",
              args: [onChainBidId],
            });

            // Record the Circle transaction id only. The webhook sets status "refunded"
            // when BidRefunded is emitted on-chain.
            await db
              .update(bids)
              .set({ settlementTxHash: result.txId })
              .where(eq(bids.id, bid.id));

            console.log(
              `Auto-refund: claimRefund submitted for bid ${bid.id} (${bid.amountUsdc} USDC), circle tx ${result.txId}`,
            );
            return { bidId: bid.id, success: true, txId: result.txId };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Auto-refund: claimRefund failed for bid ${bid.id}: ${message}`);
            return { bidId: bid.id, success: false, error: message };
          }
        });
      }),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.success);
    const failed = results.filter((r) => r.status === "rejected" || !r.value?.success);

    return {
      message: `Submitted ${succeeded.length} of ${refundableBids.length} refund claims`,
      succeeded: succeeded.length,
      failed: failed.length,
      resetCount,
      unsyncedCount: unsyncedBids.length,
      unsynced: unsyncedBids,
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
  { cron: "*/30 * * * *" },
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
      const allPendingBids = await db.select().from(bids).where(
        eq(bids.creatorUserId, creatorUserId)
      ).then(r => r.filter(b => b.status === "pending"));
      const queueDepth = allPendingBids.length;
      const highestBidAmount = allPendingBids.reduce((max, b) => {
        return BigInt(b.amountUsdc) > BigInt(max) ? b.amountUsdc : max;
      }, "0");
      return { bid, profile, wallet, queueDepth, highestBidAmount };
    });

    const { bid, profile, wallet, queueDepth, highestBidAmount } = bidData;
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
        },
        highestBidAmount
      );
    });

    if (triageResult.decision === "counter_offer" && triageResult.counterOfferAmount) {
      await step.run("auto-counter-offer", async () => {
        const { bids: bidsTable } = await import("@/lib/db/schema");
        await db.update(bidsTable).set({
          status: "counter_offered",
          counterOfferAmount: triageResult.counterOfferAmount,
        }).where(eq(bids.id, bidId));

        // Fire event so bidder agent can respond
        await inngest.send({
          name: "attnn/counter.received",
          data: {
            bidId,
            bidderUserId: bid.bidderUserId,
            counterOfferAmount: triageResult.counterOfferAmount,
          },
        });

        return { countered: true, amount: triageResult.counterOfferAmount };
      });
    } else if (triageResult.decision === "accept" && triageResult.draftedReply) {
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
