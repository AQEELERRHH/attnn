import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

export const revalidate = 60; // revalidate every 60 seconds

export default async function CreatorsPage() {
  const activeCreators = await db.query.profiles.findMany({
    where: eq(profiles.isActive, true),
    with: { user: true },
  });

  return (
    <div className="min-h-screen bg-arc-bg-0">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-arc-bg-0/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center text-xs font-display font-bold text-arc-bg-0">A</span>
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
            <span>{activeCreators.length} creators registered on Arc</span>
          </div>
          <h1 className="text-4xl font-display font-bold mb-3">
            Discover Creators
          </h1>
          <p className="text-text-secondary max-w-xl">
            Browse creators and professionals registered on Attn. Each profile is live on Arc Network. Bid on anyone to get their attention.
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
              const minBidUsd = (Number(BigInt(creator.minBid || "0")) / 1_000_000).toFixed(2);
              return (
                <Card key={creator.id} className="p-5 flex flex-col gap-3 hover:border-arc-gold/40 transition-colors">
                  <div className="flex items-start justify-between">
                    <h2 className="font-display font-bold text-lg">@{creator.handle}</h2>
                    <span className="text-xs font-mono text-arc-gold bg-arc-gold/10 px-2 py-1 rounded-full shrink-0 ml-2">
                      ${minBidUsd} min
                    </span>
                  </div>
                  <div className="flex gap-2 mt-auto pt-2">
                    <Link href={`/c/${creator.handle}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">View Profile</Button>
                    </Link>
                    <Link href={`/dashboard`} className="flex-1">
                      <Button size="sm" className="w-full">Bid</Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-text-dim text-center mt-12">
          Built on Arc Network™ · Circle USDC · All profiles verified on-chain
        </p>
      </div>
    </div>
  );
}
