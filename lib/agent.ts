import { db } from "./db/client";
import { bids, agentLogs, profiles, bidderConfigs, wallets, x402Payments } from "./db/schema";
import { arc } from "./chain";
import { evaluateCreatorForBidder } from "./ai";
import { isActiveOnRegistry } from "./registration";
import { BidError, createBidIntent } from "./bids";
import { ESCROW_MIN_BID, formatUsd, resolveAgentBidAmount } from "./bid-rules";
import { getUsdcBalance } from "./activation";
import { agentWallet } from "./wallets";
import { acquireAgentLease, releaseAgentLease, renewAgentLease } from "./agent-lease";
import { bidsPaused } from "./app-settings";
import {
  PROFILE_READ_PRICE,
  PROFILE_READ_TTL_MS,
  READ_TOPUP,
  agentReadsBaseUrl,
  agentReadsEnabled,
  buyProfile,
  circleSigner,
  gatewayBalance,
} from "./gateway";
import { AGENT_WALLET_GAS_RESERVE } from "./wallets";
import { inngest } from "./inngest";
import { eq, and, gte, inArray, ne, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// ─── Bidder Agent Run ────────────────────────────────────────────────────────

export interface AgentRunResult {
  bidsPlaced: number;
  creatorsFound: number;
  errors: string[];
  logId: string;
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Today's committed spend: every bid except ones that failed (no USDC moved), plus the
 * profile reads the user's agent wallet paid for over x402 today.
 */
export async function spentToday(userId: string): Promise<bigint> {
  const since = startOfUtcDay();
  const [[row], [reads]] = await Promise.all([
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${bids.amountUsdc} AS BIGINT)), 0)` })
      .from(bids)
      .where(and(eq(bids.bidderUserId, userId), gte(bids.createdAt, since), ne(bids.status, "failed"))),
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${x402Payments.amountUsdc} AS BIGINT)), 0)` })
      .from(x402Payments)
      .where(
        and(
          gte(x402Payments.createdAt, since),
          sql`lower(${x402Payments.payer}) IN (SELECT lower(${wallets.address}) FROM ${wallets} WHERE ${wallets.userId} = ${userId} AND ${wallets.purpose} = 'agent')`,
        ),
      ),
  ]);
  return BigInt(row?.total ?? "0") + BigInt(reads?.total ?? "0");
}

/**
 * One run of a bidder's agent: discover creators by tag, score them, and queue bids.
 *
 * Bids are recorded as "placing" intents (lib/bids.ts); the placeBid Inngest job
 * does approve → placeBid on-chain. This function never touches the chain itself,
 * so it no longer sleeps between calls or holds a Vercel function open.
 */
export async function runBidderAgent(userId: string): Promise<AgentRunResult> {
  // One run per user at a time, or two could each spend the whole daily budget.
  const lease = await acquireAgentLease(userId);
  if (!lease) {
    const hasConfig = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, userId), columns: { id: true } });
    return {
      bidsPlaced: 0,
      creatorsFound: 0,
      errors: [hasConfig ? "Another agent run is already in progress" : "Bidder config not active"],
      logId: "",
    };
  }
  const held = { token: lease };
  try {
    return await runBidderAgentHoldingLease(userId, held);
  } finally {
    await releaseAgentLease(userId, held.token).catch((err) => console.error("agent: could not release lease", err));
  }
}

async function runBidderAgentHoldingLease(userId: string, held: { token: Date }): Promise<AgentRunResult> {
  const errors: string[] = [];
  let bidsPlaced = 0;
  let creatorsFound = 0;

  try {
    const config = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, userId) });
    if (!config || !config.isActive) {
      await logAgentAction(userId, "agent_stopped", { reason: "Config not active" });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["Bidder config not active"], logId: "" };
    }

    if (await bidsPaused()) {
      await logAgentAction(userId, "agent_stopped", { reason: "New bids are paused for maintenance" });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["New bids are paused"], logId: "" };
    }

    const budget = BigInt(config.dailyBudget);
    const spent = await spentToday(userId);
    if (spent >= budget) {
      await logAgentAction(userId, "agent_stopped", { reason: "Daily budget exhausted", spent: spent.toString(), budget: config.dailyBudget });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["Daily budget exhausted"], logId: "" };
    }

    // The agent spends only from its own wallet. Without one, or with less than the
    // smallest possible bid in it, there's nothing to do (and no AI calls to pay for).
    const wallet = await agentWallet(userId);
    if (!wallet) {
      await logAgentAction(userId, "agent_stopped", { reason: "No agent wallet yet. Create it on the Agent tab and move USDC into it" });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["No agent wallet"], logId: "" };
    }
    try {
      const available = await getUsdcBalance(wallet.address);
      if (available <= ESCROW_MIN_BID) {
        await logAgentAction(userId, "agent_stopped", {
          reason: `Agent wallet has ${formatUsd(available)}. Move USDC into it on the Agent tab so it can bid`,
        });
        return { bidsPlaced: 0, creatorsFound: 0, errors: ["Agent wallet is empty"], logId: "" };
      }
    } catch (err) {
      // RPC hiccup: carry on; createBidIntent re-checks the balance per bid.
      console.warn("runBidderAgent: agent wallet balance check skipped:", err);
    }

    // Discover creators by their CURRENT tags (the DB; tags edited after registration
    // never reach the on-chain registry), then confirm on Arc that each one really is
    // a registered, active creator before it can receive a bid.
    const wanted = new Set(config.searchTags.map((t) => t.trim().toLowerCase()).filter(Boolean));
    if (wanted.size === 0) {
      await logAgentAction(userId, "creator_discovered", { count: 0, reason: "No search tags set" });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["No search tags set"], logId: uuidv4() };
    }

    const activeProfiles = await db.query.profiles.findMany({ where: eq(profiles.isActive, true) });

    // No re-bidding the same creator in one UTC day. Failed attempts count too, so a
    // creator the agent can't afford isn't retried every 30 minutes.
    const todayBids = await db
      .select({ creatorUserId: bids.creatorUserId })
      .from(bids)
      .where(and(eq(bids.bidderUserId, userId), gte(bids.createdAt, startOfUtcDay())));
    const alreadyBidToday = new Set(todayBids.map((b) => b.creatorUserId));

    // Best tag overlap first.
    const matches = activeProfiles
      .filter((p) => p.userId !== userId && p.availabilityStatus !== "not_accepting" && !alreadyBidToday.has(p.userId))
      .map((p) => ({ profile: p, overlap: p.tags.filter((t) => wanted.has(t.trim().toLowerCase())).length }))
      .filter((m) => m.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);

    const walletRows = matches.length
      ? await db
          .select({ userId: wallets.userId, address: wallets.address })
          .from(wallets)
          .where(
            and(
              inArray(wallets.userId, matches.map((m) => m.profile.userId)),
              eq(wallets.purpose, "main"),
              eq(wallets.blockchain, arc.circleBlockchain),
            ),
          )
      : [];
    const walletByUser = new Map(walletRows.map((w) => [w.userId, w.address]));

    // Verify on the registry, stopping once there are enough to score.
    const MAX_TO_SCORE = 10;
    const filteredCreators: { profile: typeof profiles.$inferSelect; address: string }[] = [];
    for (const m of matches) {
      if (filteredCreators.length >= MAX_TO_SCORE) break;
      const address = walletByUser.get(m.profile.userId);
      if (!address) continue;
      try {
        if (await isActiveOnRegistry(address)) filteredCreators.push({ profile: m.profile, address });
      } catch (err) {
        errors.push(`Couldn't verify @${m.profile.handle} on Arc: ${err instanceof Error ? err.message : err}`);
      }
    }
    creatorsFound = filteredCreators.length;

    if (creatorsFound === 0) {
      await logAgentAction(userId, "creator_discovered", { count: 0 });
      return { bidsPlaced: 0, creatorsFound: 0, errors, logId: uuidv4() };
    }

    // Every agent pays to read a creator's gated profile before scoring them, Attnn.'s
    // own included (lib/gateway.ts). Profiles bought in the last day are read from the copy.
    const reads = await prepareProfileReads(userId, wallet, filteredCreators.map((c) => c.profile.handle), budget);
    if (reads.stop) {
      await logAgentAction(userId, "agent_stopped", { reason: reads.stop, creatorsFound });
      return { bidsPlaced: 0, creatorsFound, errors: [...errors, reads.stop], logId: uuidv4() };
    }

    // Score up to 10; keep those above the bidder's fit threshold.
    // A creator the AI couldn't score is skipped, never bid on blind.
    const scored: { profile: typeof profiles.$inferSelect; score: number; bidAmount: bigint }[] = [];
    let unscored = 0;
    for (const ct of filteredCreators) {
      try {
        const view = await readProfile(reads, ct.profile);
        if (!view) {
          errors.push(`Skipping ${ct.profile.handle}: ${reads.lastError ?? "couldn't read the profile"}`);
          continue;
        }
        if (!view.isActive || view.availabilityStatus === "not_accepting") continue;
        const result = await evaluateCreatorForBidder(
          { handle: view.handle, bio: view.bio ?? undefined, tags: view.tags, minBid: view.minBid },
          config.goal ?? "general",
        );
        if (!result) {
          unscored++;
          continue;
        }
        await logAgentAction(userId, "creator_scored", {
          creator: ct.profile.handle,
          score: result.score,
          profile: view.source,
          ...(view.source === "x402" ? { x402: { amount: view.paid.toString(), transaction: view.transaction } } : {}),
        });
        if (!result.proceed || result.score < config.minFitScore) continue;

        // The agent bids the creator's floor; the AI only decided whether and how
        // well they fit. Skip creators priced above the bidder's per-creator cap.
        const amount = resolveAgentBidAmount({
          creatorMinBid: ct.profile.minBid,
          maxBidPerCreator: config.maxBidPerCreator,
        });
        if (amount === null) {
          errors.push(`Skipping ${ct.profile.handle}: floor is above your ${formatUsd(BigInt(config.maxBidPerCreator))} per-creator cap`);
          continue;
        }
        scored.push({ profile: ct.profile, score: result.score, bidAmount: amount });
      } catch (err) {
        errors.push(`Score error for ${ct.profile.handle}: ${err}`);
      }
    }

    if (unscored === filteredCreators.length) {
      await logAgentAction(userId, "agent_stopped", {
        reason: "AI unavailable: no creators could be scored, so no bids were placed. The agent tries again on its next run",
        creatorsFound,
      });
      return { bidsPlaced: 0, creatorsFound, errors: [...errors, "AI unavailable; no bids placed"], logId: uuidv4() };
    }
    if (unscored > 0) errors.push(`${unscored} creator(s) skipped: AI couldn't score them`);

    scored.sort((a, b) => b.score - a.score);
    const topCreators = scored.slice(0, 5);

    for (const tc of topCreators) {
      // Still ours? A run slower than the lease must stop, or it would race the next run.
      const renewed = await renewAgentLease(userId, held.token);
      if (!renewed) {
        await logAgentAction(userId, "agent_stopped", { reason: "Run took too long; another run took over" });
        break;
      }
      held.token = renewed;
      // Re-check budget before each bid — placing intents count immediately.
      const currentSpent = await spentToday(userId);
      if (currentSpent >= budget) {
        await logAgentAction(userId, "agent_stopped", { reason: "Daily budget exhausted mid-run" });
        break;
      }
      if (tc.bidAmount > budget - currentSpent) {
        errors.push(`Skipping ${tc.profile.handle}: bid exceeds remaining budget`);
        continue;
      }

      try {
        const intent = await createBidIntent({
          bidderUserId: userId,
          creatorUserId: tc.profile.userId,
          amountUsdc: tc.bidAmount,
          message: config.defaultMessage ?? "AI-discovered opportunity",
          score: tc.score,
          fromAgentWallet: true,
        });
        await logAgentAction(userId, "bid_placed", {
          creator: tc.profile.handle,
          amount: tc.bidAmount.toString(),
          score: tc.score,
          bidId: intent.id,
          status: "placing",
        });
        bidsPlaced++;
      } catch (err) {
        const message = err instanceof BidError ? err.message : String(err);
        errors.push(`Failed to bid on ${tc.profile.handle}: ${message}`);
        await logAgentAction(userId, "error", { creator: tc.profile.handle, error: message });
        // Out of funds affects every remaining bid in this run.
        if (err instanceof BidError && message.startsWith("Not enough USDC")) break;
      }
    }

    await logAgentAction(userId, "creator_discovered", {
      count: creatorsFound,
      scored: scored.length,
      unscored,
      bidsPlaced,
      profilesBought: reads.bought,
      ...(reads.bought ? { readSpend: (PROFILE_READ_PRICE * BigInt(reads.bought)).toString() } : {}),
      ...(reads.topUp ? { readTopUp: READ_TOPUP.toString() } : {}),
    });
  } catch (err) {
    errors.push(`Agent run failed: ${err}`);
  }

  return { bidsPlaced, creatorsFound, errors, logId: uuidv4() };
}

// ─── Paid profile reads (x402) ───────────────────────────────────────────────

interface ProfileReads {
  /** Paid reads are switched on (otherwise every read is free: AGENT_X402=0 or no paywall). */
  paid: boolean;
  balance: bigint;
  payer: string;
  signer: ReturnType<typeof circleSigner> | null;
  baseUrl: string;
  budget: bigint;
  userId: string;
  bought: number;
  /** Handles this payer bought in the last day: read from the copy, free. */
  owned: Set<string>;
  /** A top-up of the read balance was requested this run. */
  topUp: boolean;
  /** Set when the run can't read any profile, so it stops (and says why). */
  stop: string | null;
  lastError: string | null;
}

type ProfileView = {
  handle: string;
  bio: string | null;
  tags: string[];
  minBid: string;
  availabilityStatus: string;
  isActive: boolean;
} & ({ source: "x402"; paid: bigint; transaction: string } | { source: "x402_earlier" | "free" });

/** Handles this payer bought within PROFILE_READ_TTL_MS. */
async function ownedProfiles(payer: string, handles: string[]): Promise<Set<string>> {
  if (!handles.length) return new Set();
  const rows = await db
    .select({ resource: x402Payments.resource })
    .from(x402Payments)
    .where(
      and(
        sql`lower(${x402Payments.payer}) = ${payer.toLowerCase()}`,
        inArray(x402Payments.resource, handles.map((h) => `profile:${h}`)),
        gte(x402Payments.createdAt, new Date(Date.now() - PROFILE_READ_TTL_MS)),
      ),
    );
  return new Set(rows.map((r) => r.resource.slice("profile:".length)));
}

/**
 * Asks fundAgentReads to add READ_TOPUP from the agent wallet to its read balance (at most
 * once an hour: the hour is in the op key and the event id). When the deposit lands, the
 * job runs this agent again. Skipped if the agent wallet can't spare it.
 */
async function requestTopUp(userId: string, wallet: { address: string }): Promise<boolean> {
  const usdc = await getUsdcBalance(wallet.address).catch(() => null);
  if (usdc === null || usdc < READ_TOPUP + AGENT_WALLET_GAS_RESERVE * BigInt(2)) return false;
  const opKey = `reads-topup:${userId}:${new Date().toISOString().slice(0, 13)}`;
  await inngest.send({ id: opKey, name: "attnn/agent.reads-fund", data: { userId, amount: READ_TOPUP.toString(), opKey, resume: true } });
  return true;
}

async function prepareProfileReads(
  userId: string,
  wallet: { address: string; circleWalletId: string },
  handles: string[],
  budget: bigint,
): Promise<ProfileReads> {
  const reads: ProfileReads = {
    paid: agentReadsEnabled(),
    balance: BigInt(0),
    payer: wallet.address,
    signer: null,
    baseUrl: "",
    budget,
    userId,
    bought: 0,
    owned: new Set(),
    topUp: false,
    stop: null,
    lastError: null,
  };
  if (!reads.paid) return reads;
  try {
    reads.baseUrl = agentReadsBaseUrl();
    [reads.balance, reads.owned] = await Promise.all([gatewayBalance(wallet.address), ownedProfiles(wallet.address, handles)]);
  } catch (err) {
    console.warn("agent: profile reads unavailable:", err);
    reads.stop = "Couldn't reach Circle to pay for creator profiles, so no profiles were read and no bids placed. The agent tries again on its next run";
    return reads;
  }
  reads.signer = circleSigner(wallet.circleWalletId, wallet.address);

  const toBuy = handles.filter((h) => !reads.owned.has(h)).length;
  if (reads.balance >= PROFILE_READ_PRICE * BigInt(toBuy)) return reads;
  // Short: top up for later reads. With nothing to pay even one read, this run waits for it.
  reads.topUp = await requestTopUp(userId, wallet).catch((err) => {
    console.error("agent: couldn't request a read top-up:", err);
    return false;
  });
  if (reads.balance < PROFILE_READ_PRICE && reads.owned.size === 0) {
    reads.stop = reads.topUp
      ? "Setting aside a few cents for profile reads ($0.001 each). The agent runs again as soon as that's ready"
      : "Not enough USDC in the agent wallet to pay for profile reads ($0.001 each). Move some USDC into it on the Agent tab";
  }
  return reads;
}

/**
 * The profile the agent scores, read the way any agent reads it: paid over x402 (or the
 * copy it paid for in the last day). Null when it couldn't pay: that creator is skipped,
 * never scored on a free read.
 */
async function readProfile(reads: ProfileReads, p: typeof profiles.$inferSelect): Promise<ProfileView | null> {
  const stored = {
    handle: p.handle,
    bio: p.bio,
    tags: p.tags,
    minBid: p.minBid,
    availabilityStatus: p.availabilityStatus,
    isActive: p.isActive,
  };
  if (!reads.paid) return { ...stored, source: "free" };
  if (reads.owned.has(p.handle)) return { ...stored, source: "x402_earlier" };
  if (!reads.signer || reads.balance < PROFILE_READ_PRICE) {
    reads.lastError = reads.topUp ? "the read balance is being topped up; it's read on the next run" : "no read balance left to pay for the profile";
    return null;
  }
  // Reads count in the daily budget, like bids.
  if ((await spentToday(reads.userId)) + PROFILE_READ_PRICE > reads.budget) {
    reads.lastError = "daily budget reached";
    return null;
  }
  try {
    const bought = await buyProfile({ baseUrl: reads.baseUrl, handle: p.handle, signer: reads.signer });
    reads.balance -= bought.amount;
    reads.bought++;
    reads.owned.add(p.handle);
    return {
      handle: p.handle,
      bio: bought.profile.bio ?? null,
      tags: Array.isArray(bought.profile.tags) ? bought.profile.tags : [],
      minBid: String(bought.profile.minBid ?? p.minBid),
      availabilityStatus: String(bought.profile.availabilityStatus ?? p.availabilityStatus),
      isActive: bought.profile.isActive === true,
      source: "x402",
      paid: bought.amount,
      transaction: bought.transaction,
    };
  } catch (err) {
    reads.lastError = `couldn't pay for the profile (${err instanceof Error ? err.message : err})`;
    console.warn(`agent: x402 read of @${p.handle} failed:`, err);
    return null;
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

async function logAgentAction(
  userId: string,
  action: (typeof agentLogs.$inferInsert)["action"],
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(agentLogs).values({ userId, action, data });
  } catch (err) {
    console.error("Failed to log agent action:", err);
  }
}
