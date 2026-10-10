import { db } from "./db/client";
import { bids, agentLogs, profiles, bidderConfigs, wallets } from "./db/schema";
import { evaluateCreatorForBidder } from "./ai";
import { isActiveOnRegistry } from "./registration";
import { BidError, createBidIntent } from "./bids";
import { ESCROW_MIN_BID, formatUsd, resolveAgentBidAmount } from "./bid-rules";
import { getUsdcBalance } from "./activation";
import { agentWallet } from "./wallets";
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
  const errors: string[] = [];
  let bidsPlaced = 0;
  let creatorsFound = 0;

  try {
    const config = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, userId) });
    if (!config || !config.isActive) {
      await logAgentAction(userId, "agent_stopped", { reason: "Config not active" });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["Bidder config not active"], logId: "" };
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
          .where(and(inArray(wallets.userId, matches.map((m) => m.profile.userId)), eq(wallets.purpose, "main")))
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

    // Score up to 10; keep those above the bidder's fit threshold.
    // A creator the AI couldn't score is skipped, never bid on blind.
    const scored: { profile: typeof profiles.$inferSelect; score: number; bidAmount: bigint }[] = [];
    let unscored = 0;
    for (const ct of filteredCreators) {
      try {
        const result = await evaluateCreatorForBidder(
          { handle: ct.profile.handle, bio: ct.profile.bio ?? undefined, tags: ct.profile.tags, minBid: ct.profile.minBid },
          config.goal ?? "general",
        );
        if (!result) {
          unscored++;
          continue;
        }
        if (!result.proceed || result.score < config.minFitScore) continue;

        // The AI's amount is a hint. Clamp it to the creator's floor and the
        // bidder's per-creator cap; skip creators priced above the cap.
        const amount = resolveAgentBidAmount({
          suggested: result.bidAmount,
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

    await logAgentAction(userId, "creator_discovered", { count: creatorsFound, scored: scored.length, unscored, bidsPlaced });
  } catch (err) {
    errors.push(`Agent run failed: ${err}`);
  }

  return { bidsPlaced, creatorsFound, errors, logId: uuidv4() };
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
