import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db/client";
import { bids } from "@/lib/db/schema";
import { eq, and, lt, gt, isNull, isNotNull, inArray, ne, sql, gte } from "drizzle-orm";
import { BidError, createBidIntent, declineReplacedBid, submitSettlement } from "@/lib/bids";
import { applyVerdict, classifyOpenRows, indexOnChainBids, loadOpenRows } from "@/lib/reconcile";
import { REFUND_PERIOD_MS } from "@/lib/bid-rules";
import { escrowAddress } from "@/lib/chain";
import { confirmSettlement, listUnsyncedPendingBids, placeBid, sweepInFlightBids } from "./bid-lifecycle";

// ─── Auto-Refund Cron ─────────────────────────────────────────────────────────
// Hourly. Claims refunds for escrowed bids nobody replied to within the escrow's
// 3-day window, from the bidder's own wallet (the contract requires msg.sender ==
// bidder). Counter-offered bids are included: their USDC is still escrowed.
// The bid becomes "refunded" only once the claim is COMPLETE on-chain
// (confirmSettlement / sweep / BidRefunded webhook), never here.

// The escrow stamps createdAt when the bid lands on Arc, a little after the DB row.
// A margin avoids "refund period not passed" reverts.
const REFUND_MARGIN_MS = 30 * 60 * 1000;

export const autoRefund = inngest.createFunction(
  { id: "auto-refund", name: "Auto-Refund Expired Bids" },
  { cron: "17 * * * *" },
  async ({ step }) => {
    const claimableBefore = new Date(Date.now() - REFUND_PERIOD_MS - REFUND_MARGIN_MS);
    const escrow = escrowAddress();
    if (!escrow) return { message: "ATTN_ESCROW_CONTRACT not configured" };

    const refundable = await step.run("fetch-refundable-bids", () =>
      db
        .select({ id: bids.id, bidderUserId: bids.bidderUserId, amountUsdc: bids.amountUsdc, settlementAttempt: bids.settlementAttempt })
        .from(bids)
        .where(
          and(
            inArray(bids.status, ["pending", "counter_offered"]),
            isNotNull(bids.onChainBidId),
            isNull(bids.settlementTxHash),
            lt(bids.createdAt, claimableBefore),
          ),
        )
        .limit(100),
    );

    // Pre-fix rows that never got an on-chain id can't be claimed automatically.
    const unsynced = await step.run("report-unsynced-expired-bids", () =>
      listUnsyncedPendingBids(new Date(Date.now() - REFUND_PERIOD_MS)),
    );

    const results = [];
    for (const bid of refundable) {
      // The attempt number is in the step id so a failed claim is retried next hour
      // with a fresh step (and a fresh Circle idempotency key).
      const r = await step.run(`refund-${bid.id}-${bid.settlementAttempt}`, async () => {
        try {
          const { txId } = await submitSettlement({ bidId: bid.id, action: "refund", actorUserId: bid.bidderUserId });
          return { bidId: bid.id, submitted: true, txId };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`Auto-refund: bid ${bid.id} not claimed: ${message}`);
          return { bidId: bid.id, submitted: false, error: message };
        }
      });
      results.push(r);
    }

    return {
      submitted: results.filter((r) => r.submitted).length,
      skipped: results.filter((r) => !r.submitted).length,
      unsyncedCount: unsynced.length,
      unsynced,
      details: results,
    };
  },
);

// ─── Activity Feed Generator ──────────────────────────────────────────────────
// Placeholder for on-chain activity events (Arc/Alchemy). Not wired up yet.
export const activityFeed = inngest.createFunction(
  { id: "activity-feed", name: "Activity Feed" },
  { event: "arc/bid.placed" },
  async ({ event }) => {
    return { processed: event.name };
  },
);

// ─── Bid Expiry Notifications ────────────────────────────────────────────────
// Daily. Finds escrowed bids that refund within the next 24h. Delivery is not
// built yet (WhatsApp/email are on the roadmap), so this only logs.
export const bidExpiryNotification = inngest.createFunction(
  { id: "bid-expiry-notification", name: "Bid Expiry Notification" },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const now = Date.now();
    const windowStart = new Date(now - REFUND_PERIOD_MS);
    const windowEnd = new Date(now - REFUND_PERIOD_MS + 24 * 60 * 60 * 1000);

    const nearingExpiry = await step.run("fetch-nearing-expiry", () =>
      db
        .select({ id: bids.id })
        .from(bids)
        .where(and(eq(bids.status, "pending"), gt(bids.createdAt, windowStart), lt(bids.createdAt, windowEnd))),
    );
    for (const bid of nearingExpiry) console.log(`Bid ${bid.id} refunds within 24h — notify participants`);
    return { notified: nearingExpiry.length };
  },
);

// ─── Bidder Agent Auto-Runner ─────────────────────────────────────────────────
// Every 30 minutes for every active bidder config.
export const runActiveBidders = inngest.createFunction(
  { id: "run-active-bidders", name: "Run Active Bidder Agents" },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
    const { bidderConfigs } = await import("@/lib/db/schema");
    const { runBidderAgent } = await import("@/lib/agent");

    const activeBidders = await step.run("fetch-active-bidders", () =>
      db.select({ userId: bidderConfigs.userId }).from(bidderConfigs).where(eq(bidderConfigs.isActive, true)),
    );
    if (activeBidders.length === 0) return { message: "No active bidders" };

    const results = [];
    for (const cfg of activeBidders) {
      const r = await step.run(`run-bidder-${cfg.userId}`, async () => {
        try {
          // Re-check isActive in case the user paused after this run started
          const fresh = await db.select({ isActive: bidderConfigs.isActive }).from(bidderConfigs).where(eq(bidderConfigs.userId, cfg.userId)).limit(1);
          if (!fresh[0]?.isActive) return { userId: cfg.userId, skipped: true, reason: "Agent paused" };
          return { userId: cfg.userId, ...(await runBidderAgent(cfg.userId)) };
        } catch (err) {
          return { userId: cfg.userId, error: err instanceof Error ? err.message : String(err) };
        }
      });
      results.push(r);
    }
    return { total: activeBidders.length, results };
  },
);

// ─── Creator Agent Triage ─────────────────────────────────────────────────────
// Triggered by attnn/bid.placed, which is now sent only after the bid is escrowed
// on-chain (onChainBidId known), so there is no chain-sync wait any more.
export const creatorAgentTriage = inngest.createFunction(
  { id: "creator-agent-triage", name: "Creator Agent Triage", concurrency: 5 }, // Inngest plan max is 5; a higher value makes the whole app sync fail
  { event: "attnn/bid.placed" },
  async ({ event, step }) => {
    const { bidId, creatorUserId } = event.data as { bidId: string; creatorUserId: string };

    const bidData = await step.run("fetch-bid", async () => {
      const { profiles } = await import("@/lib/db/schema");
      const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
      const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, creatorUserId) });
      const openBids = await db
        .select({ amountUsdc: bids.amountUsdc })
        .from(bids)
        .where(and(eq(bids.creatorUserId, creatorUserId), eq(bids.status, "pending")));
      const highestBidAmount = openBids.reduce((max, b) => (BigInt(b.amountUsdc) > BigInt(max) ? b.amountUsdc : max), "0");
      return { bid, profile, queueDepth: openBids.length, highestBidAmount };
    });

    const { bid, profile, queueDepth, highestBidAmount } = bidData;
    if (!bid || !profile) return { message: "Missing data — skipping triage" };
    if (bid.status !== "pending") return { message: `Bid is ${bid.status} — skipping triage` };
    if (!bid.onChainBidId) return { message: "Bid has no on-chain id — skipping triage" };

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
        highestBidAmount,
      );
    });

    await step.run("record-score", () => db.update(bids).set({ score: triageResult.score }).where(eq(bids.id, bidId)));

    // A re-bid already meets the creator's own counter price: countering again or
    // declining it would be absurd, so those outcomes just surface it in the inbox.
    if (bid.replacesBidId && (triageResult.decision === "counter_offer" || triageResult.decision === "reject")) {
      triageResult.decision = "surface";
    }

    let action: { submitted: boolean; txId?: string; error?: string } | null = null;

    if (triageResult.decision === "counter_offer" && triageResult.counterOfferAmount) {
      const counterAmount = triageResult.counterOfferAmount;
      const countered = await step.run("auto-counter-offer", async () => {
        const updated = await db
          .update(bids)
          .set({ status: "counter_offered", counterOfferAmount: counterAmount })
          .where(and(eq(bids.id, bidId), eq(bids.status, "pending"), isNull(bids.settlementTxHash)))
          .returning({ id: bids.id });
        return updated.length > 0;
      });
      // Separate step: if sending fails, the retry re-sends instead of finding the
      // row already countered and skipping the event (the bidder would never hear).
      if (countered) {
        await step.sendEvent("notify-counter", {
          name: "attnn/counter.received",
          data: { bidId, bidderUserId: bid.bidderUserId, counterOfferAmount: counterAmount },
        });
      }
    } else if (triageResult.decision === "accept" && triageResult.draftedReply) {
      action = await step.run("auto-accept-bid", async () => {
        try {
          const { txId } = await submitSettlement({ bidId, action: "accept", actorUserId: creatorUserId, reply: triageResult.draftedReply });
          return { submitted: true, txId };
        } catch (err) {
          if (err instanceof BidError) return { submitted: false, error: err.message };
          throw err;
        }
      });
    } else if (triageResult.decision === "reject") {
      action = await step.run("auto-reject-bid", async () => {
        try {
          const { txId } = await submitSettlement({ bidId, action: "reject", actorUserId: creatorUserId });
          return { submitted: true, txId };
        } catch (err) {
          if (err instanceof BidError) return { submitted: false, error: err.message };
          throw err;
        }
      });
    }
    // "surface": score recorded above, left pending for the creator.

    return {
      decision: triageResult.decision,
      score: triageResult.score,
      reason: triageResult.reason,
      onChainBidId: bid.onChainBidId,
      ...(action ? { settlement: action } : {}),
    };
  },
);

// ─── Re-bid escrowed → release the original ───────────────────────────────────
// Sent by notifyBidEscrowed when a bid placed at a creator's counter price is in
// escrow. Declines the countered original from the creator's wallet so the
// bidder's USDC isn't locked twice. If that can't happen (window passed, creator
// already settled it, no gas), the original still refunds through autoRefund.
export const declineReplacedBidJob = inngest.createFunction(
  { id: "decline-replaced-bid", name: "Decline Replaced Bid", retries: 3 },
  { event: "attnn/rebid.escrowed" },
  async ({ event, step }) => {
    const { bidId } = event.data as { bidId: string; replacesBidId: string };
    return step.run("decline-original", () => declineReplacedBid(bidId));
  },
);

// ─── Admin: reconcile open bids with the escrows ──────────────────────────────
// Run by hand from the Inngest dashboard (Send event "attnn/admin.reconcile-bids").
// data: {} for a dry run (report only), { "apply": true } to write the fixes.
// See lib/reconcile.ts for what "linked" and "phantom" mean.
export const reconcileOpenBidsJob = inngest.createFunction(
  { id: "reconcile-open-bids", name: "Admin: Reconcile Open Bids", concurrency: 1, retries: 2 },
  { event: "attnn/admin.reconcile-bids" },
  async ({ event, step }) => {
    const apply = (event.data as { apply?: boolean } | undefined)?.apply === true;
    const rows = await step.run("load-open-bids", () => loadOpenRows());
    if (!rows.length) return { apply, open: 0 };

    const index = await step.run("index-escrows", () => indexOnChainBids(rows.map((r) => r.bidderAddress)));
    const verdicts = classifyOpenRows(rows, index);

    const summarize = (kind: string) => {
      const list = rows.filter((r) => verdicts.get(r.id)?.kind === kind);
      return { count: list.length, usdc: list.reduce((s, r) => s + BigInt(r.amountUsdc), BigInt(0)).toString() };
    };
    const report = {
      apply,
      open: rows.length,
      ok: summarize("ok"),
      linked: summarize("linked"),
      phantom: summarize("phantom"),
      linkedRows: rows
        .filter((r) => verdicts.get(r.id)?.kind === "linked")
        .map((r) => ({ id: r.id, ...(verdicts.get(r.id) as object) })),
      phantomRowIds: rows.filter((r) => verdicts.get(r.id)?.kind === "phantom").map((r) => r.id),
    };
    if (!apply) return report;

    let updated = 0;
    let skipped = 0;
    const toWrite = rows.filter((r) => verdicts.get(r.id)?.kind !== "ok");
    for (let i = 0; i < toWrite.length; i += 50) {
      const batch = toWrite.slice(i, i + 50);
      const res = await step.run(`apply-${i}`, async () => {
        let u = 0;
        let sk = 0;
        for (const r of batch) {
          if ((await applyVerdict(r.id, verdicts.get(r.id)!)) === "updated") u++;
          else sk++;
        }
        return { u, sk };
      });
      updated += res.u;
      skipped += res.sk;
    }
    return { ...report, updated, skipped };
  },
);

// ─── Counter-Offer Handler ────────────────────────────────────────────────────
// The bidder agent accepts a counter if it fits today's budget, by placing a NEW
// bid at the counter amount. The original bid stays counter_offered with its USDC
// escrowed until the creator rejects it or the auto-refund claims it.
export const handleCounterOffer = inngest.createFunction(
  { id: "handle-counter-offer", name: "Handle Counter Offer" },
  { event: "attnn/counter.received" },
  async ({ event, step }) => {
    const { bidId, bidderUserId, counterOfferAmount } = event.data as {
      bidId: string;
      bidderUserId: string;
      counterOfferAmount: string;
    };

    const result = await step.run("place-counter-bid", async () => {
      const { bidderConfigs } = await import("@/lib/db/schema");
      const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
      const config = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, bidderUserId) });
      if (!bid || !config) return { decision: "skip", reason: "Missing data" };
      // The creator may have accepted or declined the original in the meantime.
      if (bid.status !== "counter_offered" || bid.settlementTxHash) {
        return { decision: "skip", reason: `Original bid is ${bid.settlementTxHash ? "settling" : bid.status}` };
      }

      const counterAmount = BigInt(counterOfferAmount);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const [spentRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${bids.amountUsdc} AS BIGINT)), 0)` })
        .from(bids)
        .where(and(eq(bids.bidderUserId, bidderUserId), gte(bids.createdAt, today), ne(bids.status, "failed")));
      const remaining = BigInt(config.dailyBudget) - BigInt(spentRow?.total ?? "0");
      if (counterAmount > remaining) return { decision: "reject", reason: "Counter offer exceeds remaining daily budget" };

      try {
        const intent = await createBidIntent({
          bidderUserId,
          creatorUserId: bid.creatorUserId,
          amountUsdc: counterAmount,
          message: "I accept your counter offer.",
          replacesBidId: bidId,
        });
        return { decision: "accept", newBidId: intent.id };
      } catch (err) {
        if (err instanceof BidError) return { decision: "reject", reason: err.message };
        throw err;
      }
    });

    return result;
  },
);

export const functions = [
  autoRefund,
  activityFeed,
  bidExpiryNotification,
  runActiveBidders,
  creatorAgentTriage,
  handleCounterOffer,
  declineReplacedBidJob,
  reconcileOpenBidsJob,
  placeBid,
  confirmSettlement,
  sweepInFlightBids,
];
