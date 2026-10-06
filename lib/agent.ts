import { db } from "./db/client";
import { bids, agentLogs, profiles, bidderConfigs, wallets } from "./db/schema";
import { evaluateCreatorForBidder } from "./ai";
import { registryAbi, publicClient } from "./arc";
import { BidError, createBidIntent } from "./bids";
import { formatUsd, resolveAgentBidAmount } from "./bid-rules";
import { eq, and, gte, ne, sql } from "drizzle-orm";
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

    // Discover creators by tags (on-chain registry)
    const registryAddr = process.env.ATTN_REGISTRY_CONTRACT as `0x${string}`;
    const creatorAddresses = new Set<string>();
    for (const tag of config.searchTags) {
      try {
        const addresses = await publicClient.readContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: "getCreatorsByTag",
          args: [tag],
        });
        addresses.forEach((a) => creatorAddresses.add(a.toLowerCase()));
      } catch (err) {
        errors.push(`Failed to query tag "${tag}": ${err}`);
      }
    }

    if (creatorAddresses.size === 0) {
      await logAgentAction(userId, "creator_discovered", { count: 0 });
      return { bidsPlaced: 0, creatorsFound: 0, errors, logId: uuidv4() };
    }

    // Active creators in the DB whose wallet is in the registry results
    const activeProfiles = await db.query.profiles.findMany({ where: eq(profiles.isActive, true) });
    const creatorsToScore: { profile: typeof profiles.$inferSelect; address: string }[] = [];
    for (const profile of activeProfiles) {
      if (profile.userId === userId || profile.availabilityStatus === "not_accepting") continue;
      const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, profile.userId) });
      if (wallet && creatorAddresses.has(wallet.address.toLowerCase())) {
        creatorsToScore.push({ profile, address: wallet.address });
      }
    }

    // No re-bidding the same creator in one UTC day. Failed attempts count too, so a
    // creator the agent can't afford isn't retried every 30 minutes.
    const todayBids = await db
      .select({ creatorUserId: bids.creatorUserId })
      .from(bids)
      .where(and(eq(bids.bidderUserId, userId), gte(bids.createdAt, startOfUtcDay())));
    const alreadyBidToday = new Set(todayBids.map((b) => b.creatorUserId));
    const filteredCreators = creatorsToScore.filter((ct) => !alreadyBidToday.has(ct.profile.userId));
    creatorsFound = filteredCreators.length;

    if (creatorsFound === 0) {
      await logAgentAction(userId, "creator_discovered", { count: 0 });
      return { bidsPlaced: 0, creatorsFound: 0, errors, logId: uuidv4() };
    }

    // Score up to 10; keep those above the bidder's fit threshold.
    const scored: { profile: typeof profiles.$inferSelect; score: number; bidAmount: bigint }[] = [];
    for (const ct of filteredCreators.slice(0, 10)) {
      try {
        const result = await evaluateCreatorForBidder(
          { handle: ct.profile.handle, bio: ct.profile.bio ?? undefined, tags: ct.profile.tags, minBid: ct.profile.minBid },
          config.goal ?? "general",
        );
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

    await logAgentAction(userId, "creator_discovered", { count: creatorsFound, scored: scored.length, bidsPlaced });
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
