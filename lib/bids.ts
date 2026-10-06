/**
 * Bid lifecycle: the ONLY place that moves money-related bid state.
 *
 * Rule: the database never claims something happened on-chain until the Circle
 * transaction is COMPLETE and (for placement) the BidPlaced log has been read from
 * the receipt. Every write below is conditional on the state it expects, so two
 * paths finishing the same bid (Inngest job, sweep cron, Circle webhook) can't
 * double-apply anything.
 *
 *   createBidIntent  → row "placing" + event attnn/bid.requested
 *   (inngest placeBid: approve → wait → placeBid → wait)
 *   finalizePlacement → "pending" with onChainBidId, or "failed" with a reason
 *   submitSettlement → accept / reject / refund sent, bid stays pending ("confirming")
 *   finalizeSettlement → "accepted" / "rejected" / "refunded", or cleared for retry
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { parseEventLogs, type Hex } from "viem";
import { db } from "./db/client";
import { bids, profiles, wallets } from "./db/schema";
import { escrowAbi, publicClient, usdcAbi, USDC_ADDRESS } from "./arc";
import { escrowAddress } from "./chain";
import {
  classifyTxState,
  describeTxFailure,
  executeContractCallOnce,
  findTransactionByRefId,
  getTransactionStatus,
} from "./circle";
import {
  ONCHAIN_STATUS,
  REFUND_PERIOD_MS,
  formatUsd,
  validateBidAmount,
} from "./bid-rules";
import { inngest } from "./inngest";

export type BidRow = typeof bids.$inferSelect;
export type SettlementAction = "accept" | "reject" | "refund";

/** An error safe to show the user, with the HTTP status a route should return. */
export class BidError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "BidError";
  }
}

const lower = (a: string) => a.toLowerCase();

async function walletFor(userId: string) {
  // Prefer an active wallet; fall back to any wallet for older rows without state.
  const active = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, userId), eq(wallets.state, "active")),
  });
  return active ?? (await db.query.wallets.findFirst({ where: eq(wallets.userId, userId) }));
}

// ─── Placement ───────────────────────────────────────────────────────────────

export interface BidIntentInput {
  bidderUserId: string;
  creatorUserId: string;
  amountUsdc: string | bigint;
  message?: string | null;
  isPrivate?: boolean;
  score?: number | null;
}

/**
 * Validates a bid and records it as "placing". Nothing is sent on-chain here;
 * the placeBid Inngest function does that. Throws BidError for anything the
 * user can fix (bad amount, inactive creator, not enough USDC).
 */
export async function createBidIntent(input: BidIntentInput): Promise<BidRow> {
  const escrow = escrowAddress();
  if (!escrow) throw new BidError("Escrow contract is not configured", 500);
  if (input.bidderUserId === input.creatorUserId) throw new BidError("You can't bid on yourself");

  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, input.creatorUserId) });
  if (!profile) throw new BidError("Creator not found", 404);
  if (!profile.isActive || profile.availabilityStatus === "not_accepting") {
    throw new BidError("This creator isn't accepting bids right now");
  }

  const check = validateBidAmount(
    typeof input.amountUsdc === "bigint" ? input.amountUsdc : String(input.amountUsdc).trim(),
    profile.minBid,
  );
  if (!check.ok) throw new BidError(check.error);
  const amount = check.amount;

  const [bidderWallet, creatorWallet] = await Promise.all([
    walletFor(input.bidderUserId),
    walletFor(input.creatorUserId),
  ]);
  if (!bidderWallet) throw new BidError("You need a wallet before bidding", 400);
  if (!creatorWallet) throw new BidError("Creator has no wallet", 404);

  // Fail fast on an underfunded wallet instead of burning a reverted transaction.
  // Arc gas is also paid in USDC, so the wallet needs a little more than the bid.
  try {
    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [bidderWallet.address as Hex],
    });
    if (balance <= amount) {
      throw new BidError(
        `Not enough USDC: your wallet has ${formatUsd(balance)}, this bid needs ${formatUsd(amount)} plus a little for network fees`,
      );
    }
  } catch (err) {
    if (err instanceof BidError) throw err;
    // RPC hiccup: don't block the bid. If funds really are short, placement fails cleanly.
    console.warn("createBidIntent: balance check skipped:", err);
  }

  const [row] = await db
    .insert(bids)
    .values({
      bidderUserId: input.bidderUserId,
      creatorUserId: input.creatorUserId,
      bidderAddress: bidderWallet.address,
      creatorAddress: creatorWallet.address,
      amountUsdc: amount.toString(),
      message: input.message ?? null,
      isPrivate: input.isPrivate ?? false,
      score: input.score ?? null,
      status: "placing",
      escrowAddress: escrow,
    })
    .returning();
  if (!row) throw new BidError("Could not record the bid", 500);

  try {
    await inngest.send({
      name: "attnn/bid.requested",
      data: { bidId: row.id, bidderUserId: row.bidderUserId },
    });
  } catch (err) {
    await db
      .update(bids)
      .set({ status: "failed", failReason: "Could not queue the bid for placement. No USDC moved." })
      .where(and(eq(bids.id, row.id), eq(bids.status, "placing")));
    console.error("createBidIntent: inngest.send failed", err);
    throw new BidError("Could not queue the bid. Please try again.", 503);
  }

  return row;
}

/** Marks a placing bid as failed. No-op if it already moved on. */
export async function failPlacement(bidId: string, reason: string): Promise<void> {
  await db
    .update(bids)
    .set({ status: "failed", failReason: reason.slice(0, 500) })
    .where(and(eq(bids.id, bidId), eq(bids.status, "placing")));
}

export type PlacementOutcome = "escrowed" | "failed" | "in_flight" | "noop";

/**
 * Checks the placeBid transaction of a "placing" bid and finishes it:
 *   COMPLETE → read BidPlaced from the receipt → "pending" with onChainBidId
 *   FAILED / CANCELLED / DENIED / reverted → "failed"
 * Returns "escrowed" only to the single caller whose update won, so exactly one
 * caller fires creator triage.
 */
export async function finalizePlacement(bidId: string): Promise<PlacementOutcome> {
  const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
  if (!bid || bid.status !== "placing") return "noop";
  if (!bid.bidTxHash) return "in_flight"; // placeBid not submitted yet

  const status = await getTransactionStatus(bid.bidTxHash);
  const outcome = classifyTxState(status.state);
  if (outcome === "in_flight") return "in_flight";
  if (outcome === "failed") {
    await failPlacement(bid.id, `Bid transaction ${describeTxFailure(status)}. No USDC moved.`);
    return "failed";
  }
  if (!status.txHash) return "in_flight"; // COMPLETE should always carry a hash; check again later

  const receipt = await publicClient.getTransactionReceipt({ hash: status.txHash as Hex });
  if (receipt.status !== "success") {
    await failPlacement(bid.id, "Bid transaction reverted on-chain. No USDC moved.");
    return "failed";
  }

  const escrow = bid.escrowAddress ?? escrowAddress();
  const placed = parseEventLogs({ abi: escrowAbi, eventName: "BidPlaced", logs: receipt.logs }).find(
    (log) =>
      !!escrow &&
      lower(log.address) === lower(escrow) &&
      lower(log.args.bidder) === lower(bid.bidderAddress) &&
      lower(log.args.creator) === lower(bid.creatorAddress),
  );
  if (!placed) {
    await failPlacement(bid.id, "Transaction completed but no matching BidPlaced event was found.");
    return "failed";
  }
  if (placed.args.amount.toString() !== bid.amountUsdc) {
    // Should be impossible: we sent this amount. Record what the chain says.
    console.error(`finalizePlacement: bid ${bid.id} amount ${bid.amountUsdc} != on-chain ${placed.args.amount}`);
  }

  const updated = await db
    .update(bids)
    .set({
      status: "pending",
      onChainBidId: placed.args.bidId.toString(),
      onChainTxHash: status.txHash,
      amountUsdc: placed.args.amount.toString(),
      escrowAddress: lower(escrow!),
      failReason: null,
    })
    .where(and(eq(bids.id, bid.id), eq(bids.status, "placing")))
    .returning({ id: bids.id });

  return updated.length ? "escrowed" : "noop";
}

/** Hands a freshly escrowed bid to the creator's agent. */
export async function notifyBidEscrowed(bid: Pick<BidRow, "id" | "creatorUserId">): Promise<void> {
  await inngest.send({
    name: "attnn/bid.placed",
    data: { bidId: bid.id, creatorUserId: bid.creatorUserId },
  });
}

// ─── Settlement ──────────────────────────────────────────────────────────────

const SETTLEABLE: BidRow["status"][] = ["pending", "counter_offered"];

/** settlementTxHash holds this sentinel between reserving a bid and Circle returning an id. */
const RESERVATION_PREFIX = "reserved:";
const RESERVATION_STALE_MS = 5 * 60 * 1000;
const isReservation = (v: string | null | undefined) => !!v && v.startsWith(RESERVATION_PREFIX);
const settlementOpKey = (bidId: string, action: SettlementAction, attempt: number) =>
  `settle:${bidId}:${action}:${attempt}`;

const CHAIN_FINAL: Record<number, BidRow["status"]> = {
  [ONCHAIN_STATUS.Accepted]: "accepted",
  [ONCHAIN_STATUS.Rejected]: "rejected",
  [ONCHAIN_STATUS.Refunded]: "refunded",
};

/**
 * After a settlement of ours fails, the escrow may still be final because a
 * DIFFERENT transaction settled it (a race, or someone acting outside the app).
 * Reads the escrow and, if the bid is no longer Pending there, writes that status.
 */
async function reconcileFromEscrow(bid: BidRow): Promise<boolean> {
  const escrow = bid.escrowAddress ?? escrowAddress();
  if (!escrow || !bid.onChainBidId) return false;
  const onChain = await publicClient.readContract({
    address: escrow as Hex,
    abi: escrowAbi,
    functionName: "getBid",
    args: [BigInt(bid.onChainBidId)],
  });
  const finalStatus = CHAIN_FINAL[onChain[5]];
  if (!finalStatus) return false;
  const updated = await db
    .update(bids)
    .set({ status: finalStatus, settledAt: new Date(), settlementTxHash: null, settlementAction: null, failReason: null })
    .where(and(eq(bids.id, bid.id), inArray(bids.status, SETTLEABLE)))
    .returning({ id: bids.id });
  return updated.length > 0;
}

/**
 * Sends acceptBid / rejectBid / claimRefund for an escrowed bid. The bid stays
 * pending ("confirming") until finalizeSettlement sees the transaction COMPLETE.
 *
 * Safe to call twice: the same bid + action + attempt maps to one Circle
 * transaction (see executeContractCallOnce).
 */
export async function submitSettlement(params: {
  bidId: string;
  action: SettlementAction;
  /** Who is acting. accept/reject must be the creator, refund the bidder. */
  actorUserId: string;
  reply?: string;
}): Promise<{ txId: string }> {
  const { action } = params;
  const bid = await db.query.bids.findFirst({ where: eq(bids.id, params.bidId) });
  if (!bid) throw new BidError("Bid not found", 404);

  const actorIsCreator = bid.creatorUserId === params.actorUserId;
  const actorIsBidder = bid.bidderUserId === params.actorUserId;
  if ((action === "accept" || action === "reject") && !actorIsCreator) {
    throw new BidError("Only the creator can do that", 403);
  }
  if (action === "refund" && !actorIsBidder) throw new BidError("Only the bidder can claim a refund", 403);

  if (bid.status === "placing") throw new BidError("This bid is still being placed on-chain", 409);
  if (!SETTLEABLE.includes(bid.status)) throw new BidError(`This bid is already ${bid.status}`, 409);
  if (action === "accept" && bid.status !== "pending") throw new BidError("Only pending bids can be accepted", 409);
  if (bid.settlementAction && bid.settlementAction !== action) {
    throw new BidError("Another settlement for this bid is already confirming", 409);
  }
  if (bid.settlementTxHash && !isReservation(bid.settlementTxHash)) {
    return { txId: bid.settlementTxHash }; // same action already sent
  }
  if (!bid.onChainBidId) throw new BidError("This bid has no on-chain id yet", 409);

  const escrow = bid.escrowAddress ?? escrowAddress();
  if (!escrow) throw new BidError("Escrow contract is not configured", 500);
  if (escrowAddress() && lower(escrow) !== escrowAddress()) {
    throw new BidError("This bid lives in a retired escrow contract and needs manual handling", 409);
  }

  if (action === "accept") {
    const reply = params.reply?.trim() ?? "";
    if (reply.length < 10) throw new BidError("Reply must be at least 10 characters");
    if (reply.length > 2000) throw new BidError("Reply must be under 2000 characters");
  }

  // Check the chain before spending gas, so users get a clear reason.
  const [, , , , , onChainStatus, createdAt] = await publicClient.readContract({
    address: escrow as Hex,
    abi: escrowAbi,
    functionName: "getBid",
    args: [BigInt(bid.onChainBidId)],
  });
  if (onChainStatus !== ONCHAIN_STATUS.Pending) {
    throw new BidError("This bid is already settled on-chain; it will update shortly", 409);
  }
  const expiresAt = Number(createdAt) * 1000 + REFUND_PERIOD_MS;
  if (action === "accept" && Date.now() >= expiresAt) {
    throw new BidError("The 3-day reply window has passed; this bid can only be refunded now", 409);
  }
  if (action === "refund" && Date.now() < expiresAt) {
    throw new BidError("The refund window hasn't passed yet", 409);
  }

  const actorWallet = await walletFor(params.actorUserId);
  if (!actorWallet) throw new BidError("Wallet not found", 404);
  const expected = action === "refund" ? bid.bidderAddress : bid.creatorAddress;
  if (lower(actorWallet.address) !== lower(expected)) {
    throw new BidError("Your current wallet isn't the one this bid was placed with", 409);
  }

  const fn = action === "accept" ? "acceptBid" : action === "reject" ? "rejectBid" : "claimRefund";
  const args = action === "accept" ? [bid.onChainBidId, params.reply!.trim()] : [bid.onChainBidId];

  const opKey = settlementOpKey(bid.id, action, bid.settlementAttempt);

  // Reserve the bid for this action BEFORE sending anything, so two different
  // settlements (e.g. agent reject vs manual accept) can never both reach Circle.
  // The sentinel lives in settlementTxHash until Circle returns the real id.
  let reservation = bid.settlementTxHash; // our own earlier reservation (retry)
  if (!reservation) {
    reservation = `${RESERVATION_PREFIX}${Date.now()}`;
    const reserved = await db
      .update(bids)
      .set({ settlementTxHash: reservation, settlementAction: action, failReason: null })
      .where(and(eq(bids.id, bid.id), isNull(bids.settlementTxHash), inArray(bids.status, SETTLEABLE)))
      .returning({ id: bids.id });
    if (!reserved.length) throw new BidError("Another settlement for this bid is already confirming", 409);
  }

  let txId: string;
  try {
    ({ txId } = await executeContractCallOnce({
      walletId: actorWallet.circleWalletId,
      contractAddress: escrow,
      abi: escrowAbi,
      functionName: fn,
      args,
      opKey,
    }));
  } catch (err) {
    // The request may still have reached Circle (e.g. a timeout). Only release the
    // reservation if Circle has no transaction for this op key.
    const sent = await findTransactionByRefId(actorWallet.circleWalletId, opKey).catch(() => null);
    if (!sent) {
      await db
        .update(bids)
        .set({ settlementTxHash: null, settlementAction: null })
        .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, reservation)));
      throw err;
    }
    txId = sent.txId;
  }

  await db
    .update(bids)
    .set({ settlementTxHash: txId, ...(action === "accept" ? { reply: params.reply!.trim() } : {}) })
    .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, reservation)));

  try {
    await inngest.send({ name: "attnn/settlement.submitted", data: { bidId: bid.id } });
  } catch (err) {
    console.warn("submitSettlement: could not queue confirmation; the sweep will pick it up", err);
  }
  return { txId };
}

export type SettlementOutcome = "settled" | "failed" | "in_flight" | "noop";

const FINAL_STATUS: Record<SettlementAction, BidRow["status"]> = {
  accept: "accepted",
  reject: "rejected",
  refund: "refunded",
};

/**
 * Finishes an in-flight settlement. COMPLETE → final status. Failed → the bid goes
 * back to plain pending (escrow untouched) with the reason, ready for a retry.
 */
export async function finalizeSettlement(bidId: string): Promise<SettlementOutcome> {
  const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
  if (!bid || !bid.settlementTxHash || !SETTLEABLE.includes(bid.status)) return "noop";
  // Rows from before settlementAction existed: only the old autoRefund cron wrote a
  // settlementTxHash onto a still-pending bid, so a missing action means a refund claim.
  const action: SettlementAction = bid.settlementAction ?? "refund";

  let circleTxId = bid.settlementTxHash;
  if (isReservation(circleTxId)) {
    // Reserved but the Circle id was never saved (crash mid-submit). Give the
    // submitter time to finish, then look the transaction up by its op key.
    const reservedAt = Number(circleTxId.slice(RESERVATION_PREFIX.length));
    if (Date.now() - reservedAt < RESERVATION_STALE_MS) return "in_flight";
    const wallet = await walletFor(action === "refund" ? bid.bidderUserId : bid.creatorUserId);
    const sent = wallet
      ? await findTransactionByRefId(wallet.circleWalletId, settlementOpKey(bid.id, action, bid.settlementAttempt))
      : null;
    if (!sent) {
      const released = await db
        .update(bids)
        .set({ settlementTxHash: null, settlementAction: null })
        .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId)))
        .returning({ id: bids.id });
      return released.length ? "failed" : "noop";
    }
    await db
      .update(bids)
      .set({ settlementTxHash: sent.txId })
      .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId)));
    circleTxId = sent.txId;
  }

  const status = await getTransactionStatus(circleTxId);
  const outcome = classifyTxState(status.state);
  if (outcome === "in_flight") return "in_flight";

  if (outcome === "failed") {
    const cleared = await db
      .update(bids)
      .set({
        settlementTxHash: null,
        settlementAction: null,
        settlementAttempt: sql`${bids.settlementAttempt} + 1`,
        failReason: `${action} failed: ${describeTxFailure(status)}`.slice(0, 500),
      })
      .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId)))
      .returning({ id: bids.id });
    if (!cleared.length) return "noop";
    return (await reconcileFromEscrow(bid)) ? "settled" : "failed";
  }

  if (status.txHash) {
    const receipt = await publicClient.getTransactionReceipt({ hash: status.txHash as Hex });
    if (receipt.status !== "success") {
      await db
        .update(bids)
        .set({
          settlementTxHash: null,
          settlementAction: null,
          settlementAttempt: sql`${bids.settlementAttempt} + 1`,
          failReason: `${action} reverted on-chain`,
        })
        .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId)));
      return (await reconcileFromEscrow(bid)) ? "settled" : "failed";
    }
  }

  const settled = await db
    .update(bids)
    .set({
      status: FINAL_STATUS[action],
      settledAt: new Date(),
      settlementOnChainTxHash: status.txHash ?? null,
      failReason: null,
    })
    .where(
      and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId), inArray(bids.status, SETTLEABLE)),
    )
    .returning({ id: bids.id });
  return settled.length ? "settled" : "noop";
}
