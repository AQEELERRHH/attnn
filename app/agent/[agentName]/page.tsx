import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { bidderConfigs, profiles, bids } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import Link from "next/link";

export default async function AgentPage({ params }: { params: Promise<{ agentName: string }> }) {
  const { agentName } = await params;
  const decodedName = decodeURIComponent(agentName).replace(/-/g, " ");

  // Find agent by name
  const config = await db.query.bidderConfigs.findFirst({
    where: eq(bidderConfigs.agentName, decodedName),
    with: { user: true },
  });

  if (!config || !config.agentName) notFound();

  // Get owner profile
  const ownerProfile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, config.userId),
  });

  // Get track record
  const [totalBidsResult, acceptedBidsResult] = await Promise.all([
    db.select({ count: count() }).from(bids).where(eq(bids.bidderUserId, config.userId)),
    db.select({ count: count() }).from(bids).where(and(eq(bids.bidderUserId, config.userId), eq(bids.status, "accepted"))),
  ]);

  const totalBids = Number(totalBidsResult[0]?.count ?? 0);
  const acceptedBids = Number(acceptedBidsResult[0]?.count ?? 0);
  const acceptanceRate = totalBids > 0 ? Math.round((acceptedBids / totalBids) * 100) : 0;
  const dailyBudgetUsd = (Number(BigInt(config.dailyBudget || "0")) / 1_000_000).toFixed(0);
  const maxBidUsd = (Number(BigInt(config.maxBidPerCreator || "0")) / 1_000_000).toFixed(0);

  return (
    <div className="min-h-screen bg-arc-bg-0">
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Back link */}
        <Link href="/creators" className="text-xs text-text-dim hover:text-text-primary mb-6 inline-block">
          ← Back to creators
        </Link>

        {/* Agent Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-arc-purple to-arc-gold flex items-center justify-center text-3xl mx-auto mb-4">
            🤖
          </div>
          <h1 className="text-2xl font-display font-bold">{config.agentName}</h1>
          {ownerProfile && (
            <p className="text-sm text-text-secondary mt-1">
              Operated by <Link href={`/c/${ownerProfile.handle}`} className="text-arc-gold hover:underline">@{ownerProfile.handle}</Link>
            </p>
          )}
          <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full mt-3 ${config.isActive ? "bg-green/10 text-green" : "bg-border text-text-dim"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${config.isActive ? "bg-green" : "bg-text-dim"}`} />
            {config.isActive ? "Active" : "Paused"}
          </div>
        </div>

        {/* Purpose */}
        {config.goal && (
          <div className="bg-arc-bg-2 rounded-xl p-4 mb-4 text-center">
            <div className="text-xs text-text-dim uppercase tracking-wider mb-2">Purpose</div>
            <p className="text-sm text-text-primary">{config.goal}</p>
          </div>
        )}

        {/* What agent CAN do */}
        <div className="bg-arc-bg-1 border border-border rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-border bg-arc-bg-2">
            <div className="text-xs text-green uppercase tracking-wider font-medium">What this agent can do</div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green">✓</span>
              <span>Discover creators by tag on Arc</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green">✓</span>
              <span>Score profiles with AI (AISA)</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green">✓</span>
              <span>Place bids up to <strong className="text-white">${maxBidUsd} USDC</strong> per creator</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green">✓</span>
              <span>Negotiate counter-offers within budget</span>
            </div>
            {config.searchTags.length > 0 && (
              <div className="flex items-start gap-3 text-sm">
                <span className="text-green mt-0.5">✓</span>
                <span>Search tags: <span className="text-text-secondary">{config.searchTags.join(", ")}</span></span>
              </div>
            )}
          </div>
        </div>

        {/* What agent CANNOT do */}
        <div className="bg-arc-bg-1 border border-border rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-border bg-arc-bg-2">
            <div className="text-xs text-red-400 uppercase tracking-wider font-medium">What this agent cannot do</div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-red-400">✕</span>
              <span>Withdraw funds from escrow</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-red-400">✕</span>
              <span>Exceed <strong className="text-white">${dailyBudgetUsd} USDC</strong> daily budget</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-red-400">✕</span>
              <span>Bid above <strong className="text-white">${maxBidUsd} USDC</strong> on any creator</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-red-400">✕</span>
              <span>Access private messages</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-red-400">✕</span>
              <span>Bid on creators with score below {config.minFitScore}/10</span>
            </div>
          </div>
        </div>

        {/* Track Record */}
        <div className="bg-arc-bg-1 border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-arc-bg-2">
            <div className="text-xs text-text-dim uppercase tracking-wider font-medium">Track Record</div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="p-4 text-center">
              <div className="text-2xl font-bold">{totalBids}</div>
              <div className="text-xs text-text-dim mt-1">Bids placed</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-2xl font-bold text-green">{acceptanceRate}%</div>
              <div className="text-xs text-text-dim mt-1">Accepted</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-2xl font-bold text-arc-gold">{config.minFitScore}</div>
              <div className="text-xs text-text-dim mt-1">Min score</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
