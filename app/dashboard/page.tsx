import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { wallets, profiles, bidderConfigs, bids, agentLogs } from "@/lib/db/schema";
import { eq, or, desc } from "drizzle-orm";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/register");

  const userId = session.user.id;

  const [wallet, profile, bidderCfg] = await Promise.all([
    db.query.wallets.findFirst({ where: eq(wallets.userId, userId) }),
    db.query.profiles.findFirst({ where: eq(profiles.userId, userId) }),
    db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, userId) }),
  ]);

  const recentBids = await db.query.bids.findMany({
    where: or(eq(bids.bidderUserId, userId), eq(bids.creatorUserId, userId)),
    orderBy: desc(bids.createdAt),
    limit: 20,
  });

  const logs = await db.query.agentLogs.findMany({
    where: eq(agentLogs.userId, userId),
    orderBy: desc(agentLogs.createdAt),
    limit: 50,
  });

  return (
    <DashboardClient
      wallet={wallet ? { id: wallet.id, address: wallet.address, circleWalletId: wallet.circleWalletId, blockchain: wallet.blockchain, state: wallet.state } : null}
      profile={profile ? { id: profile.id, handle: profile.handle, minBid: profile.minBid, tags: profile.tags, bio: profile.bio, autoAcceptThreshold: profile.autoAcceptThreshold, isActive: profile.isActive } : null}
      bidderConfig={bidderCfg ? { id: bidderCfg.id, goal: bidderCfg.goal, dailyBudget: bidderCfg.dailyBudget, maxBidPerCreator: bidderCfg.maxBidPerCreator, minFitScore: bidderCfg.minFitScore, searchTags: bidderCfg.searchTags, defaultMessage: bidderCfg.defaultMessage, isActive: bidderCfg.isActive } : null}
      bids={recentBids.map(b => ({ id: b.id, onChainBidId: b.onChainBidId, bidderUserId: b.bidderUserId, creatorUserId: b.creatorUserId, bidderAddress: b.bidderAddress, creatorAddress: b.creatorAddress, amountUsdc: b.amountUsdc, message: b.message, status: b.status, score: b.score, reply: b.reply, bidTxHash: b.bidTxHash, settlementTxHash: b.settlementTxHash, createdAt: b.createdAt.toISOString(), settledAt: b.settledAt?.toISOString() ?? null }))}
      logs={logs.map(l => ({ id: l.id, action: l.action, data: l.data, txHash: l.txHash, createdAt: l.createdAt.toISOString() }))}
      userId={userId}
      userRole={session.user.role}
    />
  );
}
