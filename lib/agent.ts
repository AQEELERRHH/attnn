import { db } from "./db/client";
import { bids, agentLogs, profiles, bidderConfigs, wallets } from "./db/schema";
import { evaluateCreatorForBidder, draftReply, scoreBidForCreator } from "./ai";
import { executeContractCall } from "./circle";
import { escrowAbi, registryAbi, publicClient } from "./arc";
import { eq, and, gte, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// ─── Bidder Agent Run ────────────────────────────────────────────────────────

export interface AgentRunResult {
  bidsPlaced: number;
  creatorsFound: number;
  errors: string[];
  logId: string;
}

export async function runBidderAgent(userId: string): Promise<AgentRunResult> {
  const errors: string[] = [];
  let bidsPlaced = 0;
  let creatorsFound = 0;

  try {
    // Load bidder config
    const config = await db.query.bidderConfigs.findFirst({
      where: eq(bidderConfigs.userId, userId),
    });

    if (!config || !config.isActive) {
      await logAgentAction(userId, "agent_stopped", { reason: "Config not active" });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["Bidder config not active"], logId: "" };
    }

    // Check daily budget
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySpent = await db
      .select({ total: sql<string>`COALESCE(SUM(CAST(amount_usdc AS BIGINT)), '0')` })
      .from(bids)
      .where(
        and(
          eq(bids.bidderUserId, userId),
          gte(bids.createdAt, today),
          eq(bids.status, "accepted"),
        ),
      );

    const spent = BigInt(todaySpent[0]?.total ?? "0");
    const budget = BigInt(config.dailyBudget);

    if (spent >= budget) {
      await logAgentAction(userId, "agent_stopped", { reason: "Daily budget exhausted", spent: spent.toString(), budget: config.dailyBudget });
      return { bidsPlaced: 0, creatorsFound: 0, errors: ["Daily budget exhausted"], logId: "" };
    }

    // Discover creators by tags
    const creatorAddresses = new Set<string>();
    for (const tag of config.searchTags) {
      try {
        const registryAddr = process.env.ATTN_REGISTRY_CONTRACT as `0x${string}`;
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

    // Get active creators from DB
    const activeProfiles = await db.query.profiles.findMany({
      where: eq(profiles.isActive, true),
      with: { user: true },
    });

    const creatorsToScore: { profile: typeof profiles.$inferSelect; address: string }[] = [];

    for (const profile of activeProfiles) {
      const wallet = await db.query.wallets.findFirst({
        where: eq(wallets.userId, profile.userId),
      });
      if (wallet && creatorAddresses.has(wallet.address.toLowerCase())) {
        creatorsToScore.push({ profile, address: wallet.address });
      }
    }

    creatorsFound = creatorsToScore.length;

    if (creatorsFound === 0) {
      await logAgentAction(userId, "creator_discovered", { count: 0 });
      return { bidsPlaced: 0, creatorsFound: 0, errors, logId: uuidv4() };
    }

    // Score each creator
    const scored: { profile: typeof profiles.$inferSelect; address: string; score: number; bidAmount: string }[] = [];

    for (const ct of creatorsToScore.slice(0, 10)) {
      try {
        const result = await evaluateCreatorForBidder(
          {
            handle: ct.profile.handle,
            bio: ct.profile.bio ?? undefined,
            tags: ct.profile.tags,
            minBid: ct.profile.minBid,
          },
          config.goal ?? "general",
        );

        if (result.proceed && result.score >= config.minFitScore) {
          scored.push({
            ...ct,
            score: result.score,
            bidAmount: result.bidAmount,
          });
        }
      } catch (err) {
        errors.push(`Score error for ${ct.profile.handle}: ${err}`);
      }
    }

    // Sort by score descending, take top 5
    scored.sort((a, b) => b.score - a.score);
    const topCreators = scored.slice(0, 5);

    // Place bids
    const bidderWallet = await db.query.wallets.findFirst({
      where: eq(wallets.userId, userId),
    });

    if (!bidderWallet) {
      errors.push("No wallet found for bidder");
      return { bidsPlaced: 0, creatorsFound, errors, logId: uuidv4() };
    }

    const escrowAddr = process.env.ATTN_ESCROW_CONTRACT as `0x${string}`;

    for (const tc of topCreators) {
      const remaining = budget - spent;
      const bidAmount = BigInt(tc.bidAmount);

      if (bidAmount > remaining) {
        errors.push(`Skipping ${tc.profile.handle}: bid exceeds remaining budget`);
        continue;
      }

      try {
        const result = await executeContractCall({
          walletId: bidderWallet.circleWalletId,
          contractAddress: escrowAddr,
          abi: escrowAbi as any,
          functionName: "placeBid",
          args: [tc.address, tc.bidAmount, config.defaultMessage ?? "AI-discovered opportunity", false],
        });

        await db.insert(bids).values({
          bidderUserId: userId,
          creatorUserId: tc.profile.userId,
          bidderAddress: bidderWallet.address,
          creatorAddress: tc.address,
          amountUsdc: tc.bidAmount,
          message: config.defaultMessage ?? "AI-discovered opportunity",
          status: "pending",
          score: tc.score,
          bidTxHash: result.txId,
        });

        await logAgentAction(userId, "bid_placed", {
          creator: tc.profile.handle,
          amount: tc.bidAmount,
          score: tc.score,
          txId: result.txId,
        });

        bidsPlaced++;
      } catch (err) {
        errors.push(`Failed to place bid on ${tc.profile.handle}: ${err}`);
      }
    }

    await logAgentAction(userId, "creator_discovered", {
      count: creatorsFound,
      scored: scored.length,
      bidsPlaced,
    });
  } catch (err) {
    errors.push(`Agent run failed: ${err}`);
  }

  return { bidsPlaced, creatorsFound, errors, logId: uuidv4() };
}

// ─── Auto-Accept (via Webhook) ───────────────────────────────────────────────

export interface AutoAcceptResult {
  accepted: boolean;
  reply?: string;
  error?: string;
}

export async function autoAcceptBid(bidId: string, creatorUserId: string): Promise<AutoAcceptResult> {
  try {
    const creatorProfile = await db.query.profiles.findFirst({
      where: eq(profiles.userId, creatorUserId),
    });
    if (!creatorProfile) return { accepted: false, error: "Creator profile not found" };

    const bid = await db.query.bids.findFirst({
      where: eq(bids.id, bidId),
    });
    if (!bid) return { accepted: false, error: "Bid not found" };
    if (bid.status !== "pending") return { accepted: false, error: `Bid already ${bid.status}` };

    const scoring = await scoreBidForCreator(
      { amountUsdc: bid.amountUsdc, message: bid.message ?? "", bidderAddress: bid.bidderAddress },
      { handle: creatorProfile.handle, bio: creatorProfile.bio ?? undefined, tags: creatorProfile.tags, minBid: creatorProfile.minBid },
    );

    if (scoring.recommendation === "accept" && scoring.score >= (creatorProfile.autoAcceptThreshold ?? 5)) {
      const reply = await draftReply(bid.message ?? "", { handle: creatorProfile.handle, bio: creatorProfile.bio ?? undefined });

      if (reply.length < 10) {
        return { accepted: false, error: "Reply too short (minimum 10 characters)" };
      }

      // Accept on-chain via Circle wallet
      const creatorWallet = await db.query.wallets.findFirst({
        where: eq(wallets.userId, creatorUserId),
      });

      if (!creatorWallet) return { accepted: false, error: "Creator wallet not found" };

      const escrowAddr = process.env.ATTN_ESCROW_CONTRACT as `0x${string}`;

      const result = await executeContractCall({
        walletId: creatorWallet.circleWalletId,
        contractAddress: escrowAddr,
        abi: escrowAbi as any,
        functionName: "acceptBid",
        args: [BigInt(bid.onChainBidId ?? "0"), reply],
      });

      await db
        .update(bids)
        .set({
          status: "accepted",
          reply,
          settlementTxHash: result.txId,
          settledAt: new Date(),
        })
        .where(eq(bids.id, bidId));

      await logAgentAction(creatorUserId, "bid_accepted", {
        bidId,
        reply,
        txId: result.txId,
        score: scoring.score,
      });

      return { accepted: true, reply };
    }

    return { accepted: false, error: `Score ${scoring.score} below threshold ${creatorProfile.autoAcceptThreshold}` };
  } catch (err) {
    return { accepted: false, error: `Auto-accept failed: ${err}` };
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

async function logAgentAction(
  userId: string,
  action: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(agentLogs).values({
      userId,
      action: action as any,
      data,
    });
  } catch (err) {
    console.error("Failed to log agent action:", err);
  }
}
