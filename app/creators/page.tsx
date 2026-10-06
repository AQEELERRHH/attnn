import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bidderConfigs, profiles } from "@/lib/db/schema";
import { SiteHeader } from "@/components/market/site-header";
import { arc } from "@/lib/chain";
import { computeCreatorStats, computePlatformTotals, loadMarketBids, readEscrowBalance, type MarketBid } from "@/lib/market";
import { MarketsView, type MarketRow, type TickerFill } from "./markets-view";

export const revalidate = 60;
export const metadata = {
  title: "Attention markets · Attnn.",
  description: "Every creator is a market. Bids are escrowed USDC on Arc, paid out on reply, refunded after 3 days without one.",
};

export default async function CreatorsPage() {
  const now = Date.now();
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

  const totals = computePlatformTotals(marketBids, now);

  // Latest fills across all markets, for the ticker.
  const handleByUser = new Map(creatorProfiles.map((p) => [p.userId, p.handle]));
  const recentFills = marketBids
    .filter((b) => b.status === "accepted" && b.settledAt && b.settlementOnChainTxHash && handleByUser.has(b.creatorUserId))
    .sort((a, b) => b.settledAt!.getTime() - a.settledAt!.getTime())
    .slice(0, 8);
  const ticker: TickerFill[] = recentFills.map((b) => ({
    handle: handleByUser.get(b.creatorUserId)!,
    amountUsdc: b.amountUsdc,
    settledAt: b.settledAt!.toISOString(),
  }));

  return (
    <div className="min-h-screen bg-arc-bg-0">
      <SiteHeader networkLabel={arc.chain.name} />
      <MarketsView
        rows={rows}
        ticker={ticker}
        now={now}
        totals={{
          escrowUsdc: escrowOnChain ?? totals.openEscrowUsdc,
          escrowSource: escrowOnChain ? "Read live from AttnnEscrow" : "Open bids in escrow",
          settled24hUsdc: totals.settled24hUsdc,
          settledPrev24hUsdc: totals.settledPrev24hUsdc,
          cleared24h: totals.cleared24h,
          refunded24h: totals.refunded24h,
          activeAgents,
          medianReply7dMs: totals.medianReply7dMs,
        }}
      />
    </div>
  );
}
