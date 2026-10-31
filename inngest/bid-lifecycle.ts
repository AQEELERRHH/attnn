/**
 * Background jobs that move bids through their on-chain lifecycle.
 * All state changes go through lib/bids.ts; these functions only orchestrate
 * (submit, wait, re-check) so Vercel routes never block on the chain.
 *
 *   attnn/bid.requested        → placeBid       approve → placeBid → finalize
 *   attnn/settlement.submitted → confirmSettlement
 *   attnn/creator.registering  → confirmRegistration (creator market goes live)
 *   cron every 10 min          → sweepInFlightBids (backstop for all three)
 *   attnn/agent.reads-fund     → fundAgentReads (agent wallet → its Gateway read balance, then
 *                                the agent runs again)
 */
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db/client";
import { agentWallet, walletByAddress } from "@/lib/wallets";
import { agentLogs, bids } from "@/lib/db/schema";
import { arc } from "@/lib/chain";
import { PROFILE_READ_PRICE, gatewayBalance, gatewayWalletAbi } from "@/lib/gateway";
import { publicClient, usdcAbi, USDC_ADDRESS } from "@/lib/arc";
import { escrowAbiFor, escrowVersion, placeBidArgs } from "@/lib/escrow";
import { bidsPaused } from "@/lib/app-settings";
import {
  classifyTxState,
  describeTxFailure,
  executeContractCallOnce,
  findTransactionByRefId,
  getTransactionStatus,
} from "@/lib/circle";
import { failPlacement, finalizePlacement, finalizeSettlement, notifyBidEscrowed } from "@/lib/bids";
import { loadRegisteringUserIds, refreshRegistration } from "@/lib/registration";

/** Wait schedule: quick checks first (Arc finalises in under a second), then slower. */
function waitFor(attempt: number): string {
  return attempt < 6 ? "2s" : "10s";
}
/** How many times a placement re-approves if other bids keep using its approval. */
const APPROVAL_ROUNDS = 3;
const MAX_CHECKS = 34; // ≈ 6×2s + 28×10s ≈ 5 minutes

/**
 * True (and the Circle id recorded) when this bid's placeBid already reached Circle,
 * e.g. a step sent it but crashed before saving the id. Checked before every
 * "failed" verdict in placeBid: a sent placeBid may have escrowed USDC, and a failed
 * row is never auto-refunded.
 */
async function recordIfPlaceSent(bidId: string, walletId: string, createdAt: string): Promise<string | null> {
  const sent = await findTransactionByRefId(walletId, `place:${bidId}`, new Date(createdAt));
  if (!sent) return null;
  await db
    .update(bids)
    .set({ status: "placing", bidTxHash: sent.txId, failReason: null })
    .where(and(eq(bids.id, bidId), inArray(bids.status, ["placing", "failed"]), isNull(bids.bidTxHash)));
  return sent.txId;
}

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
      // The id may simply not have been saved (e.g. the DB write after submitting
      // failed). Ask Circle before claiming no USDC moved; if it can't answer, leave
      // the bid placing for the sweep rather than risk failing an escrowed bid.
      try {
        const wallet = await walletByAddress(row.bidderUserId, row.bidderAddress);
        const sent = wallet ? await findTransactionByRefId(wallet.circleWalletId, `place:${bidId}`, row.createdAt) : null;
        if (sent) {
          await db.update(bids).set({ bidTxHash: sent.txId }).where(and(eq(bids.id, bidId), eq(bids.status, "placing")));
          return;
        }
      } catch (err) {
        console.error(`placeBid onFailure: could not check Circle for ${bidId}; leaving it for the sweep`, err);
        return;
      }
      await failPlacement(bidId, `Placement stopped before submitting: ${error.message}. No USDC moved.`);
    },
  },
  { event: "attnn/bid.requested" },
  async ({ event, step }) => {
    const { bidId } = event.data as { bidId: string };

    const bid = await step.run("load-bid", async () => {
      const row = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
      if (!row || row.status !== "placing" || !row.escrowAddress) return null;
      const wallet = await walletByAddress(row.bidderUserId, row.bidderAddress);
      if (!wallet) return { missingWallet: true as const };
      return {
        missingWallet: false as const,
        walletId: wallet.circleWalletId,
        bidder: row.bidderAddress,
        creator: row.creatorAddress,
        escrow: row.escrowAddress,
        amount: row.amountUsdc,
        message: row.message,
        messageSalt: row.messageSalt,
        alreadySubmitted: Boolean(row.bidTxHash),
        createdAt: row.createdAt.toISOString(),
      };
    });
    if (!bid) return { skipped: "bid is not placing" };
    if (bid.missingWallet) {
      await step.run("fail-no-wallet", () => failPlacement(bidId, "Bidder wallet not found. No USDC moved."));
      return { failed: "no wallet" };
    }

    if (!bid.alreadySubmitted) {
      // Paused (app switch or the escrow contract) while this bid waited in the queue:
      // don't send it. Its own step, run once before anything is sent, and it asks Circle
      // first, so a placeBid sent by an earlier run is never marked "failed".
      const pausedOut = await step.run("check-paused", async () => {
        if (await recordIfPlaceSent(bidId, bid.walletId, bid.createdAt)) return false;
        if (!(await bidsPaused())) return false;
        await failPlacement(bidId, "New bids were paused before this bid was placed. No USDC moved.");
        return true;
      });
      if (pausedOut) return { failed: "paused" };
    }

    if (!bid.alreadySubmitted) {
      // Another bid from this wallet can use up our approval while this run sleeps
      // (Inngest's per-bidder limit doesn't count sleeping runs). So the allowance is
      // re-checked right before placing, and approved again if it was spent: up to
      // APPROVAL_ROUNDS times, always for exactly this bid's amount.
      let placed = false;
      for (let round = 0; round < APPROVAL_ROUNDS && !placed; round++) {
        // Round 0 keeps the original step ids and op key, so runs in flight during a deploy resume cleanly.
        const sfx = round === 0 ? "" : `-r${round}`;

        // 1. Approve the escrow to pull exactly this amount, unless it already can.
        const needsApproval = await step.run(`check-allowance${sfx}`, async () => {
          const allowance = await publicClient.readContract({
            address: USDC_ADDRESS,
            abi: usdcAbi,
            functionName: "allowance",
            args: [bid.bidder as `0x${string}`, bid.escrow as `0x${string}`],
          });
          return allowance < BigInt(bid.amount);
        });

        if (needsApproval) {
          const approve = await step.run(`submit-approve${sfx}`, () =>
            executeContractCallOnce({
              walletId: bid.walletId,
              contractAddress: USDC_ADDRESS,
              abi: usdcAbi,
              functionName: "approve",
              args: [bid.escrow, bid.amount],
              opKey: round === 0 ? `approve:${bidId}` : `approve:${bidId}:${round}`,
            }),
          );

          let approved = false;
          for (let i = 0; i < MAX_CHECKS; i++) {
            const st = await step.run(`approve-status${sfx}-${i}`, async () => {
              const t = await getTransactionStatus(approve.txId);
              return { outcome: classifyTxState(t.state), reason: describeTxFailure(t) };
            });
            if (st.outcome === "complete") { approved = true; break; }
            if (st.outcome === "failed") {
              const sent = await step.run(`fail-approve${sfx}`, async () => {
                const id = await recordIfPlaceSent(bidId, bid.walletId, bid.createdAt);
                if (!id) await failPlacement(bidId, `USDC approval ${st.reason}. No USDC moved.`);
                return id;
              });
              if (!sent) return { failed: "approve" };
              placed = true;
              break;
            }
            await step.sleep(`approve-wait${sfx}-${i}`, waitFor(i));
          }
          if (placed) break;
          if (!approved) {
            const sent = await step.run(`fail-approve-timeout${sfx}`, async () => {
              const id = await recordIfPlaceSent(bidId, bid.walletId, bid.createdAt);
              if (!id) await failPlacement(bidId, "USDC approval was still confirming after 5 minutes, so the bid was not placed. No USDC moved.");
              return id;
            });
            if (!sent) return { failed: "approve timeout" };
            placed = true;
            break;
          }
        }

        // 2. Place the bid. The Circle id is stored in the same step so a retry
        //    finds the same transaction (opKey) and records it again.
        const submitted: unknown = await step.run(`submit-place-bid${sfx}`, async () => {
          // A retry of this step after Circle accepted placeBid (but the id wasn't saved):
          // the approval is spent by our own bid, so don't mistake that for theft. Checked
          // first, so a row the sweep failed in the meantime is tracked again.
          const alreadySent = await recordIfPlaceSent(bidId, bid.walletId, bid.createdAt);
          if (alreadySent) return { txId: alreadySent };
          // The sweep may have given up on this bid while it waited in the queue.
          const current = await db.query.bids.findFirst({ where: eq(bids.id, bidId), columns: { status: true } });
          if (current?.status !== "placing") return { skipped: true as const };
          // Re-check: another placement from this wallet may have used our approval.
          const allowance = await publicClient.readContract({
            address: USDC_ADDRESS,
            abi: usdcAbi,
            functionName: "allowance",
            args: [bid.bidder as `0x${string}`, bid.escrow as `0x${string}`],
          });
          if (allowance < BigInt(bid.amount)) return { reapprove: true as const };
          // v2 escrows get only the message's fingerprint; the text stays in our database.
          const version = await escrowVersion(bid.escrow);
          const res = await executeContractCallOnce({
            walletId: bid.walletId,
            contractAddress: bid.escrow,
            abi: escrowAbiFor(version),
            functionName: "placeBid",
            args: placeBidArgs(version, bid),
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
          return { txId: res.txId };
        });
        // A run memoized before this change returns the Circle id (string) or null.
        if (submitted === null || (typeof submitted === "object" && submitted !== null && "skipped" in submitted)) {
          return { skipped: "bid is no longer placing" };
        }
        if (typeof submitted === "object" && submitted !== null && "reapprove" in submitted) continue;
        placed = true;
      }
      if (!placed) {
        const sent = await step.run("fail-approval-spent", async () => {
          const id = await recordIfPlaceSent(bidId, bid.walletId, bid.createdAt);
          if (!id) {
            await failPlacement(bidId, "Other bids from this wallet kept using the USDC approval, so this bid wasn't placed. No USDC moved. Try again.");
          }
          return id;
        });
        if (!sent) return { failed: "approval spent" };
      }
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

/** Marks a creator's market live once the registry confirms their registration. */
export const confirmRegistration = inngest.createFunction(
  { id: "confirm-registration", name: "Confirm Creator Registration", retries: 4 },
  { event: "attnn/creator.registering" },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string };
    for (let i = 0; i < MAX_CHECKS; i++) {
      const state = await step.run(`check-${i}`, () => refreshRegistration(userId));
      if (state !== "registering") return { state };
      await step.sleep(`wait-${i}`, waitFor(i));
    }
    return { state: "registering" };
  },
);

/**
 * What the sweep has to look at: placements older than two minutes, settlements in
 * flight and creator registrations confirming. Read-only.
 */
export async function loadSweepWork() {
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
  const [placing, settling, registering] = await Promise.all([
    db
      .select({ id: bids.id, bidTxHash: bids.bidTxHash, createdAt: bids.createdAt })
      .from(bids)
      .where(and(eq(bids.status, "placing"), lt(bids.createdAt, twoMinAgo)))
      .limit(100),
    db
      .select({ id: bids.id })
      .from(bids)
      .where(and(inArray(bids.status, ["pending", "counter_offered"]), isNotNull(bids.settlementTxHash)))
      .limit(100),
    loadRegisteringUserIds(),
  ]);
  return { placing, settling, registering };
}

/**
 * Backstop: finishes placements and settlements whose own job ran out of time,
 * missed an event, or was interrupted by a deploy.
 *
 * Inngest bills every step, and most runs find nothing to do. So a read-only check
 * runs first, outside any step: with no work the run ends there (one execution, not
 * four). With work, everything happens in steps exactly as before (one load step,
 * then one step per row), so retries never repeat a finished row.
 */
export const sweepInFlightBids = inngest.createFunction(
  { id: "sweep-in-flight-bids", name: "Sweep In-Flight Bids" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const peek = await loadSweepWork();
    if (!peek.placing.length && !peek.settling.length && !peek.registering.length) return { idle: true };

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const { placing, settling, registering } = await step.run("load-work", loadSweepWork);

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
            ? await walletByAddress(full.bidderUserId, full.bidderAddress)
            : null;
          const sent = wallet && full ? await findTransactionByRefId(wallet.circleWalletId, `place:${row.id}`, full.createdAt) : null;
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

    let settled = 0;
    for (const row of settling) {
      const outcome = await step.run(`settling-${row.id}`, () => finalizeSettlement(row.id));
      if (outcome === "settled") settled++;
    }

    let registered = 0;
    for (const userId of registering) {
      const state = await step.run(`registering-${userId}`, () => refreshRegistration(userId));
      if (state === "active") registered++;
    }

    return {
      placingChecked: placing.length,
      escrowed,
      failed,
      settlingChecked: settling.length,
      settled,
      registeringChecked: registering.length,
      registered,
    };
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

/**
 * Tops up the bidder agent's x402 read balance: the agent wallet approves the Gateway
 * wallet contract for exactly `amount`, then deposits it. Requested by the agent itself
 * when it can't pay for the profiles it wants to read (lib/agent.ts requestTopUp, at most
 * once an hour, READ_TOPUP each). Each step has its own op key, so a retried run never
 * deposits twice; one run per user at a time, so two top-ups can't spend each other's
 * approval. With `resume`, once Gateway shows the deposit, the agent runs again.
 */
export const fundAgentReads = inngest.createFunction(
  { id: "fund-agent-reads", name: "Fund Agent Read Balance", retries: 4, concurrency: { limit: 1, key: "event.data.userId" } },
  { event: "attnn/agent.reads-fund" },
  async ({ event, step }) => {
    const { userId, amount, opKey, resume } = event.data as { userId: string; amount: string; opKey: string; resume?: boolean };
    const wallet = await step.run("wallet", async () => {
      const w = await agentWallet(userId);
      return w ? { id: w.circleWalletId, address: w.address } : null;
    });
    if (!wallet) return { failed: "no agent wallet" };

    const fail = (what: string, reason: string) =>
      step.run(`log-${what}-failed`, async () => {
        await db.insert(agentLogs).values({
          userId,
          action: "error",
          data: { reason: `Adding to the read balance failed at the ${what} step (${reason}). Nothing was deposited.` },
        });
      });

    const calls = [
      { what: "approval", contractAddress: USDC_ADDRESS, abi: usdcAbi, functionName: "approve", args: [arc.gatewayWallet, amount] },
      { what: "deposit", contractAddress: arc.gatewayWallet, abi: gatewayWalletAbi, functionName: "deposit", args: [arc.usdcAddress, amount] },
    ] as const;
    for (const call of calls) {
      const tx = await step.run(`submit-${call.what}`, () =>
        executeContractCallOnce({
          walletId: wallet.id,
          contractAddress: call.contractAddress,
          abi: call.abi,
          functionName: call.functionName,
          args: [...call.args],
          opKey: `${opKey}:${call.what}`,
        }),
      );
      let done = false;
      for (let i = 0; i < MAX_CHECKS && !done; i++) {
        const st = await step.run(`${call.what}-status-${i}`, async () => {
          const t = await getTransactionStatus(tx.txId);
          return { outcome: classifyTxState(t.state), reason: describeTxFailure(t) };
        });
        if (st.outcome === "failed") {
          await fail(call.what, st.reason);
          return { failed: call.what };
        }
        if (st.outcome === "complete") done = true;
        else await step.sleep(`${call.what}-wait-${i}`, waitFor(i));
      }
      if (!done) return { inFlight: call.what };
    }
    if (!resume) return { deposited: amount };

    // Gateway credits a deposit shortly after it lands on Arc; then let the agent read.
    for (let i = 0; i < MAX_CHECKS; i++) {
      const ready = await step.run(`credited-${i}`, async () => (await gatewayBalance(wallet.address)) >= PROFILE_READ_PRICE);
      if (ready) {
        const run = await step.run("run-agent", async () => {
          const { runBidderAgent } = await import("@/lib/agent");
          const r = await runBidderAgent(userId);
          return { bidsPlaced: r.bidsPlaced, creatorsFound: r.creatorsFound };
        });
        return { deposited: amount, run };
      }
      await step.sleep(`credit-wait-${i}`, waitFor(i));
    }
    return { deposited: amount, credited: false };
  },
);
