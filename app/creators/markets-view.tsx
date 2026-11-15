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
        <Link href={`/c/${r.handle}`} className="focus-ring flex items-center gap-3 rounded-md text-text-primary">
          <CreatorAvatar handle={r.handle} src={r.avatarUrl} size={36} />
          <span>
            <span className="flex items-center gap-2">
              <span className="font-medium">@{r.handle}</span>
              {!r.hasHistory && (
                <span className="rounded border border-arc-lavender/30 bg-arc-lavender/[0.06] px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-arc-lavender">New</span>
              )}
              {r.paused && <span className="rounded border border-arc-coral/40 bg-arc-coral/[0.06] px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-arc-coral">Paused</span>}
            </span>
            <span className={cn("block text-xs", r.openBids > 0 ? "text-arc-gold" : "text-text-secondary")}>
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
            "focus-ring h-8 min-w-[64px] px-3.5 text-[13px]",
            r.paused ? "btn-secondary" : "btn-primary",
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
          "focus-ring h-8 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
          on
            ? "border-text-primary bg-text-primary text-arc-bg-0"
            : "border-border-bright bg-arc-bg-1 text-text-secondary hover:border-text-primary/25 hover:text-text-primary",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <main className="mx-auto max-w-[1320px] px-4 pb-6 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow inline-flex items-center gap-2">
            <span aria-hidden className="live-dot text-green" />
            <Num className="text-text-primary">{rows.filter((r) => !r.paused).length}</Num> markets accepting bids
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">Attention markets</h1>
          <p className="mt-2 max-w-[60ch] text-text-secondary">
            Every creator is a market. Bids are escrowed USDC on Arc: paid out on reply, refunded after 3 days without one.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href="/dashboard" className="focus-ring btn-secondary h-11 w-full px-4 sm:w-auto">
            List yourself as a creator
          </Link>
          <Link href="/dashboard" className="focus-ring btn-primary h-11 w-full px-4 sm:w-auto">
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
          <label className="relative flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border-bright bg-arc-bg-1 px-3 transition-colors focus-within:border-arc-lavender/60 focus-within:ring-2 focus-within:ring-arc-lavender/20 hover:border-text-primary/20 sm:w-64 sm:flex-none">
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
              "focus-ring inline-flex h-10 items-center gap-2.5 rounded-lg border px-3 text-[13px] transition-colors",
              acceptingOnly ? "border-green/40 bg-green/[0.06] text-text-primary" : "border-border-bright bg-arc-bg-1 text-text-secondary hover:text-text-primary",
            )}
          >
            <span aria-hidden className={cn("relative h-4 w-7 rounded-full transition-colors", acceptingOnly ? "bg-green" : "bg-arc-bg-3")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-text-primary transition-[left]", acceptingOnly ? "left-[14px]" : "left-0.5")} />
            </span>
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
              <Link href={`/c/${r.handle}`} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md">
                <CreatorAvatar handle={r.handle} src={r.avatarUrl} size={36} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">@{r.handle}</span>
                    {!r.hasHistory && <span className="rounded border border-arc-lavender/30 px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-arc-lavender">New</span>}
                    {r.paused && <span className="rounded border border-arc-coral/40 px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-arc-coral">Paused</span>}
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
                className={cn("focus-ring h-10 px-3.5 text-sm", r.paused ? "btn-secondary" : "btn-primary")}
              >
                {r.paused ? "View" : "Bid"}
              </Link>
            </div>
          )}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border bg-arc-bg-0/40 px-5 py-3 text-[13px] text-text-secondary">
          <Num>{filtered.length}</Num> of <Num>{rows.length}</Num> markets · prices in USDC
        </div>
      </Panel>

      <p className="mt-3 text-xs text-text-secondary">
        Last cleared, volume and reply rate count only bids settled on-chain. Markets without a settled bid show “—” until their first fill.
      </p>
    </main>
  );
}
