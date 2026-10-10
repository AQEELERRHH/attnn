import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { wallets, profiles, bidderConfigs, bids, agentLogs, users } from "@/lib/db/schema";
import { isGooglePhoto } from "@/lib/avatar-storage";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { addressUrl, arc, escrowAddress, txUrl } from "@/lib/chain";
import { ESCROW_MAX_BID, ESCROW_MIN_BID, REFUND_PERIOD_MS } from "@/lib/bid-rules";
import { getUsdcBalance } from "@/lib/activation";
import { spentToday } from "@/lib/agent";
import { registrationState } from "@/lib/registration";
import { computeCreatorStats, loadMarketBids } from "@/lib/market";
import { bookRanks, computeBidderTotals, computeCreatorTotals } from "@/lib/portfolio";
import { DashboardClient } from "./dashboard-client";
import type { BidData, PortfolioSummary } from "./types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio · Attnn." };

const DAY = 24 * 60 * 60 * 1000;

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/register");

  const userId = session.user.id;
  const now = Date.now();

  const [wallet, profile, bidderCfg, account] = await Promise.all([
    db.query.wallets.findFirst({ where: eq(wallets.userId, userId) }),
    db.query.profiles.findFirst({ where: eq(profiles.userId, userId) }),
    db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, userId) }),
    db.query.users.findFirst({ where: eq(users.id, userId), columns: { image: true } }),
  ]);

  // Everything still open, plus the last 30 days of history, on either side of the market.
  const myBids = await db.query.bids.findMany({
    where: and(
      or(eq(bids.bidderUserId, userId), eq(bids.creatorUserId, userId)),
      or(inArray(bids.status, ["placing", "pending", "counter_offered"]), gte(bids.createdAt, new Date(now - 30 * DAY))),
    ),
    orderBy: desc(bids.createdAt),
    limit: 300,
  });

  const creatorIds = [...new Set(myBids.map((b) => b.creatorUserId))];
  const bidderIds = [...new Set(myBids.map((b) => b.bidderUserId))];
  const myOpenCreatorIds = [
    ...new Set(
      myBids
        .filter((b) => b.bidderUserId === userId && (b.status === "pending" || b.status === "counter_offered"))
        .map((b) => b.creatorUserId),
    ),
  ];

  const [walletUsdc, spent, earnedRow, creatorMarket, creatorProfiles, agentConfigs, openBook, logs] = await Promise.all([
    wallet ? getUsdcBalance(wallet.address).then((v) => v.toString()).catch(() => null) : Promise.resolve(null),
    spentToday(userId),
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${bids.amountUsdc} AS BIGINT)), 0)` })
      .from(bids)
      .where(and(eq(bids.creatorUserId, userId), eq(bids.status, "accepted"), isNotNull(bids.settlementOnChainTxHash))),
    profile ? loadMarketBids(userId, now) : Promise.resolve([]),
    creatorIds.length
      ? db.query.profiles.findMany({
          where: inArray(profiles.userId, creatorIds),
          columns: { userId: true, handle: true, avatarUrl: true },
        })
      : Promise.resolve([]),
    // Only the bidders that appear in these bids (this used to load every config).
    bidderIds.length
      ? db.query.bidderConfigs.findMany({
          where: inArray(bidderConfigs.userId, bidderIds),
          columns: { userId: true, agentName: true },
        })
      : Promise.resolve([]),
    myOpenCreatorIds.length
      ? db.query.bids.findMany({
          where: and(inArray(bids.creatorUserId, myOpenCreatorIds), inArray(bids.status, ["pending", "counter_offered"])),
          columns: { creatorUserId: true, amountUsdc: true },
        })
      : Promise.resolve([]),
    db.query.agentLogs.findMany({
      where: eq(agentLogs.userId, userId),
      orderBy: desc(agentLogs.createdAt),
      limit: 50,
    }),
  ]);

  const handleByUser = new Map(creatorProfiles.map((p) => [p.userId, p]));
  const agentNameByUser = new Map(agentConfigs.filter((c) => c.agentName).map((c) => [c.userId, c.agentName!]));
  const ranks = bookRanks(
    myBids.filter((b) => b.bidderUserId === userId && (b.status === "pending" || b.status === "counter_offered")),
    openBook,
  );

  const bidRows: BidData[] = myBids.map((b) => ({
    id: b.id,
    bidderUserId: b.bidderUserId,
    creatorUserId: b.creatorUserId,
    bidderAddress: b.bidderAddress,
    creatorAddress: b.creatorAddress,
    amountUsdc: b.amountUsdc,
    message: b.message,
    status: b.status,
    score: b.score,
    reply: b.reply,
    settlementTxHash: b.settlementTxHash,
    settlementAction: b.settlementAction ?? null,
    failReason: b.failReason ?? null,
    createdAt: b.createdAt.toISOString(),
    settledAt: b.settledAt?.toISOString() ?? null,
    counterOfferAmount: b.counterOfferAmount ?? null,
    replacesBidId: b.replacesBidId ?? null,
    bidTxHref: b.onChainTxHash ? txUrl(b.onChainTxHash) : null,
    settlementOnChainTxHash: b.settlementOnChainTxHash ?? null,
    settlementTxHref: b.settlementOnChainTxHash ? txUrl(b.settlementOnChainTxHash) : null,
    agentName: agentNameByUser.get(b.bidderUserId) ?? null,
    creatorHandle: handleByUser.get(b.creatorUserId)?.handle ?? null,
    creatorAvatarUrl: handleByUser.get(b.creatorUserId)?.avatarUrl ?? null,
    bookRank: ranks.get(b.id) ?? null,
  }));

  const bidderTotals = computeBidderTotals(myBids, userId, now);
  const creatorTotals = computeCreatorTotals(myBids, userId, now);
  const market = profile ? computeCreatorStats(creatorMarket, profile.minBid, now) : null;

  const summary: PortfolioSummary = {
    walletUsdc,
    bidder: { ...bidderTotals, spentTodayUsdc: spent.toString() },
    creator: {
      waiting: creatorTotals.waiting,
      earnedAllTimeUsdc: BigInt(earnedRow[0]?.total ?? "0").toString(),
      earned7d: creatorTotals.earned7d,
      replyRate: market?.replyRate ?? null,
      medianReplyMs: market?.medianReplyMs ?? null,
    },
  };

  return (
    <DashboardClient
      now={now}
      networkLabel={arc.chain.name}
      policy={{
        escrowAddress: escrowAddress(),
        escrowHref: escrowAddress() ? addressUrl(escrowAddress()!) : null,
        walletHref: wallet ? addressUrl(wallet.address) : null,
        minBid: ESCROW_MIN_BID.toString(),
        maxBid: ESCROW_MAX_BID.toString(),
        refundDays: Math.round(REFUND_PERIOD_MS / DAY),
      }}
      wallet={wallet ? { id: wallet.id, address: wallet.address, circleWalletId: wallet.circleWalletId, blockchain: wallet.blockchain, state: wallet.state } : null}
      profile={
        profile
          ? {
              id: profile.id,
              handle: profile.handle,
              minBid: profile.minBid,
              tags: profile.tags,
              bio: profile.bio,
              autoAcceptThreshold: profile.autoAcceptThreshold,
              autoReplyTemplate: profile.autoReplyTemplate ?? null,
              isActive: profile.isActive,
              registration: registrationState(profile),
              registrationError: profile.registrationError ?? null,
              availabilityStatus: profile.availabilityStatus ?? "available",
              openTo: profile.openTo ?? [],
              avatarUrl: profile.avatarUrl ?? null,
            }
          : null
      }
      hasGooglePhoto={isGooglePhoto(account?.image)}
      bidderConfig={
        bidderCfg
          ? {
              id: bidderCfg.id,
              goal: bidderCfg.goal,
              dailyBudget: bidderCfg.dailyBudget,
              maxBidPerCreator: bidderCfg.maxBidPerCreator,
              minFitScore: bidderCfg.minFitScore,
              searchTags: bidderCfg.searchTags,
              defaultMessage: bidderCfg.defaultMessage,
              isActive: bidderCfg.isActive,
              agentName: bidderCfg.agentName ?? null,
            }
          : null
      }
      bids={bidRows}
      summary={summary}
      logs={logs.map((l) => ({
        id: l.id,
        action: l.action,
        data: l.data,
        txHash: l.txHash,
        txHref: l.txHash?.startsWith("0x") ? txUrl(l.txHash) : null,
        createdAt: l.createdAt.toISOString(),
      }))}
      userId={userId}
      userRole={session.user.role}
    />
  );
}
