/**
 * External bid API: an outside AI agent bids on a creator from its OWN wallet.
 * Attnn. never holds that wallet or its keys; the escrow contract accepts a bid from
 * any wallet, and only that wallet can claim its refund.
 *
 *   1. The agent reads the creator's profile over x402 (GET /api/c/<handle>, $0.001),
 *      paying from the wallet it will bid from. That payment is its proof that it
 *      controls the wallet: Circle Gateway only settles a payment that wallet signed.
 *   2. POST /api/v1/bids: createExternalBidIntent checks the same rules a bid placed in
 *      the app gets (pause switch, creator live and accepting, amount within the escrow
 *      limits and at least the creator's floor, on Arc too), keeps the message private
 *      here with a fresh salt, and returns the exact two calls to send: USDC approve and
 *      placeBid(creator, amount, messageHash).
 *   3. The agent sends them itself. recordExternalPlacement then reads the transaction
 *      from Arc (never trusting what the caller says about it): a successful receipt
 *      with a BidPlaced from the current escrow whose bidder, creator and amount match
 *      an open intent, and whose on-chain messageHash is that intent's fingerprint.
 *      Only then is a `bids` row written: "pending", bidder_user_id null. It is
 *      triggered by POST /api/v1/bids/<id>/confirm and by the escrow's BidPlaced
 *      webhook, whichever comes first (one row, whatever the order).
 *   4. From there it is an ordinary escrowed bid: the creator (or their agent) accepts
 *      or declines it. Outside agents' bids are never countered (the agent has no way
 *      to answer one) and Attnn. never claims their refunds: after the escrow's refund
 *      period the agent calls claimRefund itself, and the escrow's BidRefunded event
 *      marks the row refunded.
 *
 * GET /api/v1/bids/<id> needs the intent's access token (returned when it's created):
 * it is the only way to read the reply, which only the bidder may see.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, parseEventLogs, type Hex } from "viem";
import { db } from "./db/client";
import { bids, externalBidIntents, profiles, wallets, x402Payments } from "./db/schema";
import { escrowAbi, publicClient, usdcAbi, USDC_ADDRESS } from "./arc";
import { escrowVersion, fingerprint, newSalt, readEscrowBid } from "./escrow";
import { escrowAddress } from "./chain";
import { ONCHAIN_STATUS, formatUsd, validateBidAmount } from "./bid-rules";
import { PAUSED_MESSAGE, bidsPaused } from "./app-settings";
import { registryMinBid } from "./registration";
import { mainWallet } from "./wallets";
import { handleIs } from "./profiles";
import { BidError, notifyBidEscrowed, type BidRow } from "./bids";
import { PROFILE_READ_TTL_MS } from "./gateway";

/** Longest bid message, the same as a bid placed in the app. */
export const EXTERNAL_MESSAGE_MAX = 2000;

/** Intents one wallet may have waiting (not yet escrowed) over the last 24 hours. */
export const MAX_OPEN_INTENTS = 10;

const lower = (a: string) => a.toLowerCase();

// ─── Access token ────────────────────────────────────────────────────────────

function tokenSecret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new BidError("The bid API isn't configured on this server", 503);
  return s;
}

/**
 * The intent's access token: HMAC(AUTH_SECRET, intent id). Nothing is stored, and a
 * retried create (same Idempotency-Key) gets the same token back.
 */
export function intentToken(intentId: string): string {
  return createHmac("sha256", tokenSecret()).update(`external-bid:${intentId}`).digest("hex");
}

/** Constant-time check of a presented token against the intent's. */
export function tokenMatches(intentId: string, presented: string | null | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(intentToken(intentId), "utf8");
  const given = Buffer.from(presented.trim(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ─── Creating an intent ──────────────────────────────────────────────────────

export type IntentRow = typeof externalBidIntents.$inferSelect;

export interface ExternalBidRequest {
  handle: unknown;
  amount: unknown;
  message?: unknown;
  bidder: unknown;
  /** From the Idempotency-Key header: a retried request returns the same intent. */
  idempotencyKey?: string | null;
}

/** The two calls the agent sends from its own wallet, in order. */
export interface CallToSend {
  to: Hex;
  data: Hex;
  value: "0";
  description: string;
}

/**
 * Validates an outside agent's bid and records it as an intent. Nothing moves: the agent
 * sends the returned calls itself. Throws BidError for anything the caller can fix.
 */
export async function createExternalBidIntent(req: ExternalBidRequest): Promise<{ intent: IntentRow; created: boolean }> {
  if (await bidsPaused()) throw new BidError(PAUSED_MESSAGE, 503);

  if (typeof req.bidder !== "string" || !isAddress(req.bidder, { strict: false })) {
    throw new BidError("bidder must be the 0x address of the wallet you will bid from");
  }
  const bidder = lower(req.bidder);
  if (typeof req.handle !== "string" || !req.handle.trim()) throw new BidError("handle is required");
  if (req.message !== undefined && req.message !== null && (typeof req.message !== "string" || req.message.length > EXTERNAL_MESSAGE_MAX)) {
    throw new BidError(`message must be text of at most ${EXTERNAL_MESSAGE_MAX} characters`);
  }
  const message = typeof req.message === "string" && req.message.trim() ? req.message : null;
  const key = typeof req.idempotencyKey === "string" && req.idempotencyKey.trim() ? req.idempotencyKey.trim().slice(0, 200) : null;
  const requestKey = key ? `${bidder}:${key}` : null;

  // A retried request with the same Idempotency-Key gets the same intent back, but only
  // if it asks for the same bid: a key reused for another creator, amount or message is
  // refused, so an agent never believes it bid something it didn't.
  if (requestKey) {
    const existing = await db.query.externalBidIntents.findFirst({ where: eq(externalBidIntents.requestKey, requestKey) });
    if (existing) return { intent: await sameRequestOrThrow(existing, req.handle, req.amount, message), created: false };
  }

  const escrow = escrowAddress();
  if (!escrow) throw new BidError("Escrow contract is not configured", 503);
  // Only the current (v2) escrow carries a private message fingerprint to match on.
  if ((await escrowVersion(escrow)) !== 2) throw new BidError("Outside agents can't bid on this network's escrow", 503);

  const profile = await db.query.profiles.findFirst({ where: handleIs(req.handle) });
  if (!profile) throw new BidError("Creator not found", 404);
  if (!profile.isActive || profile.availabilityStatus === "not_accepting") {
    throw new BidError("This creator isn't accepting bids right now", 409);
  }
  const check = validateBidAmount(typeof req.amount === "number" || typeof req.amount === "string" ? String(req.amount).trim() : req.amount, profile.minBid);
  if (!check.ok) throw new BidError(check.error);
  const amount = check.amount;

  const creatorWallet = await mainWallet(profile.userId);
  if (!creatorWallet) throw new BidError("Creator has no wallet", 404);
  if (lower(creatorWallet.address) === bidder) throw new BidError("A creator can't bid on themselves");

  // Wallets Attnn. holds bid through the app, where the user's own limits apply.
  const ours = await db.query.wallets.findFirst({ where: sql`lower(${wallets.address}) = ${bidder}`, columns: { id: true } });
  if (ours) throw new BidError("This wallet belongs to an Attnn. account: bid from the app instead", 400);

  // Proof the caller controls this wallet: it paid for this creator's profile over x402
  // within the last day (Gateway only settles a payment the wallet itself signed).
  const since = new Date(Date.now() - PROFILE_READ_TTL_MS);
  const paid = await db.query.x402Payments.findFirst({
    where: and(
      sql`lower(${x402Payments.resource}) = ${`profile:${lower(profile.handle)}`}`,
      sql`lower(${x402Payments.payer}) = ${bidder}`,
      gte(x402Payments.createdAt, since),
    ),
    columns: { id: true },
  });
  if (!paid) {
    throw new BidError(
      `Read this creator's profile first, paying from ${bidder}: GET /api/c/${profile.handle} with an x402 payment. It proves the wallet is yours.`,
      402,
    );
  }

  // The escrow refuses an amount below the creator's floor as Arc has it (CertiK 4).
  const chainFloor = await registryMinBid(creatorWallet.address);
  if (chainFloor !== null && amount < chainFloor) {
    throw new BidError(`This creator's minimum on Arc is still ${formatUsd(chainFloor)}. Bid at least that.`);
  }

  const [open] = await db
    .select({ n: count() })
    .from(externalBidIntents)
    .where(and(eq(externalBidIntents.bidderAddress, bidder), isNull(externalBidIntents.bidId), gte(externalBidIntents.createdAt, new Date(Date.now() - 24 * 3600 * 1000))));
  if ((open?.n ?? 0) >= MAX_OPEN_INTENTS) {
    throw new BidError(`This wallet already has ${MAX_OPEN_INTENTS} bids waiting to be placed. Place or abandon some first.`, 429);
  }

  const salt = newSalt();
  const [row] = await db
    .insert(externalBidIntents)
    .values({
      bidderAddress: bidder,
      creatorUserId: profile.userId,
      creatorAddress: lower(creatorWallet.address),
      amountUsdc: amount.toString(),
      message,
      messageSalt: salt,
      messageHash: fingerprint(salt, message ?? ""),
      escrowAddress: lower(escrow),
      requestKey,
    })
    .onConflictDoNothing({ target: externalBidIntents.requestKey })
    .returning();
  if (row) return { intent: row, created: true };
  // Two requests with the same key at once: the other one created it.
  const existing = requestKey ? await db.query.externalBidIntents.findFirst({ where: eq(externalBidIntents.requestKey, requestKey) }) : null;
  if (!existing) throw new BidError("Could not record the bid", 500);
  return { intent: await sameRequestOrThrow(existing, req.handle, req.amount, message), created: false };
}

/** The intent an Idempotency-Key already created, if this request asks for the same bid. */
async function sameRequestOrThrow(existing: IntentRow, handle: unknown, amount: unknown, message: string | null): Promise<IntentRow> {
  const profile = typeof handle === "string" ? await db.query.profiles.findFirst({ where: handleIs(handle), columns: { userId: true } }) : null;
  const sameAmount = (typeof amount === "string" || typeof amount === "number") && String(amount).trim() === existing.amountUsdc;
  if (profile?.userId !== existing.creatorUserId || !sameAmount || (message ?? null) !== (existing.message ?? null)) {
    throw new BidError("This Idempotency-Key was already used for a different bid. Use a new key for a new bid.", 409);
  }
  return existing;
}

/** The approve + placeBid calls for an intent, ready to sign and send. */
export function callsFor(intent: IntentRow): CallToSend[] {
  const escrow = getAddress(intent.escrowAddress);
  const amount = BigInt(intent.amountUsdc);
  return [
    {
      to: getAddress(USDC_ADDRESS),
      data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [escrow, amount] }),
      value: "0",
      description: `USDC approve(${escrow}, ${amount}): lets the escrow take exactly this bid`,
    },
    {
      to: escrow,
      data: encodeFunctionData({ abi: escrowAbi, functionName: "placeBid", args: [getAddress(intent.creatorAddress), amount, intent.messageHash as Hex] }),
      value: "0",
      description: `placeBid(${getAddress(intent.creatorAddress)}, ${amount}, ${intent.messageHash})`,
    },
  ];
}

// ─── Recording an escrowed bid ───────────────────────────────────────────────

export interface PlacementResult {
  /** Bids recorded by this call (a later call for the same transaction records 0). */
  recorded: BidRow[];
  /** Why nothing matched, when nothing did. */
  reason?: string;
}

/**
 * Reads `txHash` from Arc and records every outside agent's bid it escrowed in the
 * current escrow: a BidPlaced whose bidder, creator and amount match an open intent and
 * whose on-chain messageHash is that intent's fingerprint. `onlyIntentId` limits it to
 * one intent (the confirm route). Safe to call any number of times, from any path.
 */
export async function recordExternalPlacement(txHash: string, onlyIntentId?: string): Promise<PlacementResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { recorded: [], reason: "txHash must be a 0x-prefixed 32-byte transaction hash" };
  const escrow = escrowAddress();
  if (!escrow) return { recorded: [], reason: "Escrow contract is not configured" };

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    return { recorded: [], reason: "Transaction not found on Arc yet. Try again once it's mined." };
  }
  if (receipt.status !== "success") return { recorded: [], reason: "That transaction reverted on Arc, so no bid was escrowed" };

  const placed = parseEventLogs({ abi: escrowAbi, eventName: "BidPlaced", logs: receipt.logs }).filter((l) => lower(l.address) === lower(escrow));
  if (!placed.length) return { recorded: [], reason: "That transaction placed no bid in Attnn.'s escrow" };

  const recorded: BidRow[] = [];
  let reason = "No waiting bid matches that transaction (bidder, creator, amount and message fingerprint)";
  for (const log of placed) {
    const onChainBidId = log.args.bidId.toString();
    const sameBid = and(
      eq(externalBidIntents.bidderAddress, lower(log.args.bidder)),
      eq(externalBidIntents.creatorAddress, lower(log.args.creator)),
      eq(externalBidIntents.amountUsdc, log.args.amount.toString()),
      eq(externalBidIntents.escrowAddress, lower(escrow)),
      ...(onlyIntentId ? [eq(externalBidIntents.id, onlyIntentId)] : []),
    );
    // Most BidPlaced events are Attnn.'s own placements: no outside intent, no chain read.
    const candidate = await db.query.externalBidIntents.findFirst({ where: sameBid, columns: { id: true } });
    if (!candidate) continue;
    const view = await readEscrowBid(escrow, onChainBidId);
    // The escrow's own record must say the same as the event: bidder, creator, amount.
    if (
      !view.messageHash ||
      lower(view.bidder) !== lower(log.args.bidder) ||
      lower(view.creator) !== lower(log.args.creator) ||
      view.amount !== log.args.amount
    ) {
      continue;
    }
    const intent = await db.query.externalBidIntents.findFirst({
      where: and(sameBid, eq(externalBidIntents.messageHash, lower(view.messageHash))),
    });
    if (!intent) continue;
    if (intent.bidId) {
      reason = "Already recorded";
      continue;
    }
    if (view.status !== ONCHAIN_STATUS.Pending) {
      reason = "That bid was already settled on-chain before it could be recorded";
      continue;
    }

    // The bid's age is the escrow's, so the refund countdown matches the contract.
    const createdAt = new Date(Number(view.createdAt) * 1000);
    const row = await db.transaction(async (tx) => {
      // Webhook, confirm and status reads can race: one row per intent, whatever the order.
      await tx.execute(sql`select ${externalBidIntents.id} from ${externalBidIntents} where ${externalBidIntents.id} = ${intent.id} for update`);
      const fresh = await tx.query.externalBidIntents.findFirst({ where: eq(externalBidIntents.id, intent.id) });
      if (!fresh || fresh.bidId) return null;
      const [bid] = await tx
        .insert(bids)
        .values({
          bidderUserId: null,
          creatorUserId: intent.creatorUserId,
          bidderAddress: intent.bidderAddress,
          creatorAddress: intent.creatorAddress,
          amountUsdc: log.args.amount.toString(),
          message: intent.message,
          messageSalt: intent.messageSalt,
          status: "pending",
          escrowAddress: lower(escrow),
          onChainBidId,
          onChainTxHash: lower(txHash),
          createdAt,
        })
        .onConflictDoNothing()
        .returning();
      if (!bid) return null; // (escrow, on-chain id) already has a row
      await tx.update(externalBidIntents).set({ bidId: bid.id }).where(eq(externalBidIntents.id, intent.id));
      return bid;
    });
    if (!row) {
      reason = "Already recorded";
      continue;
    }
    recorded.push(row);
    // Hand it to the creator's agent. If that fails the bid is still in their inbox.
    await notifyBidEscrowed(row).catch((err) => console.error(`external bid ${row.id}: could not notify the creator agent`, err));
  }
  return recorded.length ? { recorded } : { recorded, reason };
}

// ─── Reading an intent ───────────────────────────────────────────────────────

export interface ExternalBidView {
  id: string;
  /** waiting = not escrowed yet; then the bid's own status. */
  status: "waiting" | BidRow["status"];
  creator: { handle: string | null; address: string };
  bidder: string;
  amount: string;
  messageHash: string;
  escrow: string;
  onChainBidId: string | null;
  placedTxHash: string | null;
  settledTxHash: string | null;
  /** When the agent may call claimRefund (escrowed, unanswered bids). */
  refundableAfter: string | null;
  /** The creator's paid reply: only once the bid is accepted. */
  reply: string | null;
  createdAt: string;
}

export async function loadIntent(id: string): Promise<IntentRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.query.externalBidIntents.findFirst({ where: eq(externalBidIntents.id, id) })) ?? null;
}

export async function viewIntent(intent: IntentRow, refundPeriodMs: number): Promise<ExternalBidView> {
  const [bid, creator] = await Promise.all([
    intent.bidId ? db.query.bids.findFirst({ where: eq(bids.id, intent.bidId) }) : Promise.resolve(undefined),
    db.query.profiles.findFirst({ where: eq(profiles.userId, intent.creatorUserId), columns: { handle: true } }),
  ]);
  const open = bid && (bid.status === "pending" || bid.status === "counter_offered");
  return {
    id: intent.id,
    status: bid ? bid.status : "waiting",
    creator: { handle: creator?.handle ?? null, address: getAddress(intent.creatorAddress) },
    bidder: getAddress(intent.bidderAddress),
    amount: intent.amountUsdc,
    messageHash: intent.messageHash,
    escrow: getAddress(intent.escrowAddress),
    onChainBidId: bid?.onChainBidId ?? null,
    placedTxHash: bid?.onChainTxHash ?? null,
    settledTxHash: bid?.settlementOnChainTxHash ?? null,
    refundableAfter: open ? new Date(bid.createdAt.getTime() + refundPeriodMs).toISOString() : null,
    reply: bid?.status === "accepted" ? bid.reply : null,
    createdAt: intent.createdAt.toISOString(),
  };
}
