import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CreatorAvatar, LiveFills, Money, Num, Panel, PlatformStats, Sparkline } from "@/components/market";
import { SiteHeader } from "@/components/market/site-header";
import { arc } from "@/lib/chain";
import { loadMarkets } from "./creators/load";
import type { MarketRow } from "./creators/markets-view";

// Live market numbers, rebuilt at most once a minute (same cadence as /creators).
export const revalidate = 60;

const primary =
  "focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-arc-gold px-6 font-display font-bold text-arc-bg-0 hover:brightness-110";
const secondary =
  "focus-ring inline-flex h-12 items-center justify-center rounded-lg border border-border-bright px-6 font-medium text-text-primary hover:bg-arc-bg-2";

/** Busiest markets first: 7d volume, then open bids, then top bid. */
function topMarkets(rows: MarketRow[], n: number): MarketRow[] {
  const big = (s: string | null) => (s ? BigInt(s) : BigInt(0));
  const cmp = (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0);
  return rows
    .filter((r) => !r.paused)
    .sort(
      (a, b) =>
        cmp(BigInt(a.volume7dUsdc), BigInt(b.volume7dUsdc)) || b.openBids - a.openBids || cmp(big(a.topBidUsdc), big(b.topBidUsdc)),
    )
    .slice(0, n);
}

const STEPS = [
  { n: "01", title: "Bid", body: "A bidder or their agent picks a creator and escrows USDC on Arc. Nothing is paid yet.", tone: "text-arc-gold" },
  { n: "02", title: "Triage", body: "The creator's agent scores the bid: accept, counter, surface to the inbox, or decline.", tone: "text-arc-lavender" },
  { n: "03", title: "Reply → paid", body: "When the creator replies, the escrow releases the USDC to them on-chain.", tone: "text-green" },
  { n: "04", title: "No reply → refund", body: "No reply within 3 days and the full bid goes back to the bidder.", tone: "text-arc-coral" },
];

export default async function HomePage() {
  const now = Date.now();
  const { rows, ticker, totals } = await loadMarkets(now);
  const top = topMarkets(rows, 5);

  return (
    <div className="min-h-screen bg-arc-bg-0">
      <SiteHeader networkLabel={arc.chain.name} />

      <main className="mx-auto max-w-[1320px] px-4 pb-16 sm:px-6">
        {/* Hero */}
        <section className="flex flex-wrap items-center gap-10 py-12 sm:py-16">
          <div className="min-w-0 flex-[1_1_480px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-border-bright px-3 py-1 text-xs text-arc-lavender">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
              Live on {arc.chain.name} · USDC escrow
            </span>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              Attention is <span className="text-arc-gold">scarce</span>.
              <br />
              Let agents negotiate it.
            </h1>
            <p className="mt-5 max-w-[56ch] text-lg text-text-secondary">
              Every creator is a market. Bidders and their AI agents escrow USDC to reach them. Creators get paid only when they reply,
              and bidders get a full refund if they don&apos;t within 3 days.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/creators" className={`${primary} w-full sm:w-auto`}>
                Browse markets <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
              <Link href="/dashboard" className={`${secondary} w-full sm:w-auto`}>
                Deploy a bidder agent
              </Link>
            </div>
            <p className="mt-4 text-sm text-text-secondary">
              Your time is worth something?{" "}
              <Link href="/dashboard" className="text-arc-lavender hover:underline">
                Open your creator market
              </Link>
              .
            </p>
          </div>

          <Panel
            raised
            padded={false}
            className="min-w-0 flex-[1_1_380px]"
            title="Top markets"
            description="Busiest creators by 7-day cleared volume."
            actions={
              <Link href="/creators" className="focus-ring rounded text-[13px] text-arc-lavender hover:underline">
                All markets →
              </Link>
            }
          >
            {top.length === 0 ? (
              <div className="border-t border-border px-5 py-10 text-center text-sm text-text-secondary">
                No markets yet.{" "}
                <Link href="/dashboard" className="text-arc-lavender hover:underline">
                  Be the first creator
                </Link>
                .
              </div>
            ) : (
              <ol className="border-t border-border">
                {top.map((r) => (
                  <li key={r.handle} className="border-b border-border last:border-b-0">
                    <Link href={`/c/${r.handle}`} className="focus-ring flex items-center gap-3 px-5 py-3 hover:bg-arc-bg-2">
                      <CreatorAvatar handle={r.handle} src={r.avatarUrl} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">@{r.handle}</span>
                        <span className="block text-xs text-text-secondary">
                          Floor <Money atomic={r.floorUsdc} className="text-text-secondary" />
                          {r.openBids > 0 && (
                            <>
                              {" "}
                              · <Num>{r.openBids}</Num> open
                            </>
                          )}
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <Sparkline values={r.trend7d} width={64} label={`7 day cleared prices for @${r.handle}`} />
                      </span>
                      <span className="w-24 text-right leading-tight">
                        <Money atomic={r.topBidUsdc ?? r.lastClearedUsdc} tone={r.topBidUsdc ? "gold" : "default"} className="block font-medium" />
                        <span className="block text-[11px] text-text-secondary">{r.topBidUsdc ? "top bid" : r.lastClearedUsdc ? "last cleared" : "no bids yet"}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </section>

        {/* Live numbers */}
        <section aria-label="Platform numbers">
          <PlatformStats totals={totals} />
          <LiveFills ticker={ticker} now={now} className="mt-3" />
          <p className="mt-3 text-xs text-text-secondary">Numbers count only bids settled on-chain. Nothing here is estimated.</p>
        </section>

        {/* How a bid settles */}
        <section aria-labelledby="how" className="mt-16">
          <h2 id="how" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            How a bid settles
          </h2>
          <ol className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-px overflow-hidden rounded-xl border border-border bg-border">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-arc-bg-1 p-5">
                <span className={`num text-sm ${s.tone}`}>{s.n}</span>
                <h3 className="mt-2 font-display text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-text-secondary">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-text-secondary">
            Bids are held by the AttnnEscrow contract on Arc, which only pays the creator on a reply or returns the money to the bidder.
          </p>
        </section>

        {/* Two sides */}
        <section className="mt-16 grid gap-5 md:grid-cols-2">
          <Panel raised title="For bidders">
            <ul className="flex flex-col gap-2.5 text-sm text-text-secondary">
              <li>Set a goal, search tags, a daily budget and a max bid per creator.</li>
              <li>Your agent finds creators, scores the fit and escrows bids within those limits, every 30 minutes.</li>
              <li>Track every open position, its rank in the book and its refund countdown in your portfolio.</li>
            </ul>
            <Link href="/dashboard" className={`${primary} mt-5 h-11 w-full sm:w-auto`}>
              Deploy a bidder agent
            </Link>
          </Panel>
          <Panel raised title="For creators">
            <ul className="flex flex-col gap-2.5 text-sm text-text-secondary">
              <li>Set a floor price. Bids below it never reach you.</li>
              <li>Your inbox is ranked by amount, with your agent&apos;s score on every bid.</li>
              <li>Reply to collect, counter for more, or let it expire. Pause your market any time.</li>
            </ul>
            <Link href="/dashboard" className={`${secondary} mt-5 h-11 w-full sm:w-auto`}>
              Open your creator market
            </Link>
          </Panel>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-start justify-between gap-4 px-4 py-8 text-xs text-text-secondary sm:px-6">
          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            <Link href="/creators" className="hover:text-text-primary">
              Markets
            </Link>
            <Link href="/about" className="hover:text-text-primary">
              How it works
            </Link>
            <Link href="/dashboard" className="hover:text-text-primary">
              Portfolio
            </Link>
          </nav>
          <div className="sm:text-right">
            <span>Built on Arc Network™ · Circle USDC · x402</span>
            <span className="mt-1 block text-[11px]">Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
