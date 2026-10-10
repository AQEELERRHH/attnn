import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bidderConfigs, bids, profiles } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { arc, escrowAddress, txUrl } from "@/lib/chain";
import { computeCreatorStats, loadMarketBids } from "@/lib/market";
import { SiteHeader } from "@/components/market/site-header";
import { CreatorMarket, type CreatorMarketProps } from "./client";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return { title: `@${handle} · Attention market · Attnn.` };
}

export default async function CreatorMarketPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.handle, handle) });
  if (!profile) notFound();

  const now = Date.now();
  const [marketBids, openRows, session] = await Promise.all([
    loadMarketBids(profile.userId, now),
    db
      .select({ id: bids.id, bidderUserId: bids.bidderUserId, amountUsdc: bids.amountUsdc, createdAt: bids.createdAt, score: bids.score })
      .from(bids)
      .where(and(eq(bids.creatorUserId, profile.userId), inArray(bids.status, ["pending", "counter_offered"]))),
    auth(),
  ]);
  const stats = computeCreatorStats(marketBids, profile.minBid, now);

  // Names for bidders in the book and in fills: agent name, else handle, else generic.
  const bidderIds = [...new Set([...openRows.map((b) => b.bidderUserId), ...stats.fills.map((f) => f.bidderUserId)])];
  const viewerId = session?.user?.id ?? null;
  const lookupIds = viewerId ? [...new Set([...bidderIds, viewerId])] : bidderIds;
  const [configs, bidderProfiles] = lookupIds.length
    ? await Promise.all([
        db.select({ userId: bidderConfigs.userId, agentName: bidderConfigs.agentName }).from(bidderConfigs).where(inArray(bidderConfigs.userId, lookupIds)),
        db.select({ userId: profiles.userId, handle: profiles.handle }).from(profiles).where(inArray(profiles.userId, lookupIds)),
      ])
    : [[], []];
  const agentBy = new Map(configs.map((c) => [c.userId, c.agentName]));
  const handleBy = new Map(bidderProfiles.map((p) => [p.userId, p.handle]));
  const nameFor = (userId: string) => agentBy.get(userId) || (handleBy.get(userId) ? `@${handleBy.get(userId)}` : "Bidder");
  const ownerFor = (userId: string) => (agentBy.get(userId) && handleBy.get(userId) ? `@${handleBy.get(userId)}` : null);

  const isOwner = viewerId === profile.userId;
  const paused = !profile.isActive || profile.availabilityStatus === "not_accepting";
  const escrow = escrowAddress();

  const props: CreatorMarketProps = {
    handle: profile.handle,
    avatarUrl: profile.avatarUrl,
    tags: profile.tags,
    paused,
    registeredOnChain: profile.isActive,
    stats: {
      floorUsdc: stats.floorUsdc,
      topBidUsdc: stats.topBidUsdc,
      lastClearedUsdc: stats.lastClearedUsdc,
      prevClearedUsdc: stats.prevClearedUsdc,
      volume7dUsdc: stats.volume7dUsdc,
      replyRate: stats.replyRate,
      medianReplyMs: stats.medianReplyMs,
      openBids: stats.openBids,
      hasHistory: stats.hasHistory,
      ratingsUp: stats.ratingsUp,
      ratingsDown: stats.ratingsDown,
      repliesKnown: stats.repliesKnown,
      autoReplies: stats.autoReplies,
    },
    book: openRows.map((b) => ({
      id: b.id,
      agent: nameFor(b.bidderUserId),
      owner: ownerFor(b.bidderUserId),
      amountUsdc: b.amountUsdc,
      createdAt: b.createdAt.toISOString(),
      score: b.score,
    })),
    fills: stats.fills.map((f) => ({
      id: f.bidId,
      agent: nameFor(f.bidderUserId),
      amountUsdc: f.amountUsdc,
      settledAt: f.settledAt,
      replyMs: f.replyMs,
      txHash: f.txHash,
      txHref: txUrl(f.txHash),
      autoReply: f.autoReply,
      rating: f.rating,
    })),
    viewer: viewerId
      ? { signedIn: true, isOwner, biddingAs: agentBy.get(viewerId) || (handleBy.get(viewerId) ? `@${handleBy.get(viewerId)}` : "You") }
      : { signedIn: false, isOwner: false, biddingAs: "" },
    // Signed-in users see private details free; anonymous visitors get the x402 gate.
    details: viewerId
      ? { unlocked: true, bio: profile.bio, openTo: profile.openTo, availabilityStatus: profile.availabilityStatus }
      : { unlocked: false, bio: null, openTo: [], availabilityStatus: null },
    escrowAddress: escrow,
    escrowHref: escrow ? `${arc.explorerUrl.replace(/\/$/, "")}/address/${escrow}` : null,
    apiPath: `/api/c/${profile.handle}`,
    now,
  };

  return (
    <div className="min-h-screen bg-arc-bg-0">
      <SiteHeader networkLabel={arc.chain.name} />
      <CreatorMarket {...props} />
    </div>
  );
}
