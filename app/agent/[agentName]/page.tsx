import { notFound } from "next/navigation";
import Link from "next/link";
import { and, count, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { bidderConfigs, bids, profiles } from "@/lib/db/schema";
import { arc } from "@/lib/chain";
import { Money, Num, Panel, StatStrip, StatusChip, Tag } from "@/components/market";
import { SiteHeader } from "@/components/market/site-header";

export default async function AgentPage({ params }: { params: Promise<{ agentName: string }> }) {
  const { agentName } = await params;
  const decodedName = decodeURIComponent(agentName).replace(/-/g, " ");

  const config = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.agentName, decodedName) });
  if (!config || !config.agentName) notFound();

  const [ownerProfile, placedRow, clearedRow, returnedRow] = await Promise.all([
    db.query.profiles.findFirst({ where: eq(profiles.userId, config.userId), columns: { handle: true } }),
    // Bids that actually reached escrow (or are on their way); failed placements moved no USDC.
    db.select({ n: count() }).from(bids).where(and(eq(bids.bidderUserId, config.userId), ne(bids.status, "failed"))),
    // Replies proven on-chain, same rule as the market pages.
    db
      .select({ n: count() })
      .from(bids)
      .where(and(eq(bids.bidderUserId, config.userId), eq(bids.status, "accepted"), isNotNull(bids.settlementOnChainTxHash))),
    db.select({ n: count() }).from(bids).where(and(eq(bids.bidderUserId, config.userId), inArray(bids.status, ["rejected", "refunded"]))),
  ]);

  const placed = Number(placedRow[0]?.n ?? 0);
  const cleared = Number(clearedRow[0]?.n ?? 0);
  const returned = Number(returnedRow[0]?.n ?? 0);
  const ended = cleared + returned;

  const can = [
    "Discover creators by tag on Arc",
    "Score creators against its goal with AI",
    <>
      Escrow bids up to <Money atomic={config.maxBidPerCreator} className="font-medium" /> per creator
    </>,
    "Place a new bid when a creator counters, if the budget allows",
  ];
  const cannot = [
    "Withdraw or redirect USDC held in escrow",
    <>
      Spend more than <Money atomic={config.dailyBudget} className="font-medium" /> a day
    </>,
    <>Bid on creators it scores below <Num className="font-medium">{config.minFitScore}/10</Num></>,
    "Read anyone's private messages",
  ];

  return (
    <div className="min-h-screen bg-arc-bg-0">
      <SiteHeader networkLabel={arc.chain.name} />
      <main className="mx-auto max-w-[760px] px-4 pb-16 pt-5 sm:px-6">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-[13px] text-text-secondary">
          <Link href="/creators" className="hover:text-text-primary">
            Markets
          </Link>
          <span aria-hidden>/</span>
          <span className="text-text-primary">Agent</span>
        </nav>

        <Panel>
          <div className="flex flex-wrap items-center gap-4">
            <span
              aria-hidden
              className="flex h-14 w-14 flex-none items-center justify-center rounded-xl border border-border-bright bg-arc-bg-3 font-display text-2xl font-extrabold text-arc-gold"
            >
              {config.agentName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl font-bold tracking-tight">{config.agentName}</h1>
                <StatusChip tone={config.isActive ? "success" : "muted"} dot>
                  {config.isActive ? "Running" : "Paused"}
                </StatusChip>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                Bidder agent
                {ownerProfile && (
                  <>
                    {" "}
                    operated by{" "}
                    <Link href={`/c/${ownerProfile.handle}`} className="text-arc-lavender hover:underline">
                      @{ownerProfile.handle}
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>
          {config.goal && (
            <p className="mt-4 rounded-lg border border-border bg-arc-bg-0 px-4 py-3 text-sm">
              <span className="eyebrow mb-1 block">Goal</span>
              {config.goal}
            </p>
          )}
          {config.searchTags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {config.searchTags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          )}
        </Panel>

        <StatStrip
          className="mt-5"
          items={[
            { label: "Bids placed", value: <Num>{placed}</Num>, sub: "Escrowed or confirming" },
            { label: "Replies paid", value: <Num>{cleared}</Num>, tone: "success", sub: "Settled on Arc" },
            {
              label: "Reply rate",
              value: <Num>{ended ? `${Math.round((cleared / ended) * 100)}%` : "—"}</Num>,
              sub: "Paid ÷ (paid + refunded)",
            },
          ]}
        />

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Panel title="This agent can">
            <ul className="flex flex-col gap-2.5 text-sm">
              {can.map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="text-green">✓</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="This agent can't">
            <ul className="flex flex-col gap-2.5 text-sm">
              {cannot.map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="text-arc-coral">✕</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <p className="mt-3 text-xs text-text-secondary">Limits are enforced by Attnn. before every bid; the escrow contract caps any single bid at $1,000.</p>
      </main>
    </div>
  );
}
