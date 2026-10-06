"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  Change,
  CreatorAvatar,
  MarketTable,
  Money,
  Num,
  Panel,
  Sparkline,
  Tag,
  type MarketColumn,
} from "@/components/market";
import { LiveFills, PlatformStats, type FillTick, type PlatformStatsData } from "@/components/market/platform";
import { cn } from "@/lib/cn";
import { formatChange, formatDuration } from "@/lib/format";

export interface MarketRow {
  handle: string;
  avatarUrl: string | null;
  tags: string[];
  paused: boolean;
  floorUsdc: string;
  topBidUsdc: string | null;
  lastClearedUsdc: string | null;
  prevClearedUsdc: string | null;
  volume7dUsdc: string;
  replyRate: number | null;
  medianReplyMs: number | null;
  openBids: number;
  trend7d: number[];
  hasHistory: boolean;
}

export type TickerFill = FillTick;
export type MarketTotals = PlatformStatsData;

const big = (s: string | null) => (s === null ? null : BigInt(s));
const num = (s: string | null) => (s === null ? null : Number(s));

export function MarketsView({
  rows,
  ticker,
  totals,
  now,
}: {
  rows: MarketRow[];
  ticker: TickerFill[];
  totals: MarketTotals;
  /** Server render time, so relative times match between server and browser. */
  now: number;
}) {
  const [tag, setTag] = React.useState<string>("All");
  const [query, setQuery] = React.useState("");
  const [acceptingOnly, setAcceptingOnly] = React.useState(false);

  // Category chips: the most used tags across markets.
  const topTags = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([t]) => t);
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (tag !== "All" && !r.tags.includes(tag)) return false;
    if (acceptingOnly && r.paused) return false;
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (q && !r.handle.toLowerCase().includes(q) && !r.tags.some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });

  const columns: MarketColumn<MarketRow>[] = [
    {
      key: "creator",
      label: "Creator",
      render: (r) => (
        <Link href={`/c/${r.handle}`} className="focus-ring flex items-center gap-2.5 rounded-md text-text-primary">
          <CreatorAvatar handle={r.handle} src={r.avatarUrl} />
          <span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">@{r.handle}</span>
              {!r.hasHistory && (
                <span className="rounded border border-arc-lavender/30 px-1.5 text-[11px] text-arc-lavender">New market</span>
              )}
              {r.paused && <span className="rounded border border-arc-coral/40 px-1.5 text-[11px] text-arc-coral">Paused</span>}
            </span>
            <span className="block text-xs text-text-secondary">
              {r.openBids > 0 ? `${r.openBids} open bid${r.openBids > 1 ? "s" : ""}` : "No open bids"}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "tags",
      label: "Tags",
      render: (r) => (
        <span className="flex gap-1">
          {r.tags.slice(0, 2).map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
          {r.tags.length > 2 && <span className="text-xs text-text-secondary">+{r.tags.length - 2}</span>}
        </span>
      ),
    },
    { key: "floor", label: "Floor", align: "right", sortValue: (r) => num(r.floorUsdc), render: (r) => <Money atomic={r.floorUsdc} /> },
    { key: "top", label: "Top bid", align: "right", sortValue: (r) => num(r.topBidUsdc), render: (r) => <Money atomic={r.topBidUsdc} tone="gold" /> },
    {
      key: "last",
      label: "Last cleared",
      align: "right",
      sortValue: (r) => num(r.lastClearedUsdc),
      render: (r) => (
        <>
          <Money atomic={r.lastClearedUsdc} />{" "}
          {r.prevClearedUsdc && <Change value={formatChange(big(r.lastClearedUsdc), big(r.prevClearedUsdc))} />}
        </>
      ),
    },
    {
      key: "vol",
      label: "7d volume",
      align: "right",
      sortValue: (r) => (r.hasHistory ? Number(r.volume7dUsdc) : null),
      render: (r) => <Money atomic={r.hasHistory ? r.volume7dUsdc : null} />,
    },
    {
      key: "reply",
      label: "Reply rate",
      align: "right",
      sortValue: (r) => r.replyRate,
      render: (r) => (
        <span className="block leading-tight">
          <Num>{r.replyRate === null ? "—" : `${Math.round(r.replyRate * 100)}%`}</Num>
          {r.medianReplyMs !== null && (
            <span className="block text-xs text-text-secondary">
              <Num>{formatDuration(r.medianReplyMs)}</Num> median
            </span>
          )}
        </span>
      ),
    },
    {
      key: "trend",
      label: "7d trend",
      render: (r) => <Sparkline values={r.trend7d} width={76} label={`7 day cleared prices for @${r.handle}`} />,
    },
    {
      key: "action",
      label: "Action",
      hiddenLabel: true,
      align: "right",
      render: (r) => (
        <Link
          href={`/c/${r.handle}`}
          className={cn(
            "focus-ring inline-flex h-9 items-center rounded-lg px-4 text-sm",
            r.paused
              ? "border border-border-bright font-medium text-text-primary hover:bg-arc-bg-3"
              : "bg-arc-gold font-display font-bold text-arc-bg-0 hover:brightness-110",
          )}
        >
          {r.paused ? "View" : "Bid"}
        </Link>
      ),
    },
  ];

  const chip = (label: string) => {
    const on = tag === label;
    return (
      <button
        key={label}
        type="button"
        aria-pressed={on}
        onClick={() => setTag(label)}
        className={cn(
          "focus-ring h-9 rounded-full border px-3.5 text-[13px]",
          on ? "border-arc-gold bg-arc-bg-3 text-text-primary" : "border-border-bright text-text-secondary hover:text-text-primary",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-7 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Attention markets</h1>
          <p className="mt-1 max-w-[60ch] text-text-secondary">
            Every creator is a market. Bids are escrowed USDC on Arc: paid out on reply, refunded after 3 days without one.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href="/dashboard" className="focus-ring inline-flex h-11 w-full items-center justify-center rounded-lg border border-border-bright px-4 font-medium hover:bg-arc-bg-2 sm:w-auto">
            List yourself as a creator
          </Link>
          <Link
            href="/dashboard"
            className="focus-ring inline-flex h-11 w-full items-center justify-center rounded-lg bg-arc-gold px-4 font-display font-bold text-arc-bg-0 hover:brightness-110 sm:w-auto"
          >
            Deploy a bidder agent
          </Link>
        </div>
      </div>

      <PlatformStats totals={totals} className="mt-6" />
      <LiveFills ticker={ticker} now={now} className="mt-3" />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-1.5">
          {["All", ...topTags].map(chip)}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:ml-auto sm:w-auto">
          <label className="relative flex h-10 min-w-[220px] flex-1 sm:flex-none items-center gap-2 rounded-lg border border-border-bright bg-arc-bg-1 px-3 focus-within:ring-2 focus-within:ring-arc-lavender">
            <Search aria-hidden className="h-4 w-4 text-text-secondary" />
            <span className="sr-only">Search creators</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search handle or tag"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-dim"
            />
          </label>
          <button
            type="button"
            aria-pressed={acceptingOnly}
            onClick={() => setAcceptingOnly((v) => !v)}
            className={cn(
              "focus-ring inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-[13px]",
              acceptingOnly ? "border-green bg-arc-bg-3" : "border-border-bright",
            )}
          >
            <span aria-hidden className={cn("h-2 w-2 rounded-full", acceptingOnly ? "bg-green" : "bg-text-dim")} />
            Accepting bids only
          </button>
        </div>
      </div>

      <Panel padded={false} className="mt-4">
        <MarketTable
          caption="Creator markets"
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.handle}
          defaultSort={{ key: "vol", dir: "desc" }}
          minWidth={960}
          empty={rows.length === 0 ? "No creators have opened a market yet." : "No markets match these filters."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <Link href={`/c/${r.handle}`} className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-md">
                <CreatorAvatar handle={r.handle} src={r.avatarUrl} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-semibold">@{r.handle}</span>
                    {!r.hasHistory && <span className="rounded border border-arc-lavender/30 px-1.5 text-[11px] text-arc-lavender">New</span>}
                    {r.paused && <span className="rounded border border-arc-coral/40 px-1.5 text-[11px] text-arc-coral">Paused</span>}
                  </span>
                  <span className="block text-xs text-text-secondary">
                    Floor <Money atomic={r.floorUsdc} className="text-text-secondary" />
                    {r.replyRate !== null && (
                      <>
                        {" "}
                        · <Num>{Math.round(r.replyRate * 100)}%</Num> reply
                      </>
                    )}
                  </span>
                </span>
              </Link>
              <span className="text-right leading-tight">
                <Money atomic={r.topBidUsdc ?? r.lastClearedUsdc} tone={r.topBidUsdc ? "gold" : "default"} className="block font-medium" />
                <span className="block text-[11px] text-text-secondary">{r.topBidUsdc ? "top bid" : r.lastClearedUsdc ? "last cleared" : "no bids"}</span>
              </span>
              <Link
                href={`/c/${r.handle}`}
                className={cn(
                  "focus-ring inline-flex h-11 items-center rounded-lg px-3.5 text-sm",
                  r.paused ? "border border-border-bright font-medium" : "bg-arc-gold font-display font-bold text-arc-bg-0",
                )}
              >
                {r.paused ? "View" : "Bid"}
              </Link>
            </div>
          )}
        />
        <div className="border-t border-border px-5 py-3 text-[13px] text-text-secondary">
          <Num>{filtered.length}</Num> of <Num>{rows.length}</Num> markets · prices in USDC
        </div>
      </Panel>

      <p className="mt-3 text-xs text-text-secondary">
        Last cleared, volume and reply rate count only bids settled on-chain. Markets without a settled bid show “—” until their first fill.
      </p>
    </main>
  );
}
