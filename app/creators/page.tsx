import { db } from "@/lib/db/client";
import { profiles, bids } from "@/lib/db/schema";
import { eq, and, count, max } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { formatUsdc } from "@/lib/arc";

export const revalidate = 60;

export default async function CreatorsPage() {
  const activeCreators = await db.query.profiles.findMany({
    where: eq(profiles.isActive, true),
    with: { user: true },
  });

  // Fetch highest bid and pending count for each creator
  const creatorStats = await Promise.all(
    activeCreators.map(async (creator) => {
      const [highestBidResult, pendingCountResult, dealCountResult] = await Promise.all([
        db.select({ max: max(bids.amountUsdc) })
          .from(bids)
          .where(and(eq(bids.creatorUserId, creator.userId), eq(bids.status, "pending"))),
        db.select({ count: count() })
          .from(bids)
          .where(and(eq(bids.creatorUserId, creator.userId), eq(bids.status, "pending"))),
        db.select({ count: count() })
          .from(bids)
          .where(and(eq(bids.creatorUserId, creator.userId), eq(bids.status, "accepted"))),
      ]);
      return {
        id: creator.id,
        highestBid: highestBidResult[0]?.max ?? null,
        pendingCount: Number(pendingCountResult[0]?.count ?? 0),
        dealCount: Number(dealCountResult[0]?.count ?? 0),
      };
    })
  );

  const statsMap = Object.fromEntries(creatorStats.map(s => [s.id, s]));

  return (
    <div className="min-h-screen bg-arc-bg-0">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-arc-bg-0/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/attnn-logo.jpeg" alt="Attnn." className="w-8 h-8 rounded-lg object-cover" />
            <span className="font-display font-bold text-xl">attnn.</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/about">
              <Button variant="ghost" size="sm">About</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="default" size="sm">Dashboard</Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 pt-28 pb-20">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-arc-gold mb-3">
            <Users className="w-3 h-3" />
            <span>{activeCreators.length} creators on Attnn.</span>
          </div>
          <h1 className="text-4xl font-display font-bold mb-3">Discover Creators</h1>
          <p className="text-text-secondary max-w-xl">
            Browse professionals registered on Attnn. View a profile to unlock their full details and place a bid.
          </p>
        </div>

        {/* Grid */}
        {activeCreators.length === 0 ? (
          <div className="text-center py-20 text-text-dim">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No creators registered yet.</p>
            <Link href="/dashboard" className="mt-4 inline-block">
              <Button variant="outline" size="sm">Be the first</Button>
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeCreators.map((creator) => {
              const minBidUsd = formatUsdc(BigInt(creator.minBid || "0"));
              const stats = statsMap[creator.id];
              const highestBid = stats?.highestBid ? formatUsdc(BigInt(stats.highestBid)) : null;
              const pendingCount = stats?.pendingCount ?? 0;
              const dealCount = stats?.dealCount ?? 0;

              return (
                <div key={creator.id} className="bg-arc-bg-1 border border-border rounded-xl p-5 hover:border-arc-gold/40 transition-colors flex flex-col gap-4">
                  
                  {/* Handle + Active dot */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="font-display font-bold text-lg">@{creator.handle}</h2>
                      <p className="text-xs text-text-dim mt-0.5">Creator on Attnn.</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs bg-green/10 text-green px-2 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-green" />
                      Active
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center">
                      <div className="text-sm font-bold text-arc-gold">4.9</div>
                      <div className="text-xs text-text-dim">Rep.</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold">94%</div>
                      <div className="text-xs text-text-dim">Reply</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold">~7h</div>
                      <div className="text-xs text-text-dim">Avg</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold">{dealCount}</div>
                      <div className="text-xs text-text-dim">Deals</div>
                    </div>
                  </div>

                  {/* Attention Market */}
                  <div className="bg-arc-bg-2 rounded-lg p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-text-dim mb-1">Min bid</div>
                        <div className="text-sm font-bold">${minBidUsd} <span className="text-xs text-text-dim font-normal">USDC</span></div>
                      </div>
                      <div>
                        <div className="text-xs text-text-dim mb-1">Top offer</div>
                        <div className="text-sm font-bold text-arc-gold">
                          {highestBid ? `$${highestBid}` : "—"} <span className="text-xs font-normal">USDC</span>
                        </div>
                      </div>
                    </div>
                    {pendingCount > 0 && (
                      <div className="text-xs text-text-dim mt-2">
                        {pendingCount} offer{pendingCount > 1 ? "s" : ""} in queue
                      </div>
                    )}
                  </div>

                  {/* View Profile button */}
                  <Link href={`/c/${creator.handle}`}>
                    <Button variant="outline" size="sm" className="w-full border-arc-gold text-arc-gold hover:bg-arc-gold hover:text-black">
                      View Profile →
                    </Button>
                  </Link>

                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-text-dim text-center mt-12">
          Built on Arc Network™ · Circle USDC · All profiles verified on-chain
        </p>
      </div>
    </div>
  );
}
