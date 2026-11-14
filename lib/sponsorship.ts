/**
 * Sponsored first network fees ("gas drip").
 *
 * Arc charges gas in USDC, so a brand-new creator with an empty wallet couldn't register
 * their market. When it's set up, Attnn.'s sponsor wallet sends a verified creator one
 * small USDC top-up (GAS_SPONSOR_AMOUNT_USDC, default $0.10) to their own main wallet;
 * registration then goes ahead from that wallet as usual (lib/registration.ts).
 *
 * Limits, all enforced here and in the database, never by the AI or the browser:
 *   - only when creator verification is on (lib/social-verify.ts) and the creator has
 *     verified an X or LinkedIn account: one provider account verifies one user;
 *   - once per user, ever (`gas_sponsorships.user_id` is unique; only a top-up that
 *     moved no USDC may be retried, with a new Circle idempotency key);
 *   - a platform-wide cap per rolling 24 hours (GAS_SPONSOR_DAILY_LIMIT_USDC, default $5),
 *     checked and reserved under one advisory lock, so parallel requests can't overshoot;
 *   - the amount is capped at $1 whatever the setting says.
 *
 * While a top-up is on its way the profile's `onChainTx` holds the SPONSORING sentinel,
 * which reads as "registering" everywhere; `refreshRegistration` (job + 10-minute
 * sweep) waits for it and then submits the registration.
 */
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "./db/client";
import { gasSponsorships, profiles } from "./db/schema";
import {
  classifyTxState,
  describeTxFailure,
  findTransactionByRefId,
  getTransactionStatus,
  rejectedByCircle,
  transferUSDC,
} from "./circle";

/** `profiles.onChainTx` while the creator's top-up is on its way (before any registerCreator). */
export const SPONSORING = "sponsoring";

/** With sponsorship on, a wallet holding at least this registers without a top-up. */
export const REGISTRATION_GAS_MIN = BigInt(20_000); // $0.02

const DEFAULT_AMOUNT = BigInt(100_000); // $0.10
const DEFAULT_DAILY_LIMIT = BigInt(5_000_000); // $5
const MAX_AMOUNT = BigInt(1_000_000); // $1: a typo in the setting can't send more
const DAY_MS = 24 * 60 * 60 * 1000;
/** A top-up Circle has no record of after this never reached Circle. */
const LOST_AFTER_MS = 10 * 60 * 1000;

/** Recorded as the profile's registrationError (the dashboard adds what to do next). */
export const SPONSOR_FAILED_REASON = "We couldn't cover your network fee just now";
/** What the Go live button's request answers when the top-up was refused. */
export const SPONSOR_FAILED_MESSAGE = "We couldn't cover your network fee just now. Please try again in a minute.";

export interface SponsorConfig {
  walletId: string;
  walletAddress: string;
  amount: bigint;
  dailyLimit: bigint;
}

/** "0.10" → 100000n (6 decimals); null if it isn't a plain positive dollar amount. */
function dollars(value: string | undefined): bigint | null {
  const v = value?.trim();
  if (!v) return null;
  const m = /^(\d{1,7})(?:\.(\d{1,6}))?$/.exec(v);
  if (!m) return null;
  const atomic = BigInt(m[1]!) * BigInt(1_000_000) + BigInt((m[2] ?? "").padEnd(6, "0"));
  return atomic > BigInt(0) ? atomic : null;
}

/** The sponsor wallet and limits, or null when sponsorship isn't set up (or is set up wrongly). */
export function sponsorConfig(): SponsorConfig | null {
  const walletId = process.env.GAS_SPONSOR_WALLET_ID?.trim();
  const walletAddress = process.env.GAS_SPONSOR_WALLET_ADDRESS?.trim();
  if (!walletId || !walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return null;
  const amountSet = process.env.GAS_SPONSOR_AMOUNT_USDC?.trim();
  const limitSet = process.env.GAS_SPONSOR_DAILY_LIMIT_USDC?.trim();
  const amount = amountSet ? dollars(amountSet) : DEFAULT_AMOUNT;
  const dailyLimit = limitSet ? dollars(limitSet) : DEFAULT_DAILY_LIMIT;
  // A setting we can't read switches sponsorship off rather than guessing an amount.
  if (amount === null || dailyLimit === null || amount > MAX_AMOUNT || dailyLimit < amount) {
    console.warn("sponsorship: GAS_SPONSOR_AMOUNT_USDC / GAS_SPONSOR_DAILY_LIMIT_USDC are invalid; sponsorship is off");
    return null;
  }
  return { walletId, walletAddress: walletAddress.toLowerCase(), amount, dailyLimit };
}

export const opKeyFor = (userId: string, attempt: number) => `sponsor:${userId}:${attempt}`;

export type SponsorOutcome =
  /** The top-up was sent (or may have been: it's resolved later by its op key). */
  | "sent"
  /** This creator was already sponsored once. */
  | "used"
  /** Today's sponsorship budget is spent. */
  | "limit"
  /** A top-up or registration is already on its way. */
  | "busy"
  /** Circle refused the top-up outright; no USDC moved and the creator may try again. */
  | "failed";

/**
 * Sends a creator their one-time top-up. The caller has already checked that they're
 * verified, not live, and short of USDC. Reserves first (under a lock, with the profile's
 * registration slot), then sends, so two requests can't both pay.
 */
export async function sponsorActivation(userId: string, walletAddress: string, cfg: SponsorConfig): Promise<SponsorOutcome> {
  if (walletAddress.toLowerCase() === cfg.walletAddress) return "used"; // never pay ourselves

  const reserved = await db.transaction(async (tx) => {
    // One sponsorship decision at a time across the platform: the daily cap is a sum.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('attnn:gas-sponsorship'))`);

    const [existing] = await tx.select().from(gasSponsorships).where(eq(gasSponsorships.userId, userId)).for("update");
    if (existing && existing.status !== "failed") return existing.status === "complete" ? "used" : "busy";

    const recent = await tx
      .select({ amount: gasSponsorships.amountUsdc })
      .from(gasSponsorships)
      .where(and(ne(gasSponsorships.status, "failed"), gt(gasSponsorships.reservedAt, new Date(Date.now() - DAY_MS))));
    const spent = recent.reduce((sum, r) => sum + BigInt(r.amount), BigInt(0));
    if (spent + cfg.amount > cfg.dailyLimit) return "limit";

    // Take the profile's registration slot, exactly as submitRegistration reserves it.
    const [slot] = await tx
      .update(profiles)
      .set({ onChainTx: SPONSORING, registrationError: null })
      .where(
        and(
          eq(profiles.userId, userId),
          eq(profiles.isActive, false),
          sql`(${profiles.onChainTx} is null or ${profiles.registrationError} is not null)`,
        ),
      )
      .returning({ id: profiles.id });
    if (!slot) return "busy";

    const row = {
      walletAddress: walletAddress.toLowerCase(),
      sponsorWalletId: cfg.walletId,
      amountUsdc: cfg.amount.toString(),
      status: "reserved" as const,
      circleTxId: null,
      error: null,
      reservedAt: new Date(),
    };
    if (existing) {
      const attempt = existing.attempt + 1;
      await tx.update(gasSponsorships).set({ ...row, attempt }).where(eq(gasSponsorships.id, existing.id));
      return { attempt };
    }
    await tx.insert(gasSponsorships).values({ ...row, userId, attempt: 1 });
    return { attempt: 1 };
  });
  if (typeof reserved === "string") return reserved;

  try {
    const sent = await transferUSDC(cfg.walletId, walletAddress, cfg.amount.toString(), opKeyFor(userId, reserved.attempt));
    await db
      .update(gasSponsorships)
      .set({ status: "sent", circleTxId: sent.txId })
      .where(and(eq(gasSponsorships.userId, userId), eq(gasSponsorships.attempt, reserved.attempt)));
    return "sent";
  } catch (err) {
    if (rejectedByCircle(err)) {
      // Refused outright: nothing was sent. Free the slot so the creator can try again.
      await failSponsorship(userId, reserved.attempt, err instanceof Error ? err.message : String(err));
      return "failed";
    }
    // Timeout or network error: it may have reached Circle. Kept as reserved; the
    // registration job finds it by its op key (resolveSponsorship).
    console.error("sponsorship: top-up outcome unknown, resolving later", err instanceof Error ? err.message : err);
    return "sent";
  }
}

async function failSponsorship(userId: string, attempt: number, reason: string) {
  await db
    .update(gasSponsorships)
    .set({ status: "failed", error: reason.slice(0, 500) })
    .where(and(eq(gasSponsorships.userId, userId), eq(gasSponsorships.attempt, attempt)));
  await db
    .update(profiles)
    .set({ onChainTx: null, registrationError: SPONSOR_FAILED_REASON })
    .where(and(eq(profiles.userId, userId), eq(profiles.onChainTx, SPONSORING)));
}

/**
 * Where the creator's top-up stands, asking Circle when it's still open. Records the
 * outcome; on "failed" it also frees the profile's registration slot with a message.
 */
export async function resolveSponsorship(userId: string): Promise<"complete" | "failed" | "in_flight"> {
  const [row] = await db.select().from(gasSponsorships).where(eq(gasSponsorships.userId, userId));
  if (!row) {
    await failSponsorship(userId, -1, "no sponsorship");
    return "failed";
  }
  if (row.status === "complete") return "complete";
  if (row.status === "failed") {
    await failSponsorship(userId, row.attempt, row.error ?? "failed");
    return "failed";
  }

  let txId = row.circleTxId;
  if (!txId) {
    const found = await findTransactionByRefId(row.sponsorWalletId, opKeyFor(userId, row.attempt), row.reservedAt);
    if (!found) {
      if (Date.now() - row.reservedAt.getTime() > LOST_AFTER_MS) {
        await failSponsorship(userId, row.attempt, "The top-up never reached Circle.");
        return "failed";
      }
      return "in_flight";
    }
    txId = found.txId;
    await db.update(gasSponsorships).set({ status: "sent", circleTxId: txId }).where(eq(gasSponsorships.id, row.id));
  }

  const status = await getTransactionStatus(txId);
  const outcome = classifyTxState(status.state);
  if (outcome === "complete") {
    await db.update(gasSponsorships).set({ status: "complete" }).where(eq(gasSponsorships.id, row.id));
    return "complete";
  }
  if (outcome === "failed") {
    await failSponsorship(userId, row.attempt, describeTxFailure(status));
    return "failed";
  }
  return "in_flight";
}

/** Whether this user has had their top-up (or has one on its way). For the dashboard. */
export async function sponsorshipUsed(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: gasSponsorships.id })
    .from(gasSponsorships)
    .where(and(eq(gasSponsorships.userId, userId), ne(gasSponsorships.status, "failed")));
  return !!row;
}
