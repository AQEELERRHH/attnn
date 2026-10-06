/**
 * Background jobs that move bids through their on-chain lifecycle.
 * All state changes go through lib/bids.ts; these functions only orchestrate
 * (submit, wait, re-check) so Vercel routes never block on the chain.
 *
 *   attnn/bid.requested        → placeBid       approve → placeBid → finalize
 *   attnn/settlement.submitted → confirmSettlement
 *   cron every 10 min          → sweepInFlightBids (backstop for both)
 */
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db/client";
import { bids, wallets } from "@/lib/db/schema";
import { escrowAbi, publicClient, usdcAbi, USDC_ADDRESS } from "@/lib/arc";
import {
  classifyTxState,
  describeTxFailure,
  executeContractCallOnce,
  findTransactionByRefId,
  getTransactionStatus,
} from "@/lib/circle";
import { failPlacement, finalizePlacement, finalizeSettlement, notifyBidEscrowed } from "@/lib/bids";

/** Wait schedule: quick checks first (Arc finalises in under a second), then slower. */
function waitFor(attempt: number): string {
  return attempt < 6 ? "2s" : "10s";
}
const MAX_CHECKS = 34; // ≈ 6×2s + 28×10s ≈ 5 minutes

export const placeBid = inngest.createFunction(
  {
    id: "place-bid",
    name: "Place Bid On-Chain",
    // One placement at a time per bidder: approve() overwrites the allowance, so two
    // concurrent bids from one wallet could spend each other's approval.
    concurrency: { limit: 1, key: "event.data.bidderUserId" },
    retries: 4,
    onFailure: async ({ event, error }) => {
      const bidId = (event.data.event.data as { bidId?: string }).bidId;
      if (!bidId) return;
      const row = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
      // If placeBid was already submitted, the USDC may be in escrow. Never mark that
      // "failed" (auto-refund skips failed bids); leave it placing for the sweep,
      // which reads the real outcome from Circle and the chain.
      if (!row || row.bidTxHash) return;
      await failPlacement(bidId, `Placement stopped before submitting: ${error.message}. No USDC moved.`);
    },
  },
  { event: "attnn/bid.requested" },
  async ({ event, step }) => {
    const { bidId } = event.data as { bidId: string };

    const bid = await step.run("load-bid", async () => {
      const row = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
      if (!row || row.status !== "placing" || !row.escrowAddress) return null;
      const wallet = await db.query.wallets.findFirst({
        where: and(eq(wallets.userId, row.bidderUserId), eq(wallets.address, row.bidderAddress)),
      });
      if (!wallet) return { missingWallet: true as const };
      return {
        missingWallet: false as const,
        walletId: wallet.circleWalletId,
        bidder: row.bidderAddress,
        creator: row.creatorAddress,
        escrow: row.escrowAddress,
        amount: row.amountUsdc,
        message: row.isPrivate ? "" : (row.message ?? ""),
        isPrivate: row.isPrivate,
        alreadySubmitted: Boolean(row.bidTxHash),
      };
    });
    if (!bid) return { skipped: "bid is not placing" };
    if (bid.missingWallet) {
      await step.run("fail-no-wallet", () => failPlacement(bidId, "Bidder wallet not found. No USDC moved."));
      return { failed: "no wallet" };
    }

    if (!bid.alreadySubmitted) {
      // 1. Approve the escrow to pull exactly this amount, unless it already can.
      const needsApproval = await step.run("check-allowance", async () => {
        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: usdcAbi,
          functionName: "allowance",
          args: [bid.bidder as `0x${string}`, bid.escrow as `0x${string}`],
        });
        return allowance < BigInt(bid.amount);
      });

      if (needsApproval) {
        const approve = await step.run("submit-approve", () =>
          executeContractCallOnce({
            walletId: bid.walletId,
            contractAddress: USDC_ADDRESS,
            abi: usdcAbi,
            functionName: "approve",
            args: [bid.escrow, bid.amount],
            opKey: `approve:${bidId}`,
          }),
        );

        let approved = false;
        for (let i = 0; i < MAX_CHECKS; i++) {
          const s = await step.run(`approve-status-${i}`, async () => {
            const st = await getTransactionStatus(approve.txId);
            return { outcome: classifyTxState(st.state), reason: describeTxFailure(st) };
          });
          if (s.outcome === "complete") { approved = true; break; }
          if (s.outcome === "failed") {
            await step.run("fail-approve", () => failPlacement(bidId, `USDC approval ${s.reason}. No USDC moved.`));
            return { failed: "approve" };
          }
          await step.sleep(`approve-wait-${i}`, waitFor(i));
        }
        if (!approved) {
          await step.run("fail-approve-timeout", () =>
            failPlacement(bidId, "USDC approval was still confirming after 5 minutes, so the bid was not placed. No USDC moved."),
          );
          return { failed: "approve timeout" };
        }
      }

      // 2. Place the bid. The Circle id is stored in the same step so a retry
      //    finds the same transaction (opKey) and records it again.
      const submitted = await step.run("submit-place-bid", async () => {
        // The sweep may have given up on this bid while it waited in the queue.
        const current = await db.query.bids.findFirst({ where: eq(bids.id, bidId), columns: { status: true } });
        if (current?.status !== "placing") return null;
        const res = await executeContractCallOnce({
          walletId: bid.walletId,
          contractAddress: bid.escrow,
          abi: escrowAbi,
          functionName: "placeBid",
          args: [bid.creator, bid.amount, bid.message, bid.isPrivate],
          opKey: `place:${bidId}`,
        });
        const saved = await db
          .update(bids)
          .set({ bidTxHash: res.txId })
          .where(and(eq(bids.id, bidId), eq(bids.status, "placing")))
          .returning({ id: bids.id });
        if (!saved.length) {
          // The sweep failed the row between the check above and Circle accepting the
          // call. placeBid WAS sent, so USDC may be escrowed: track it again instead of
          // leaving a "failed" row that autoRefund would never claim.
          await db
            .update(bids)
            .set({ status: "placing", bidTxHash: res.txId, failReason: null })
            .where(and(eq(bids.id, bidId), eq(bids.status, "failed"), isNull(bids.bidTxHash)));
        }
        return res.txId;
      });
      if (!submitted) return { skipped: "bid is no longer placing" };
    }

    // 3. Wait for COMPLETE, then read bidId from the receipt.
    for (let i = 0; i < MAX_CHECKS; i++) {
      const outcome = await step.run(`finalize-${i}`, () => finalizePlacement(bidId));
      if (outcome === "escrowed") {
        await step.run("notify-creator-agent", async () => {
          const row = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
          if (row) await notifyBidEscrowed(row);
        });
        return { escrowed: true };
      }
      if (outcome === "failed" || outcome === "noop") return { outcome };
      await step.sleep(`place-wait-${i}`, waitFor(i));
    }
    // Still in flight: the transaction may yet land. The sweep finishes it.
    return { inFlight: true };
  },
);

export const confirmSettlement = inngest.createFunction(
  { id: "confirm-settlement", name: "Confirm Bid Settlement", retries: 4 },
  { event: "attnn/settlement.submitted" },
  async ({ event, step }) => {
    const { bidId } = event.data as { bidId: string };
    for (let i = 0; i < MAX_CHECKS; i++) {
      const outcome = await step.run(`finalize-${i}`, () => finalizeSettlement(bidId));
      if (outcome !== "in_flight") return { outcome };
      await step.sleep(`wait-${i}`, waitFor(i));
    }
    return { inFlight: true };
  },
);

/**
 * Backstop: finishes placements and settlements whose own job ran out of time,
 * missed an event, or was interrupted by a deploy.
 */
export const sweepInFlightBids = inngest.createFunction(
  { id: "sweep-in-flight-bids", name: "Sweep In-Flight Bids" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const placing = await step.run("load-placing", () =>
      db
        .select({ id: bids.id, bidTxHash: bids.bidTxHash, createdAt: bids.createdAt })
        .from(bids)
        .where(and(eq(bids.status, "placing"), lt(bids.createdAt, twoMinAgo)))
        .limit(100),
    );

    let escrowed = 0;
    let failed = 0;
    for (const row of placing) {
      const result = await step.run(`placing-${row.id}`, async () => {
        if (!row.bidTxHash) {
          if (new Date(row.createdAt) >= thirtyMinAgo) return "in_flight" as const;
          // Before giving up, ask Circle whether placeBid was sent but its id never
          // got saved (e.g. a crash right after submitting).
          const full = await db.query.bids.findFirst({ where: eq(bids.id, row.id) });
          const wallet = full
            ? await db.query.wallets.findFirst({ where: and(eq(wallets.userId, full.bidderUserId), eq(wallets.address, full.bidderAddress)) })
            : null;
          const sent = wallet ? await findTransactionByRefId(wallet.circleWalletId, `place:${row.id}`) : null;
          if (!sent) {
            await failPlacement(row.id, "Placement never started. No USDC moved.");
            return "failed" as const;
          }
          await db.update(bids).set({ bidTxHash: sent.txId }).where(and(eq(bids.id, row.id), eq(bids.status, "placing")));
        }
        const outcome = await finalizePlacement(row.id);
        if (outcome === "escrowed") {
          const full = await db.query.bids.findFirst({ where: eq(bids.id, row.id) });
          if (full) await notifyBidEscrowed(full);
        }
        return outcome;
      });
      if (result === "escrowed") escrowed++;
      if (result === "failed") failed++;
    }

    const settling = await step.run("load-settling", () =>
      db
        .select({ id: bids.id })
        .from(bids)
        .where(and(inArray(bids.status, ["pending", "counter_offered"]), isNotNull(bids.settlementTxHash)))
        .limit(100),
    );
    let settled = 0;
    for (const row of settling) {
      const outcome = await step.run(`settling-${row.id}`, () => finalizeSettlement(row.id));
      if (outcome === "settled") settled++;
    }

    return { placingChecked: placing.length, escrowed, failed, settlingChecked: settling.length, settled };
  },
);

/** Pending bids whose onChainBidId never synced (only possible for pre-fix rows). */
export async function listUnsyncedPendingBids(olderThan: Date) {
  return db
    .select({ id: bids.id, amountUsdc: bids.amountUsdc })
    .from(bids)
    .where(and(eq(bids.status, "pending"), isNull(bids.onChainBidId), lt(bids.createdAt, olderThan)))
    .limit(100);
}
