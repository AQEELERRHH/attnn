import type * as React from "react";
import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, Clock3, Inbox, Lock } from "lucide-react";
import { BidLifecycle } from "@/components/market/bid-lifecycle";
import { CreatorAvatar, LiveFills, Money, Num, PlatformStats, Sparkline } from "@/components/market";
import { SiteHeader } from "@/components/market/site-header";
import { SiteFooter } from "@/components/market/site-footer";
import { arc } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { loadMarkets } from "./creators/load";
import type { MarketRow } from "./creators/markets-view";

// Live market numbers, rebuilt at most once a minute (same cadence as /creators).
export const revalidate = 60;

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

/** The life of a bid. Colours follow the market roles: orange = money in play, green = paid, coral = refund. */
const STEPS = [
  { n: "01", title: "Bid", body: "A bidder or their agent picks a creator and escrows USDC on Arc. Nothing is paid yet.", tone: "gold" },
  { n: "02", title: "Triage", body: "The creator's agent scores the bid: accept, counter, surface to the inbox, or decline.", tone: "info" },
  { n: "03", title: "Reply, get paid", body: "When the creator replies, the escrow releases the USDC to them on-chain.", tone: "up" },
  { n: "04", title: "No reply, full refund", body: "No reply within 3 days and the full bid goes back to the bidder.", tone: "down" },
] as const;

const STEP_TONE = { gold: "text-arc-gold", info: "text-arc-lavender", up: "text-green", down: "text-arc-coral" };

/** Delay for a hero part's one-time entrance (.enter in globals.css). */
const enter = (ms: number) => ({ ["--enter" as string]: `${ms}ms` }) as React.CSSProperties;

const STACK = ["USDC escrow", "Circle Wallets", "Gateway · x402", "Arc Onramp Kit", "Contract webhooks"];

export default async function HomePage() {
  const now = Date.now();
  const { rows, ticker, totals } = await loadMarkets(now);
  const top = topMarkets(rows, 5);

  return (
    <div className="min-h-screen overflow-x-clip bg-arc-bg-0">
      <SiteHeader networkLabel={arc.chain.name} />

      <main>
        {/* Hero */}
        <section className="relative isolate">
          <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 -z-10" />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-240px] -z-10 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-arc-gold/[0.07] blur-[120px]"
          />
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-14 gap-y-12 px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
            <div className="min-w-0 flex-[1_1_520px]">
              <Link
                href="/creators"
                className="enter focus-ring group inline-flex items-center gap-2 rounded-full border border-border-bright bg-arc-bg-1/80 py-1 pl-2.5 pr-3 text-xs text-text-secondary transition-colors hover:text-text-primary"
              >
                <span aria-hidden className="live-dot text-green" />
                Live on {arc.chain.name}
                <span aria-hidden className="h-3 w-px bg-border-bright" />
                <span className="text-text-primary">USDC escrow</span>
                <ArrowRight aria-hidden className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
              {/* The hero enters once on load, line by line (.enter in globals.css; off under reduced motion). */}
              <h1 className="mt-6 text-balance text-[44px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[clamp(52px,4.5vw,66px)]">
                <span className="enter block" style={enter(60)}>
                  Attention is scarce.
                </span>
                <span className="enter block text-text-secondary" style={enter(140)}>
                  Let agents negotiate it.
                </span>
              </h1>
              <p className="enter mt-6 max-w-[54ch] text-[17px] leading-relaxed text-text-secondary" style={enter(220)}>
                Every creator is a market. Bidders and their AI agents escrow USDC to reach them. Creators get paid only when they reply,
                and bidders get a full refund if they don&apos;t within 3 days.
              </p>
              <div className="enter mt-8 flex flex-wrap gap-3" style={enter(300)}>
                <Link href="/creators" className="focus-ring btn-primary h-12 w-full px-6 text-[15px] sm:w-auto">
                  Browse markets <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
                <Link href="/dashboard" className="focus-ring btn-secondary h-12 w-full px-6 text-[15px] sm:w-auto">
                  <Bot aria-hidden className="h-4 w-4 text-text-secondary" />
                  Deploy a bidder agent
                </Link>
              </div>
              <ul className="enter mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-text-secondary" style={enter(380)}>
                <li className="inline-flex items-center gap-2">
                  <CheckCircle2 aria-hidden className="h-4 w-4 text-green" /> Creators keep 100%
                </li>
                <li className="inline-flex items-center gap-2">
                  <Lock aria-hidden className="h-4 w-4 text-arc-gold" /> Paid only on reply
                </li>
                <li className="inline-flex items-center gap-2">
                  <Clock3 aria-hidden className="h-4 w-4 text-arc-coral" /> Refund after 3 days
                </li>
              </ul>
              <p className="enter mt-6 text-sm text-text-secondary" style={enter(440)}>
                Your time is worth something?{" "}
                <Link href="/dashboard" className="focus-ring rounded font-medium text-text-primary underline decoration-border-bright underline-offset-4 hover:decoration-arc-gold">
                  Open your creator market
                </Link>
              </p>
            </div>

            {/* Top markets board */}
            <section aria-labelledby="top-markets" className="enter panel-raised min-w-0 flex-[1_1_400px] overflow-hidden" style={enter(260)}>
              <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <h2 id="top-markets" className="text-[15px] font-semibold tracking-[-0.015em]">
                    Top markets
                  </h2>
                  <span className="num inline-flex items-center gap-1.5 rounded-full bg-green/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-green">
                    <span aria-hidden className="live-dot" />
                    Live
                  </span>
                </div>
                <Link href="/creators" className="focus-ring rounded text-[13px] text-text-secondary transition-colors hover:text-text-primary">
                  All markets →
                </Link>
              </header>
              {top.length === 0 ? (
                <div className="px-5 py-14 text-center text-sm text-text-secondary">
                  No markets yet.{" "}
                  <Link href="/dashboard" className="text-arc-lavender hover:underline">
                    Be the first creator
                  </Link>
                  .
                </div>
              ) : (
                <>
                  <div className="eyebrow grid grid-cols-[1fr_auto] gap-3 px-5 pb-1 pt-3 sm:grid-cols-[1fr_72px_96px]">
                    <span>Creator · 7d volume</span>
                    <span className="hidden sm:block">Trend</span>
                    <span className="text-right">Price</span>
                  </div>
                  <ol>
                    {top.map((r, i) => (
                      <li key={r.handle}>
                        <Link
                          href={`/c/${r.handle}`}
                          className="signal-row focus-ring group grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-arc-bg-2 sm:grid-cols-[1fr_72px_96px]"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <Num className="w-4 text-xs text-text-dim">{i + 1}</Num>
                            <CreatorAvatar handle={r.handle} src={r.avatarUrl} size={34} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">@{r.handle}</span>
                              <span className="block text-xs text-text-secondary">
                                {r.hasHistory ? (
                                  <>
                                    <Money atomic={r.volume7dUsdc} className="text-text-secondary" /> vol
                                  </>
                                ) : (
                                  "New market"
                                )}
                                {r.openBids > 0 && (
                                  <>
                                    {" "}
                                    · <Num className="text-arc-gold">{r.openBids}</Num> open
                                  </>
                                )}
                              </span>
                            </span>
                          </span>
                          <span className="hidden sm:block">
                            <Sparkline values={r.trend7d} width={72} label={`7 day cleared prices for @${r.handle}`} />
                          </span>
                          <span className="text-right leading-tight">
                            <Money atomic={r.topBidUsdc ?? r.lastClearedUsdc} tone={r.topBidUsdc ? "gold" : "default"} className="block text-[15px] font-medium" />
                            <span className="block text-[11px] text-text-secondary">
                              {r.topBidUsdc ? "top bid" : r.lastClearedUsdc ? "last cleared" : "no bids yet"}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-border bg-arc-bg-0/40 px-5 py-3 text-xs text-text-secondary">
                <span>Ranked by 7-day cleared volume</span>
                <span className="num">USDC</span>
              </div>
            </section>
          </div>
        </section>

        <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
          {/* Live numbers */}
          <section aria-label="Platform numbers">
            <PlatformStats totals={totals} enter />
            <LiveFills ticker={ticker} now={now} className="mt-3" />
            <p className="mt-3 text-xs text-text-secondary">Numbers count only bids settled on-chain. Nothing here is estimated.</p>
          </section>

          {/* How a bid settles */}
          <section aria-labelledby="how" className="mt-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow text-arc-gold">The escrow</p>
                <h2 id="how" className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                  How a bid settles
                </h2>
              </div>
              <p className="max-w-[46ch] text-sm text-text-secondary">
                Bids are held by the AttnnEscrow contract on Arc, which only pays the creator on a reply or returns the money to the bidder.
              </p>
            </div>
            <figure className="mt-10">
              {/* The demo acts out the four rules below; screen readers get the list instead. */}
              <div aria-hidden>
                <BidLifecycle />
              </div>
              <figcaption className="mt-10 border-t border-border pt-6">
                <ol className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                  {STEPS.map((s) => (
                    <li key={s.n} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
                      <span className={cn("num pt-px text-xs", STEP_TONE[s.tone])}>{s.n}</span>
                      <span>
                        <span className="font-medium text-text-primary">{s.title}.</span> {s.body}
                      </span>
                    </li>
                  ))}
                </ol>
              </figcaption>
            </figure>
          </section>

          {/* Two sides */}
          <section className="mt-24 grid gap-4 md:grid-cols-2">
            <SideCard
              eyebrow="For bidders"
              title="Put an agent on your outreach."
              icon={<Bot aria-hidden className="h-5 w-5 text-arc-gold" />}
              points={[
                "Set a goal, search tags, a daily budget and a max bid per creator.",
                "Your agent finds creators, scores the fit and escrows bids within those limits, every 30 minutes.",
                "Track every open position, its rank in the book and its refund countdown in your portfolio.",
              ]}
              cta={
                <Link href="/dashboard" className="focus-ring btn-primary h-11 w-full sm:w-auto">
                  Deploy a bidder agent
                </Link>
              }
            />
            <SideCard
              eyebrow="For creators"
              title="Get paid to reply."
              icon={<Inbox aria-hidden className="h-5 w-5 text-green" />}
              points={[
                "Set a floor price. Bids below it never reach you.",
                "Your inbox is ranked by amount, with your agent's score on every bid.",
                "Reply to collect, counter for more, or let it expire. Pause your market any time.",
              ]}
              cta={
                <Link href="/dashboard" className="focus-ring btn-secondary h-11 w-full sm:w-auto">
                  Open your creator market
                </Link>
              }
            />
          </section>

          {/* Built on */}
          <section aria-label="Built on" className="mt-24 flex flex-wrap items-center justify-between gap-6 rounded-xl border border-border bg-arc-bg-1 px-6 py-5">
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">Settles on Arc.</span> USDC is the gas token, so every fee and bid is in dollars.
            </p>
            <ul className="flex flex-wrap gap-2">
              {[arc.chain.name, ...STACK].map((s) => (
                <li key={s} className="num rounded-md border border-border bg-arc-bg-0 px-2.5 py-1 text-xs text-text-secondary">
                  {s}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function SideCard({
  eyebrow,
  title,
  icon,
  points,
  cta,
}: {
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  points: string[];
  cta: React.ReactNode;
}) {
  return (
    <section className="panel flex flex-col p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border-bright bg-arc-bg-2">{icon}</span>
        <p className="eyebrow">{eyebrow}</p>
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">{title}</h2>
      <ul className="mt-4 flex flex-1 flex-col gap-3 text-sm text-text-secondary">
        {points.map((p) => (
          <li key={p} className="flex gap-3">
            <span aria-hidden className="mt-[7px] h-1 w-1 flex-none rounded-full bg-text-secondary" />
            <span className="leading-relaxed">{p}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6">{cta}</div>
    </section>
  );
}
