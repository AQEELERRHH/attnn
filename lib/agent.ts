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
  const decisions = new Map<string, DecisionRecord>();

  try {
    return await runBidderAgentSteps(userId, held, errors, decisions, (n) => (bidsPlaced = n), (n) => (creatorsFound = n));
  } catch (err) {
    errors.push(`Agent run failed: ${err}`);
    return { bidsPlaced, creatorsFound, errors, logId: uuidv4() };
  } finally {
    // Every creator the run looked at gets its decision record, however the run ended.
    for (const rec of decisions.values()) {
      if (!rec.decision) Object.assign(rec, { decision: "NOT_REACHED", reason: "The run stopped before reaching this creator" });
      await logAgentAction(userId, "creator_scored", rec as unknown as Record<string, unknown>);
    }
  }
}

async function runBidderAgentSteps(
  userId: string,
  held: { token: Date },
  errors: string[],
  decisions: Map<string, DecisionRecord>,
  reportBids: (n: number) => void,
  reportFound: (n: number) => void,
): Promise<AgentRunResult> {
  let bidsPlaced = 0;
  let creatorsFound = 0;
  {
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
      .map((p) => {
        const matched = p.tags.filter((t) => wanted.has(t.trim().toLowerCase()));
        return { profile: p, matched, overlap: matched.length };
      })
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
    const filteredCreators: { profile: typeof profiles.$inferSelect; address: string; matched: string[] }[] = [];
    for (const m of matches) {
      if (filteredCreators.length >= MAX_TO_SCORE) break;
      const address = walletByUser.get(m.profile.userId);
      if (!address) continue;
      try {
        if (await isActiveOnRegistry(address)) filteredCreators.push({ profile: m.profile, address, matched: m.matched });
      } catch (err) {
        errors.push(`Couldn't verify @${m.profile.handle} on Arc: ${err instanceof Error ? err.message : err}`);
      }
    }
    creatorsFound = filteredCreators.length;

    if (creatorsFound === 0) {
      await logAgentAction(userId, "creator_discovered", { count: 0 });
      return { bidsPlaced: 0, creatorsFound: 0, errors, logId: uuidv4() };
    }

    // One decision record per creator, written to the run log at the end of the run
    // (or when it stops early): what was checked and why the agent did what it did.
    for (const ct of filteredCreators) {
      decisions.set(ct.profile.handle, {
        creator: ct.profile.handle,
        matchedTags: ct.matched,
        threshold: config.minFitScore,
        floor: ct.profile.minBid,
        cap: config.maxBidPerCreator,
      });
    }
    const decide = (handle: string, decision: Decision, reason: string, extra: Partial<DecisionRecord> = {}) => {
      const rec = decisions.get(handle);
      if (rec) Object.assign(rec, extra, { decision, reason });
    };

    // Every agent pays to read a creator's gated profile before scoring them, Attnn.'s
    // own included (lib/gateway.ts). Profiles bought in the last day are read from the copy.
    const reads = await prepareProfileReads(userId, wallet, filteredCreators.map((c) => c.profile.handle), budget);
    if (reads.stop) {
      for (const ct of filteredCreators) decide(ct.profile.handle, "NOT_REACHED", reads.stop);
      await logAgentAction(userId, "agent_stopped", { reason: reads.stop, creatorsFound });
      return { bidsPlaced: 0, creatorsFound, errors: [...errors, reads.stop], logId: uuidv4() };
    }

    // Score each creator. The AI only recommends: the score and its red flag feed fixed
    // rules (your minimum score, the per-creator cap); amounts are never the AI's (D3).
    // A creator the AI couldn't score is skipped, never bid on blind.
    const qualified: { profile: typeof profiles.$inferSelect; score: number; bidAmount: bigint }[] = [];
    let unscored = 0;
    let evaluated = 0;
    for (const ct of filteredCreators) {
      const handle = ct.profile.handle;
      try {
        const view = await readProfile(reads, ct.profile);
        if (!view) {
          const why = reads.lastError ?? "couldn't read the profile";
          errors.push(`Skipping ${handle}: ${why}`);
          decide(handle, "SKIPPED", `Couldn't read the profile: ${why}`);
          continue;
        }
        const source = view.source === "x402" ? { profile: view.source, x402: { amount: view.paid.toString(), transaction: view.transaction } } : { profile: view.source };
        if (!view.isActive || view.availabilityStatus === "not_accepting") {
          decide(handle, "SKIPPED", "Not accepting bids right now", source);
          continue;
        }
        const result = await evaluateCreatorForBidder(
          { handle: view.handle, bio: view.bio ?? undefined, tags: view.tags, minBid: view.minBid },
          config.goal ?? "general",
        );
        if (!result) {
          unscored++;
          decide(handle, "SKIPPED", "The AI couldn't score this creator, so no bid (your agent never bids blind)", source);
          continue;
        }
        evaluated++;
        const scored = { ...source, score: result.score, aiReason: result.reason, flagged: !result.proceed };
        if (result.score < config.minFitScore) {
          decide(handle, "SKIPPED", `Score ${result.score}/10 is below your minimum of ${config.minFitScore}/10`, scored);
          continue;
        }
        if (!result.proceed) {
          decide(handle, "SKIPPED", `The AI flagged this creator as unsuitable${result.reason ? `: ${result.reason}` : ""}`, scored);
          continue;
        }
        // The agent bids the creator's floor; skip creators priced above the per-creator cap.
        const amount = resolveAgentBidAmount({ creatorMinBid: ct.profile.minBid, maxBidPerCreator: config.maxBidPerCreator });
        if (amount === null) {
          errors.push(`Skipping ${handle}: floor is above your ${formatUsd(BigInt(config.maxBidPerCreator))} per-creator cap`);
          decide(handle, "SKIPPED", `Floor ${formatUsd(BigInt(ct.profile.minBid))} is above your ${formatUsd(BigInt(config.maxBidPerCreator))} per-creator cap`, scored);
          continue;
        }
        decide(handle, "NOT_REACHED", "Qualified; not tried yet", scored);
        qualified.push({ profile: ct.profile, score: result.score, bidAmount: amount });
      } catch (err) {
        errors.push(`Score error for ${handle}: ${err}`);
        decide(handle, "SKIPPED", "Something went wrong while scoring; no bid");
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

    // What the agent wallet can really spend this run: its USDC, minus bids from it still
    // being placed (their USDC hasn't left yet), minus a read top-up asked for this run.
    // Each bid also keeps BID_FEE_RESERVE back for its approval + placement fees. null =
    // couldn't read the chain: the agent then bids nothing this run (fail closed).
    let spendable = await spendableNow(wallet.address, reads.topUp);

    // Highest score first; a creator the wallet or budget can't cover is skipped, not the
    // end of the run, so a cheaper qualified creator still gets its bid.
    qualified.sort((a, b) => b.score - a.score);
    let attempted = 0;
    let stopped: string | null = null;
    for (const tc of qualified) {
      const handle = tc.profile.handle;
      if (stopped) {
        decide(handle, "NOT_REACHED", stopped);
        continue;
      }
      if (bidsPlaced >= MAX_BIDS_PER_RUN) {
        decide(handle, "NOT_REACHED", `Your agent places at most ${MAX_BIDS_PER_RUN} bids per run; higher scores came first`);
        continue;
      }
      // Still ours? A run slower than the lease must stop, or it would race the next run.
      const renewed = await renewAgentLease(userId, held.token);
      if (!renewed) {
        stopped = "The run took too long and another run took over";
        await logAgentAction(userId, "agent_stopped", { reason: "Run took too long; another run took over" });
        decide(handle, "NOT_REACHED", stopped);
        continue;
      }
      held.token = renewed;

      // Budget: re-read before each bid (bids count the moment they're recorded).
      const currentSpent = await spentToday(userId);
      const budgetLeft = budget > currentSpent ? budget - currentSpent : BigInt(0);
      if (tc.bidAmount > budgetLeft) {
        errors.push(`Skipping ${handle}: bid exceeds remaining budget`);
        decide(handle, "BLOCKED", `Floor ${formatUsd(tc.bidAmount)} is more than the ${formatUsd(budgetLeft)} left in today's budget`, {
          budgetLeft: budgetLeft.toString(),
        });
        continue;
      }
      // Fail closed: if the agent wallet's balance couldn't be read from Arc, the agent
      // doesn't try to spend this run (createBidIntent's own check lets a hand-placed
      // bid through on a read error; an autonomous one must not rely on that).
      if (spendable === null) {
        decide(handle, "BLOCKED", "Couldn't read your agent wallet's balance on Arc, so no bid this run. Your agent tries again on its next run", {
          budgetLeft: budgetLeft.toString(),
        });
        continue;
      }
      if (tc.bidAmount + BID_FEE_RESERVE > spendable) {
        decide(
          handle,
          "BLOCKED",
          `Floor ${formatUsd(tc.bidAmount)} plus network fees is more than the ${formatUsd(spendable > BigInt(0) ? spendable : BigInt(0))} your agent wallet can spend`,
          { budgetLeft: budgetLeft.toString(), spendable: (spendable > BigInt(0) ? spendable : BigInt(0)).toString() },
        );
        continue;
      }

      attempted++;
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
          creator: handle,
          amount: tc.bidAmount.toString(),
          score: tc.score,
          bidId: intent.id,
          status: "placing",
        });
        bidsPlaced++;
        spendable -= tc.bidAmount + BID_FEE_RESERVE;
        decide(handle, "BID_QUEUED", `Bid of ${formatUsd(tc.bidAmount)} (the creator's floor) recorded and queued for escrow on Arc; not confirmed yet`, {
          bidId: intent.id,
          amount: tc.bidAmount.toString(),
          budgetLeft: budgetLeft.toString(),
          spendable: (spendable + tc.bidAmount + BID_FEE_RESERVE).toString(),
        });
      } catch (err) {
        const message = err instanceof BidError ? err.message : String(err);
        errors.push(`Failed to bid on ${handle}: ${message}`);
        await logAgentAction(userId, "error", { creator: handle, error: message });
        decide(handle, "FAILED", `Bid refused: ${message}`, { budgetLeft: budgetLeft.toString() });
        // Not the end of the run: a cheaper creator may still fit. Re-read what the wallet
        // can spend, in case the chain knows better than our running total (a failed
        // re-read leaves it null, and the rest are BLOCKED: fail closed).
        if (err instanceof BidError && message.startsWith("Not enough USDC")) spendable = await spendableNow(wallet.address, reads.topUp);
      }
    }

    await logAgentAction(userId, "creator_discovered", {
      count: creatorsFound,
      evaluated,
      qualified: qualified.length,
      attempted,
      queued: bidsPlaced,
      unscored,
      bidsPlaced,
      profilesBought: reads.bought,
      ...(reads.bought ? { readSpend: (PROFILE_READ_PRICE * BigInt(reads.bought)).toString() } : {}),
      ...(reads.topUp ? { readTopUp: READ_TOPUP.toString() } : {}),
    });
  }
  reportBids(bidsPlaced);
  reportFound(creatorsFound);
  return { bidsPlaced, creatorsFound, errors, logId: uuidv4() };
}

// ─── Decisions ───────────────────────────────────────────────────────────────

/**
 * What happened to one creator in a run, in plain words, from the same values the code
 * checked (never the AI's account of itself):
 *   BID_QUEUED   a bid intent was recorded ("placing") and queued for the placeBid job.
 *                It is NOT yet escrowed: the on-chain approve + placeBid happen after
 *                this run and can still fail (then the bid becomes "failed", no USDC
 *                moved). Only status "pending" means escrowed.
 *   SKIPPED      a rule said no: below your minimum, flagged, over your cap, unreadable…
 *   BLOCKED      eligible, but today's budget or the agent wallet couldn't cover it
 *   FAILED       a bid was attempted and refused
 *   NOT_REACHED  the run ended, or hit its bids-per-run limit, before this creator
 */
export type Decision = "BID_QUEUED" | "SKIPPED" | "BLOCKED" | "FAILED" | "NOT_REACHED";

export interface DecisionRecord {
  creator: string;
  matchedTags: string[];
  /** Your saved minimum fit score at the time of the run. */
  threshold: number;
  /** Creator's floor and your per-creator cap (atomic USDC). */
  floor: string;
  cap: string;
  decision?: Decision;
  reason?: string;
  profile?: "x402" | "x402_earlier" | "free";
  x402?: { amount: string; transaction: string };
  score?: number;
  /** The AI's one-line reason for its score: advice, never authority. */
  aiReason?: string;
  /** The AI flagged the creator as unsuitable (spam, impersonation, unrelated). */
  flagged?: boolean;
  /** Atomic USDC at the moment of the decision. */
  budgetLeft?: string;
  spendable?: string;
  amount?: string;
  bidId?: string;
}

/** Most bids one run may place (highest scores first). */
export const MAX_BIDS_PER_RUN = 5;

/**
 * Kept back per bid for its network fees: an approval and the placement, both paid in
 * USDC from the agent wallet on Arc. AN ESTIMATE, not a measured fee: $0.05 is set well
 * above what two Arc transactions normally cost, so near the edge the agent may skip a
 * creator it could just about afford, never the other way round. It only decides
 * whether the agent TRIES a bid; the real limits are enforced later regardless:
 * createBidIntent re-reads the on-chain balance, the placeBid job approves exactly the
 * bid amount, and an underfunded placement reverts on Arc with no USDC moved.
 */
export const BID_FEE_RESERVE = AGENT_WALLET_GAS_RESERVE;

/**
 * What the agent wallet can spend on bids right now: its USDC, minus bids from it still
 * being placed (their USDC hasn't left the wallet yet), minus a read top-up asked for this
 * run (plus its two transactions' fees). null if the chain couldn't be read.
 */
async function spendableNow(address: string, topUpRequested: boolean): Promise<bigint | null> {
  try {
    const [balance, [row]] = await Promise.all([
      getUsdcBalance(address),
      db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${bids.amountUsdc} AS BIGINT)), 0)` })
        .from(bids)
        .where(and(sql`lower(${bids.bidderAddress}) = ${address.toLowerCase()}`, eq(bids.status, "placing"))),
    ]);
    const committed = BigInt(row?.total ?? "0");
    const topUp = topUpRequested ? READ_TOPUP + AGENT_WALLET_GAS_RESERVE * BigInt(2) : BigInt(0);
    return balance - committed - topUp;
  } catch (err) {
    console.warn("runBidderAgent: couldn't work out the spendable balance:", err);
    return null;
  }
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
