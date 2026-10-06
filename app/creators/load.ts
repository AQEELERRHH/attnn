import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bidderConfigs, profiles } from "@/lib/db/schema";
import { computeCreatorStats, computePlatformTotals, loadMarketBids, readEscrowBalance, type MarketBid } from "@/lib/market";
import type { MarketRow, MarketTotals, TickerFill } from "./markets-view";

/**
 * Everything the markets table and the homepage show: one row per active
 * creator, the latest fills and the platform totals. Server only.
 */
export async function loadMarkets(now: number): Promise<{ rows: MarketRow[]; ticker: TickerFill[]; totals: MarketTotals }> {
  const [creatorProfiles, marketBids, escrowOnChain, activeAgents] = await Promise.all([
    db.query.profiles.findMany({ where: eq(profiles.isActive, true) }),
    loadMarketBids(undefined, now),
    readEscrowBalance(),
    db.$count(bidderConfigs, eq(bidderConfigs.isActive, true)),
  ]);

  const byCreator = new Map<string, MarketBid[]>();
  for (const b of marketBids) {
    const list = byCreator.get(b.creatorUserId) ?? [];
    list.push(b);
    byCreator.set(b.creatorUserId, list);
  }

  const rows: MarketRow[] = creatorProfiles.map((p) => {
    const s = computeCreatorStats(byCreator.get(p.userId) ?? [], p.minBid, now);
    return {
      handle: p.handle,
      avatarUrl: p.avatarUrl,
      tags: p.tags,
      paused: p.availabilityStatus === "not_accepting",
      floorUsdc: s.floorUsdc,
      topBidUsdc: s.topBidUsdc,
      lastClearedUsdc: s.lastClearedUsdc,
      prevClearedUsdc: s.prevClearedUsdc,
      volume7dUsdc: s.volume7dUsdc,
      replyRate: s.replyRate,
      medianReplyMs: s.medianReplyMs,
      openBids: s.openBids,
      trend7d: s.trend7d,
      hasHistory: s.hasHistory,
    };
  });

  const t = computePlatformTotals(marketBids, now);

  // Latest fills across all markets, for the ticker.
  const handleByUser = new Map(creatorProfiles.map((p) => [p.userId, p.handle]));
  const ticker: TickerFill[] = marketBids
    .filter((b) => b.status === "accepted" && b.settledAt && b.settlementOnChainTxHash && handleByUser.has(b.creatorUserId))
    .sort((a, b) => b.settledAt!.getTime() - a.settledAt!.getTime())
    .slice(0, 8)
    .map((b) => ({ handle: handleByUser.get(b.creatorUserId)!, amountUsdc: b.amountUsdc, settledAt: b.settledAt!.toISOString() }));

  return {
    rows,
    ticker,
    totals: {
      escrowUsdc: escrowOnChain ?? t.openEscrowUsdc,
      escrowSource: escrowOnChain ? "Read live from AttnnEscrow" : "Open bids in escrow",
      settled24hUsdc: t.settled24hUsdc,
      settledPrev24hUsdc: t.settledPrev24hUsdc,
      cleared24h: t.cleared24h,
      refunded24h: t.refunded24h,
      activeAgents,
      medianReply7dMs: t.medianReply7dMs,
    },
  };
}
