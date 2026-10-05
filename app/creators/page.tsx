import { db } from "@/lib/db/client";
import { profiles, bids } from "@/lib/db/schema";
import { eq, and, count, max } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Compass, ArrowRight, CheckCircle, Coins, BarChart2 } from "lucide-react";
import { formatUsdc } from "@/lib/arc";

export const revalidate = 60;

export default async function CreatorsPage() {
  const activeCreators = await db.query.profiles.findMany({
    where: eq(profiles.isActive, true),
    with: { user: true },
  });

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
      <nav className="fixed top-0 w-full z-50 h-14 border-b border-border bg-arc-bg-0/80 backdrop-blur-xl flex items-center px-6">
        <Link href="/" className="flex items-center gap-2 mr-8">
          <img src="/attnn-logo.jpeg" alt="Attnn." className="w-7 h-7 rounded-lg object-cover" />
          <span className="font-display font-bold text-base">attnn.</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/about">
            <Button variant="ghost" size="sm">About</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="default" size="sm">Dashboard</Button>
          </Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-5 pt-24 pb-20">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-arc-purple mb-3 font-medium">
            <Compass className="w-3.5 h-3.5" />
            <span>{activeCreators.length} attention endpoint{activeCreators.length !== 1 ? "s" : ""} on Attnn.</span>
          </div>
          <h1 className="text-4xl font-display font-bold mb-3">Discover Creators</h1>
          <p className="text-text-secondary max-w-xl">
            Browse professionals registered as attention endpoints. View a profile to unlock details and place a bid.
          </p>
        </div>

        {/* Grid */}
        {activeCreators.length === 0 ? (
          <div className="text-center py-20 text-text-dim">
            <Compass className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">No creators registered yet.</p>
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

              const availDot =
                creator.availabilityStatus === "limited" ? "bg-arc-gold" :
                creator.availabilityStatus === "not_accepting" ? "bg-arc-coral" :
                "bg-green";
              const availLabel =
                creator.availabilityStatus === "limited" ? "Limited" :
                creator.availabilityStatus === "not_accepting" ? "Closed" :
                "Available";

              return (
                <div
                  key={creator.id}
                  className="group rounded-xl border border-border bg-arc-bg-1 hover:border-arc-gold/40 transition-all duration-200 flex flex-col overflow-hidden"
                >
                  {/* Card header */}
                  <div className="p-5 flex-1 flex flex-col gap-4">
                    {/* Handle + status */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="font-display font-bold text-lg leading-tight">@{creator.handle}</h2>
                        <p className="text-xs text-text-dim mt-0.5">Attention endpoint</p>
                      </div>
                      <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border shrink-0 ${availDot === "bg-green" ? "bg-green/10 text-green border-green/20" : availDot === "bg-arc-gold" ? "bg-arc-gold/10 text-arc-gold border-arc-gold/20" : "bg-arc-coral/10 text-arc-coral border-arc-coral/20"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${availDot}`} />
                        {availLabel}
                      </div>
                    </div>

                    {/* Tags */}
                    {creator.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {creator.tags.slice(0, 4).map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                        {creator.tags.length > 4 && (
                          <Badge variant="secondary" className="text-xs">+{creator.tags.length - 4}</Badge>
                        )}
                      </div>
                    )}

                    {/* Marketplace stats */}
                    <div className="rounded-lg bg-arc-bg-2/60 border border-border p-3">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-xs text-text-dim mb-0.5">Min bid</div>
                          <div className="text-sm font-display font-bold tabular-nums text-arc-gold">${minBidUsd}</div>
                        </div>
                        <div>
                          <div className="text-xs text-text-dim mb-0.5">Top offer</div>
                          <div className={`text-sm font-display font-bold tabular-nums ${highestBid ? "text-arc-gold" : "text-text-dim"}`}>
                            {highestBid ? `$${highestBid}` : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-text-dim mb-0.5">Deals</div>
                          <div className="text-sm font-display font-bold tabular-nums text-green">{dealCount}</div>
                        </div>
                      </div>
                      {pendingCount > 0 && (
                        <div className="mt-2 pt-2 border-t border-border text-xs text-text-dim text-center">
                          {pendingCount} offer{pendingCount > 1 ? "s" : ""} in queue
                        </div>
                      )}
                    </div>

                    {/* Bio snippet */}
                    {creator.bio && (
                      <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">{creator.bio}</p>
                    )}
                  </div>

                  {/* Card footer */}
                  <div className="px-5 pb-5">
                    <Link href={`/c/${creator.handle}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-arc-gold/40 text-arc-gold hover:bg-arc-gold hover:text-arc-bg-0 group-hover:border-arc-gold transition-colors"
                      >
                        View Profile
                        <ArrowRight className="w-3.5 h-3.5 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-12 flex items-center justify-center gap-4 text-xs text-text-dim">
          <CheckCircle className="w-3.5 h-3.5 text-green" />
          <span>All profiles verified on Arc Network · USDC escrow · Circle Gateway</span>
          <Coins className="w-3.5 h-3.5 text-arc-gold" />
          <BarChart2 className="w-3.5 h-3.5 text-arc-purple" />
        </div>
      </div>
    </div>
  );
}
