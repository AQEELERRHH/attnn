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
import { replyError, type ReplySource } from "./reply-rules";
import { agentWallet, mainWallet, walletByAddress } from "./wallets";
import { parseEventLogs, type Hex } from "viem";
import { db } from "./db/client";
import { bids, profiles } from "./db/schema";
import { escrowAbi, publicClient, usdcAbi, USDC_ADDRESS } from "./arc";
import {
  acceptBidArgs,
  escrowAbiFor,
  escrowVersion,
  matchesFingerprint,
  newSalt,
  readEscrowBid,
  type EscrowBidView,
} from "./escrow";
import { escrowAddress, knownEscrowAddresses } from "./chain";
import {
  classifyTxState,
  describeTxFailure,
  executeContractCallOnce,
  findTransactionByRefId,
  getTransactionStatus,
  rejectedByCircle,
} from "./circle";
import {
  ONCHAIN_STATUS,
  REFUND_PERIOD_MS,
  formatUsd,
  validateBidAmount,
} from "./bid-rules";
import { inngest } from "./inngest";
import { PAUSED_MESSAGE, bidsPaused } from "./app-settings";
import { assertWithinAllowance, lockAllowance, type ApproveOverAllowance } from "./withdrawals";

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


// ─── Placement ───────────────────────────────────────────────────────────────

export interface BidIntentInput {
  bidderUserId: string;
  creatorUserId: string;
  amountUsdc: string | bigint;
  message?: string | null;
  isPrivate?: boolean;
  score?: number | null;
  /** The countered bid this one answers (counter handler only). */
  replacesBidId?: string | null;
  /**
   * Bid from the bidder's agent wallet (the bidder agent and its counter re-bids)
   * instead of their main wallet (bids they place themselves).
   */
  fromAgentWallet?: boolean;
  /**
   * Bids placed by hand: asked only if this bid is over the shared 24-hour allowance,
   * with its exact amount (lib/withdrawals.ts approveWithCode consumes the emailed code).
   */
  approveOverAllowance?: ApproveOverAllowance;
  /** Bids placed by hand: makes a retried request return the same bid (bids.request_key). */
  requestKey?: string;
}

/**
 * Validates a bid and records it as "placing". Nothing is sent on-chain here;
 * the placeBid Inngest function does that. Throws BidError for anything the
 * user can fix (bad amount, inactive creator, not enough USDC).
 */
export async function createBidIntent(input: BidIntentInput): Promise<BidRow> {
  // Operations can stop all new bids at once (docs/RUNBOOK.md). Settlements still work.
  if (await bidsPaused()) throw new BidError(PAUSED_MESSAGE, 503);

  // A countered bid gets at most one re-bid (unique index); a retried counter
  // handler gets the existing one back instead of escrowing twice.
  if (input.replacesBidId) {
    const existing = await db.query.bids.findFirst({ where: eq(bids.replacesBidId, input.replacesBidId) });
    if (existing) return existing;
  }

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
    input.fromAgentWallet ? agentWallet(input.bidderUserId) : mainWallet(input.bidderUserId),
    mainWallet(input.creatorUserId),
  ]);
  if (!bidderWallet) {
    throw new BidError(input.fromAgentWallet ? "Your agent has no wallet yet. Create it on the Agent tab." : "You need a wallet before bidding", 400);
  }
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
        `Not enough USDC: your ${input.fromAgentWallet ? "agent wallet" : "wallet"} has ${formatUsd(balance)}, this bid needs ${formatUsd(amount)} plus a little for network fees`,
      );
    }
  } catch (err) {
    if (err instanceof BidError) throw err;
    // RPC hiccup: don't block the bid. If funds really are short, placement fails cleanly.
    console.warn("createBidIntent: balance check skipped:", err);
  }

  const values = {
    bidderUserId: input.bidderUserId,
    creatorUserId: input.creatorUserId,
    bidderAddress: bidderWallet.address,
    creatorAddress: creatorWallet.address,
    amountUsdc: amount.toString(),
    message: input.message || null,
    // The message's on-chain fingerprint is keccak256(salt ‖ message) (lib/escrow.ts).
    messageSalt: input.message ? newSalt() : null,
    isPrivate: input.isPrivate ?? false,
    score: input.score ?? null,
    status: "placing" as const,
    escrowAddress: escrow,
    replacesBidId: input.replacesBidId ?? null,
  };
  const replacesBidId = input.replacesBidId;
  let existed = false;
  const manual = !input.fromAgentWallet && !replacesBidId;
  const [row] = manual
    ? // A bid placed by hand from the main wallet counts against the shared 24-hour
      // allowance (D4), checked and recorded under the same per-user lock as sends.
      await db.transaction(async (tx) => {
        await lockAllowance(tx, input.bidderUserId);
        if (input.requestKey) {
          const already = await tx.query.bids.findFirst({ where: eq(bids.requestKey, input.requestKey) });
          if (already) {
            if (already.bidderUserId !== input.bidderUserId) throw new BidError("Invalid request id. Reload the page and try again.");
            existed = true;
            return [already];
          }
        }
        await assertWithinAllowance(tx, input.bidderUserId, amount, { approve: input.approveOverAllowance, canConfirm: true });
        return tx.insert(bids).values({ ...values, requestKey: input.requestKey ?? null }).returning();
      })
    : replacesBidId
    ? // A re-bid locks the countered original and only goes ahead while it is still
      // countered with no settlement on its way. submitSettlement takes the same lock
      // before reserving an accept, so the creator can't accept the original while the
      // re-bid is created: the bidder is never charged for both.
      await db.transaction(async (tx) => {
        await tx.execute(sql`select ${bids.id} from ${bids} where ${bids.id} = ${replacesBidId} for update`);
        // Two handler runs at once: the second gets the first's re-bid back.
        const already = await tx.query.bids.findFirst({ where: eq(bids.replacesBidId, replacesBidId) });
        if (already) {
          existed = true;
          return [already];
        }
        const original = await tx.query.bids.findFirst({ where: eq(bids.id, replacesBidId) });
        if (!original || original.status !== "counter_offered" || original.settlementTxHash) {
          throw new BidError("The countered bid was already settled, so no re-bid was placed");
        }
        return tx.insert(bids).values(values).returning();
      })
    : await db.insert(bids).values(values).returning();
  if (!row) throw new BidError("Could not record the bid", 500);
  // Already created (and queued) by an earlier run: don't queue it twice.
  if (existed) return row;

  try {
    await inngest.send({
      name: "attnn/bid.requested",
      data: { bidId: row.id, bidderUserId: row.bidderUserId },
    });
  } catch (err) {
    await db
      .update(bids)
      .set({ status: "failed", failReason: "Could not queue the bid for placement. No USDC moved." })
      .where(and(eq(bids.id, row.id), eq(bids.status, "placing"), isNull(bids.bidTxHash)));
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
export async function notifyBidEscrowed(bid: Pick<BidRow, "id" | "creatorUserId" | "replacesBidId">): Promise<void> {
  await inngest.send([
    { name: "attnn/bid.placed", data: { bidId: bid.id, creatorUserId: bid.creatorUserId } },
    // A re-bid at the creator's counter price is now escrowed: release the original.
    ...(bid.replacesBidId
      ? [{ name: "attnn/rebid.escrowed", data: { bidId: bid.id, replacesBidId: bid.replacesBidId } }]
      : []),
  ]);
}

/** Statuses of a re-bid that still stands in for the bid it replaced. */
const LIVE_REBID: BidRow["status"][] = ["placing", "pending", "counter_offered", "accepted"];

/** The live re-bid placed at this bid's counter price, if any. */
export async function findLiveRebid(bidId: string): Promise<BidRow | null> {
  const rebid = await db.query.bids.findFirst({
    where: and(eq(bids.replacesBidId, bidId), inArray(bids.status, LIVE_REBID)),
  });
  return rebid ?? null;
}

export type DeclineReplacedOutcome = "submitted" | "skipped";

/**
 * Declines the countered bid that an escrowed re-bid replaces, from the
 * creator's wallet, so the bidder gets that USDC back now instead of after 3
 * days. Skips (never throws a BidError) when the original already moved on:
 * the creator settled it, it is past its window (autoRefund handles it), or
 * another settlement is in flight.
 */
export async function declineReplacedBid(rebidId: string): Promise<{ outcome: DeclineReplacedOutcome; reason: string }> {
  const rebid = await db.query.bids.findFirst({ where: eq(bids.id, rebidId) });
  if (!rebid?.replacesBidId) return { outcome: "skipped", reason: "Not a re-bid" };
  if (rebid.status !== "pending" && rebid.status !== "counter_offered" && rebid.status !== "accepted") {
    return { outcome: "skipped", reason: `Re-bid is ${rebid.status}` };
  }
  const original = await db.query.bids.findFirst({ where: eq(bids.id, rebid.replacesBidId) });
  if (!original) return { outcome: "skipped", reason: "Original bid not found" };
  if (original.status !== "counter_offered") return { outcome: "skipped", reason: `Original is ${original.status}` };
  if (original.settlementTxHash) return { outcome: "skipped", reason: "Original already has a settlement in flight" };

  try {
    await submitSettlement({ bidId: original.id, action: "reject", actorUserId: original.creatorUserId });
    return { outcome: "submitted", reason: `Declined ${formatUsd(BigInt(original.amountUsdc))} bid replaced by ${formatUsd(BigInt(rebid.amountUsdc))}` };
  } catch (err) {
    if (err instanceof BidError) return { outcome: "skipped", reason: err.message };
    throw err; // transient (RPC, Circle): let the job retry
  }
}

// ─── Settlement ──────────────────────────────────────────────────────────────

const SETTLEABLE: BidRow["status"][] = ["pending", "counter_offered"];

/** settlementTxHash holds this sentinel between reserving a bid and Circle returning an id. */
const RESERVATION_PREFIX = "reserved:";
const RESERVATION_STALE_MS = 5 * 60 * 1000;
const isReservation = (v: string | null | undefined) => !!v && v.startsWith(RESERVATION_PREFIX);
/** An accept that didn't go through leaves no reply behind on the still-open bid. */
const CLEAR_REPLY = (action: SettlementAction) =>
  action === "accept" ? { reply: null, replySalt: null, replySource: null } : {};
const settlementOpKey = (bidId: string, action: SettlementAction, attempt: number) =>
  `settle:${bidId}:${action}:${attempt}`;

const CHAIN_FINAL: Record<number, BidRow["status"]> = {
  [ONCHAIN_STATUS.Accepted]: "accepted",
  [ONCHAIN_STATUS.Rejected]: "rejected",
  [ONCHAIN_STATUS.Refunded]: "refunded",
};

/** True when the escrow's bid N is this row's bid (ids restart at 1 in every deployment). */
function sameBid(onChain: EscrowBidView, bid: Pick<BidRow, "bidderAddress" | "creatorAddress" | "amountUsdc">): boolean {
  return (
    lower(onChain.bidder) === lower(bid.bidderAddress) &&
    lower(onChain.creator) === lower(bid.creatorAddress) &&
    onChain.amount.toString() === bid.amountUsdc
  );
}

type ReplyFields = { reply: string | null; replySalt?: string | null; replySource?: ReplySource | null; replyCandidates?: null };

/**
 * The reply to record for a bid accepted on a v2 escrow with this fingerprint: the
 * current reply or any earlier attempt's (bids.replyCandidates) whose fingerprint
 * matches. None matches → no reply is shown, never one the bidder didn't pay for.
 * Settled, so the candidates list is dropped either way.
 */
export function pickReply(
  replyHash: string | null | undefined,
  bid: Pick<BidRow, "id" | "reply" | "replySalt" | "replySource" | "replyCandidates">,
): ReplyFields {
  const candidates = [
    { reply: bid.reply, salt: bid.replySalt, source: bid.replySource as string | null },
    ...(bid.replyCandidates ?? []),
  ];
  const hit = candidates.find((c) => matchesFingerprint(replyHash, c.salt, c.reply));
  if (hit) return { reply: hit.reply, replySalt: hit.salt, replySource: (hit.source as ReplySource | null) ?? null, replyCandidates: null };
  if (replyHash) console.error(`pickReply: bid ${bid.id}: no saved reply matches the on-chain fingerprint ${replyHash}`);
  return { reply: null, replySalt: null, replySource: null, replyCandidates: null };
}

/** Reply fields for a bid the escrow shows as accepted (v1: the text on-chain is what was paid for). */
function acceptedReply(onChain: EscrowBidView, bid: BidRow): ReplyFields {
  if (onChain.replyText !== null) return { reply: onChain.replyText || null, replyCandidates: null };
  return pickReply(onChain.replyHash, bid);
}

/**
 * The escrow contract that holds this bid. Rows created before escrow_address
 * existed have it NULL and may live in an earlier deployment, so the known
 * escrows are checked on-chain for a bid with this id, bidder, creator and
 * amount, and the match is saved on the row. Returns null if none matches.
 */
export async function resolveBidEscrow(bid: BidRow): Promise<string | null> {
  if (bid.escrowAddress) return bid.escrowAddress;
  if (!bid.onChainBidId) return null;
  for (const candidate of knownEscrowAddresses()) {
    const onChain = await readEscrowBid(candidate, bid.onChainBidId);
    if (sameBid(onChain, bid)) {
      await db.update(bids).set({ escrowAddress: candidate }).where(and(eq(bids.id, bid.id), isNull(bids.escrowAddress)));
      return candidate;
    }
  }
  return null;
}

/** Refund period of an escrow deployment (3 days now, 14 in the original). Cached per address. */
const refundPeriodCache = new Map<string, number>();
async function refundPeriodMs(escrow: string): Promise<number> {
  const key = lower(escrow);
  const cached = refundPeriodCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const seconds = await publicClient.readContract({ address: escrow as Hex, abi: escrowAbi, functionName: "REFUND_PERIOD" });
    const ms = Number(seconds) * 1000;
    refundPeriodCache.set(key, ms);
    return ms;
  } catch {
    return REFUND_PERIOD_MS; // not cached, so it's re-read next time
  }
}

/**
 * After a settlement of ours fails, the escrow may still be final because a
 * DIFFERENT transaction settled it (a race, or someone acting outside the app).
 * Reads the escrow and, if the bid is no longer Pending there, writes that status.
 */
async function reconcileFromEscrow(bid: BidRow): Promise<boolean> {
  const escrow = await resolveBidEscrow(bid);
  if (!escrow || !bid.onChainBidId) return false;
  const onChain = await readEscrowBid(escrow, bid.onChainBidId);
  if (!sameBid(onChain, bid)) return false;
  const finalStatus = CHAIN_FINAL[onChain.status];
  if (!finalStatus) return false;
  // The settling transaction's hash, so the row counts as verified (not "Unverified").
  const chainTxHash = await findSettlementLog(escrow, bid.onChainBidId, finalStatus).catch(() => null);
  const updated = await db
    .update(bids)
    .set({
      status: finalStatus,
      settledAt: new Date(),
      settlementTxHash: null,
      settlementSubmittedAt: null,
      settlementAction: null,
      failReason: null,
      replyCandidates: null,
      ...(chainTxHash ? { settlementOnChainTxHash: chainTxHash } : {}),
      // What the escrow holds is what the bidder paid for.
      ...(finalStatus === "accepted" ? acceptedReply(onChain, bid) : {}),
    })
    .where(and(eq(bids.id, bid.id), inArray(bids.status, SETTLEABLE)))
    .returning({ id: bids.id });
  return updated.length > 0;
}

const SETTLEMENT_EVENT = { accepted: "BidAccepted", rejected: "BidRejected", refunded: "BidRefunded" } as const;

/**
 * Hash of the transaction that settled this bid, from the escrow's event log.
 * Best-effort: some RPCs limit how far back logs can be read; null then.
 */
async function findSettlementLog(escrow: string, onChainBidId: string, status: BidRow["status"]): Promise<string | null> {
  const eventName = SETTLEMENT_EVENT[status as keyof typeof SETTLEMENT_EVENT];
  if (!eventName) return null;
  const event = escrowAbiFor(await escrowVersion(escrow)).find((x) => x.type === "event" && x.name === eventName);
  if (!event || event.type !== "event") return null;
  const logs = await publicClient.getLogs({
    address: escrow as Hex,
    event,
    args: { bidId: BigInt(onChainBidId) },
    fromBlock: "earliest",
    toBlock: "latest",
  });
  return logs.at(-1)?.transactionHash ?? null;
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
  /** Who wrote the reply (accept only). Defaults to "creator". */
  replySource?: ReplySource;
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
  if (action === "accept" && bid.status === "counter_offered" && (await findLiveRebid(bid.id))) {
    // The bidder already met the counter with a new bid; accepting both would charge them twice.
    throw new BidError("The bidder re-bid at your counter price. Reply to the new bid instead.", 409);
  }
  if (bid.settlementAction && bid.settlementAction !== action) {
    throw new BidError("Another settlement for this bid is already confirming", 409);
  }
  if (bid.settlementTxHash && !isReservation(bid.settlementTxHash)) {
    return { txId: bid.settlementTxHash }; // same action already sent
  }
  // Refuse a too-short reply before any chain reads.
  if (action === "accept") {
    const problem = replyError(params.reply ?? "");
    if (problem) throw new BidError(problem);
  }
  if (!bid.onChainBidId) throw new BidError("This bid has no on-chain id yet", 409);

  // Old rows may sit in an earlier escrow deployment; settle them where they are.
  const escrow = await resolveBidEscrow(bid);
  if (!escrow) throw new BidError("Couldn't find this bid in any known escrow contract. It needs manual review.", 409);
  if (!knownEscrowAddresses().includes(lower(escrow) as Hex)) {
    throw new BidError("This bid lives in an unknown escrow contract and needs manual handling", 409);
  }


  // Check the chain before spending gas, so users get a clear reason.
  const onChain = await readEscrowBid(escrow, bid.onChainBidId);
  // Never act on a different bid that happens to share the id.
  if (!sameBid(onChain, bid)) {
    throw new BidError("The escrow's record for this bid doesn't match. It needs manual review.", 409);
  }
  const { createdAt } = onChain;
  if (onChain.status !== ONCHAIN_STATUS.Pending) {
    // Settled by some other transaction (or before the settlement fix): record what
    // the escrow says instead of leaving the row open forever.
    await reconcileFromEscrow(bid).catch(() => false);
    throw new BidError("This bid is already settled on-chain; it will update shortly", 409);
  }
  const periodMs = await refundPeriodMs(escrow);
  const expiresAt = Number(createdAt) * 1000 + periodMs;
  if (action === "accept" && Date.now() >= expiresAt) {
    throw new BidError(`The ${Math.round(periodMs / 86_400_000)}-day reply window has passed; this bid can only be refunded now`, 409);
  }
  if (action === "refund" && Date.now() < expiresAt) {
    throw new BidError("The refund window hasn't passed yet", 409);
  }

  // Settle from the exact wallet on the bid: a refund of an agent bid goes back to
  // the agent wallet, a manual bid's refund to the main wallet.
  const expected = action === "refund" ? bid.bidderAddress : bid.creatorAddress;
  const actorWallet = await walletByAddress(params.actorUserId, expected);
  if (!actorWallet) throw new BidError("This bid was placed with a wallet you no longer have", 409);

  const fn = action === "accept" ? "acceptBid" : action === "reject" ? "rejectBid" : "claimRefund";
  const version = await escrowVersion(escrow);
  // A retry of our own reservation sends the reply (and salt) saved with it, never a
  // new text: the fingerprint on-chain must match what the database shows.
  const retrying = isReservation(bid.settlementTxHash) && !!bid.reply;
  if (action === "accept" && retrying && version === 2 && !bid.replySalt) {
    throw new BidError("This reply was saved without its fingerprint salt. It needs manual review.", 409);
  }
  const replyText = action === "accept" ? (retrying ? bid.reply! : params.reply!.trim()) : null;
  const replySalt = action === "accept" ? (retrying && bid.replySalt ? bid.replySalt : newSalt()) : null;
  const args = action === "accept" ? acceptBidArgs(version, bid.onChainBidId, replyText!, replySalt!) : [bid.onChainBidId];

  const opKey = settlementOpKey(bid.id, action, bid.settlementAttempt);

  // Reserve the bid for this action BEFORE sending anything, so two different
  // settlements (e.g. agent reject vs manual accept) can never both reach Circle.
  // The sentinel lives in settlementTxHash until Circle returns the real id.
  let reservation = bid.settlementTxHash; // our own earlier reservation (retry)
  if (!reservation) {
    const sentinel = `${RESERVATION_PREFIX}${Date.now()}`;
    // Locked like createBidIntent's re-bid path: an accept can't slip in while a
    // re-bid at the counter price is being created, and vice versa.
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`select ${bids.id} from ${bids} where ${bids.id} = ${bid.id} for update`);
      if (action === "accept") {
        const rebid = await tx.query.bids.findFirst({
          where: and(eq(bids.replacesBidId, bid.id), inArray(bids.status, LIVE_REBID)),
          columns: { id: true },
        });
        if (rebid) return "rebid" as const;
      }
      const reserved = await tx
        .update(bids)
        .set({
          settlementTxHash: sentinel,
          settlementSubmittedAt: new Date(),
          settlementAction: action,
          failReason: null,
          // The reply is saved with the reservation, so the text in the database is
          // always the text sent on-chain, even if two accepts race.
          ...(action === "accept"
            ? {
                reply: replyText!,
                replySalt,
                replySource: params.replySource ?? "creator",
                replyCandidates: sql`coalesce(${bids.replyCandidates}, '[]'::jsonb) || ${JSON.stringify([
                  { reply: replyText!, salt: replySalt!, source: params.replySource ?? "creator" },
                ])}::jsonb`,
              }
            : {}),
        })
        .where(and(eq(bids.id, bid.id), isNull(bids.settlementTxHash), inArray(bids.status, SETTLEABLE)))
        .returning({ id: bids.id });
      return reserved.length ? ("reserved" as const) : ("busy" as const);
    });
    if (outcome === "rebid") throw new BidError("The bidder re-bid at your counter price. Reply to the new bid instead.", 409);
    if (outcome === "busy") throw new BidError("Another settlement for this bid is already confirming", 409);
    reservation = sentinel;
  }

  let txId: string;
  try {
    ({ txId } = await executeContractCallOnce({
      walletId: actorWallet.circleWalletId,
      contractAddress: escrow,
      abi: escrowAbiFor(version),
      functionName: fn,
      args,
      opKey,
    }));
  } catch (err) {
    // The request may still have reached Circle (e.g. a timeout). Only release the
    // reservation if Circle has no transaction for this op key.
    // If Circle can't even be asked, keep the reservation: the request may be on its
    // way, and the 5-minute stale path in finalizeSettlement resolves it by op key.
    const sent = await findTransactionByRefId(actorWallet.circleWalletId, opKey, bid.createdAt).catch(() => "unknown" as const);
    if (sent === "unknown") throw err;
    if (!sent && !rejectedByCircle(err)) {
      // A timeout or network error: the request may have reached Circle even though its
      // list doesn't show it yet. Keep the reservation; finalizeSettlement's stale path
      // resolves it by op key after 5 minutes. Releasing now would let another
      // settlement (or a re-bid at a counter price) race a transaction that may land.
      throw new BidError("Couldn't confirm this with Circle yet. It may still go through: check again in a few minutes.", 503);
    }
    if (!sent) {
      // A new attempt number gives the next try a new op key: if this request did reach
      // Circle after all, a retry can never silently get this transaction back with a
      // different reply. (The contract refuses a second settlement of the same bid.)
      await db
        .update(bids)
        .set({
          settlementTxHash: null,
          settlementSubmittedAt: null,
          settlementAction: null,
          settlementAttempt: sql`${bids.settlementAttempt} + 1`,
          ...CLEAR_REPLY(action),
        })
        .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, reservation)));
      throw err;
    }
    txId = sent.txId;
  }

  await db
    .update(bids)
    .set({ settlementTxHash: txId })
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
    const wallet = await walletByAddress(
      action === "refund" ? bid.bidderUserId : bid.creatorUserId,
      action === "refund" ? bid.bidderAddress : bid.creatorAddress,
    );
    const sent = wallet
      ? await findTransactionByRefId(wallet.circleWalletId, settlementOpKey(bid.id, action, bid.settlementAttempt), bid.createdAt)
      : null;
    if (!sent) {
      const released = await db
        .update(bids)
        .set({
          settlementTxHash: null,
          settlementSubmittedAt: null,
          settlementAction: null,
          settlementAttempt: sql`${bids.settlementAttempt} + 1`,
          ...CLEAR_REPLY(action),
        })
        .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId)))
        .returning({ id: bids.id });
      if (!released.length) return "noop";
      // Another transaction may still have settled it (e.g. ours, if Circle's list lags).
      return (await reconcileFromEscrow(bid).catch(() => false)) ? "settled" : "failed";
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
        settlementSubmittedAt: null,
        settlementAction: null,
        settlementAttempt: sql`${bids.settlementAttempt} + 1`,
        failReason: `${action} failed: ${describeTxFailure(status)}`.slice(0, 500),
        ...CLEAR_REPLY(action),
      })
      .where(and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId)))
      .returning({ id: bids.id });
    if (!cleared.length) return "noop";
    return (await reconcileFromEscrow(bid)) ? "settled" : "failed";
  }

  // COMPLETE always carries a chain hash; without one, check again later rather than
  // record a settlement nobody can verify on Arc.
  if (!status.txHash) return "in_flight";
  let replyFields: ReplyFields | null = null;
  {
    const receipt = await publicClient.getTransactionReceipt({ hash: status.txHash as Hex });
    if (action === "accept" && receipt.status === "success" && bid.escrowAddress) {
      const version = await escrowVersion(bid.escrowAddress);
      const accepted = parseEventLogs({ abi: escrowAbiFor(version), eventName: "BidAccepted", logs: receipt.logs as never }).find(
        (l) => lower(l.address) === lower(bid.escrowAddress!) && l.args.bidId.toString() === bid.onChainBidId,
      );
      const args = accepted?.args as { reply?: string; replyHash?: Hex } | undefined;
      if (version === 1) {
        // The reply the bidder paid for is the one in the BidAccepted log.
        if (args?.reply !== undefined) replyFields = { reply: args.reply || null, replyCandidates: null };
      } else {
        // Keep only a reply whose fingerprint is the one the creator was paid for. No log
        // (shouldn't happen for our own accept): read the fingerprint from the escrow.
        const hash = args?.replyHash ?? (bid.onChainBidId ? (await readEscrowBid(bid.escrowAddress, bid.onChainBidId)).replyHash : null);
        replyFields = pickReply(hash, bid);
      }
    }
    if (receipt.status !== "success") {
      await db
        .update(bids)
        .set({
          settlementTxHash: null,
          settlementSubmittedAt: null,
          settlementAction: null,
          settlementAttempt: sql`${bids.settlementAttempt} + 1`,
          failReason: `${action} reverted on-chain`,
          ...CLEAR_REPLY(action),
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
      replyCandidates: null,
      ...(replyFields ?? {}),
    })
    .where(
      and(eq(bids.id, bid.id), eq(bids.settlementTxHash, circleTxId), inArray(bids.status, SETTLEABLE)),
    )
    .returning({ id: bids.id });
  return settled.length ? "settled" : "noop";
}
