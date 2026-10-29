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
  agentReadsBaseUrl,
  agentReadsEnabled,
  buyProfile,
  circleSigner,
  gatewayBalance,
} from "./gateway";
import { formatMoney } from "./format";
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

/** Today's committed spend: every bid except ones that failed (no USDC moved). */
export async function spentToday(userId: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(CAST(${bids.amountUsdc} AS BIGINT)), 0)` })
    .from(bids)
    .where(and(eq(bids.bidderUserId, userId), gte(bids.createdAt, startOfUtcDay()), ne(bids.status, "failed")));
  return BigInt(row?.total ?? "0");
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

    // Read each creator's profile the way an outside agent would: paid over x402 from the
    // agent's read balance (lib/gateway.ts). Without a read balance it uses the free copy.
    const reads = await prepareProfileReads(wallet);

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
      ...(reads.note ? { readNote: reads.note } : {}),
    });
  } catch (err) {
    errors.push(`Agent run failed: ${err}`);
  }

  return { bidsPlaced, creatorsFound, errors, logId: uuidv4() };
}

// ─── Paid profile reads (x402) ───────────────────────────────────────────────

interface ProfileReads {
  /** Buying is on and the read balance covers at least one more read. */
  active: boolean;
  balance: bigint;
  payer: string;
  signer: ReturnType<typeof circleSigner> | null;
  baseUrl: string;
  bought: number;
  /** Why the run used free reads, for the run log. */
  note: string | null;
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

async function prepareProfileReads(wallet: { address: string; circleWalletId: string }): Promise<ProfileReads> {
  const reads: ProfileReads = {
    active: false,
    balance: BigInt(0),
    payer: wallet.address,
    signer: null,
    baseUrl: "",
    bought: 0,
    note: null,
    lastError: null,
  };
  if (!agentReadsEnabled()) return reads;
  try {
    reads.baseUrl = agentReadsBaseUrl();
    reads.balance = await gatewayBalance(wallet.address);
  } catch (err) {
    reads.note = `Paid profile reads unavailable this run (${err instanceof Error ? err.message : err}); used free reads`;
    return reads;
  }
  if (reads.balance < PROFILE_READ_PRICE) {
    reads.note = `Read balance is ${formatMoney(reads.balance)}: add one on the Agent tab and your agent pays for each profile it reads over x402`;
    return reads;
  }
  reads.signer = circleSigner(wallet.circleWalletId, wallet.address);
  reads.active = true;
  return reads;
}

/** Has this payer bought this creator's profile recently? Then it reads its copy for free. */
async function paidRecently(payer: string, handle: string): Promise<boolean> {
  const row = await db.query.x402Payments.findFirst({
    where: and(
      sql`lower(${x402Payments.payer}) = ${payer.toLowerCase()}`,
      eq(x402Payments.resource, `profile:${handle}`),
      gte(x402Payments.createdAt, new Date(Date.now() - PROFILE_READ_TTL_MS)),
    ),
    columns: { id: true },
  });
  return !!row;
}

/**
 * The profile the agent scores. Paid over x402 when the read balance allows; null (skip
 * the creator) when a paid read fails, so the agent never scores what it couldn't read.
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
  if (!reads.active || !reads.signer) return { ...stored, source: "free" };
  if (await paidRecently(reads.payer, p.handle)) return { ...stored, source: "x402_earlier" };
  if (reads.balance < PROFILE_READ_PRICE) {
    reads.active = false;
    reads.note = "Read balance ran out during this run; the rest were read for free";
    return { ...stored, source: "free" };
  }
  try {
    const bought = await buyProfile({ baseUrl: reads.baseUrl, handle: p.handle, signer: reads.signer });
    reads.balance -= bought.amount;
    reads.bought++;
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
