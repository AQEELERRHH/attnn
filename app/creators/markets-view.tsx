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
  StatStrip,
  Tag,
  type MarketColumn,
} from "@/components/market";
import { cn } from "@/lib/cn";
import { formatChange, formatDuration, timeAgo } from "@/lib/format";

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

export interface TickerFill {
  handle: string;
  amountUsdc: string;
  settledAt: string;
}

export interface MarketTotals {
  escrowUsdc: string;
  escrowSource: string;
  settled24hUsdc: string;
  settledPrev24hUsdc: string;
  cleared24h: number;
  refunded24h: number;
  activeAgents: number;
  medianReply7dMs: number | null;
}

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
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className="focus-ring inline-flex h-11 items-center rounded-lg border border-border-bright px-4 font-medium hover:bg-arc-bg-2">
            List yourself as a creator
          </Link>
          <Link
            href="/dashboard"
            className="focus-ring inline-flex h-11 items-center rounded-lg bg-arc-gold px-4 font-display font-bold text-arc-bg-0 hover:brightness-110"
          >
            Deploy a bidder agent
          </Link>
        </div>
      </div>

      <StatStrip
        className="mt-6"
        items={[
          { label: "In escrow now", value: <Money atomic={totals.escrowUsdc} tone="gold" />, sub: totals.escrowSource },
          {
            label: "24h settled",
            value: <Money atomic={totals.settled24hUsdc} />,
            sub:
              BigInt(totals.settledPrev24hUsdc) > BigInt(0) ? (
                <>
                  <Change value={formatChange(BigInt(totals.settled24hUsdc), BigInt(totals.settledPrev24hUsdc))} /> vs prior 24h
                </>
              ) : (
                "Nothing settled the 24h before"
              ),
          },
          { label: "Bids cleared · 24h", value: <Num>{totals.cleared24h}</Num>, sub: `${totals.refunded24h} refunded` },
          { label: "Active bidder agents", value: <Num>{totals.activeAgents}</Num>, sub: "Running on a schedule" },
          { label: "Median reply", value: <Num>{formatDuration(totals.medianReply7dMs)}</Num>, sub: "Across cleared bids, 7d" },
        ]}
      />

      {ticker.length > 0 && (
        <div
          aria-label="Latest fills"
          className="mt-3 flex items-center gap-4 overflow-x-auto whitespace-nowrap rounded-[10px] border border-border bg-arc-bg-1 px-4 py-2.5 text-[13px]"
        >
          <span className="inline-flex flex-none items-center gap-1.5 font-medium text-green">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
            Live fills
          </span>
          {ticker.map((f, i) => (
            <span key={i} className="flex-none text-text-secondary">
              <Link href={`/c/${f.handle}`} className="text-text-primary hover:underline">
                @{f.handle}
              </Link>{" "}
              cleared <Money atomic={f.amountUsdc} tone="gold" /> · {timeAgo(f.settledAt, now)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-1.5">
          {["All", ...topTags].map(chip)}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <label className="relative flex h-10 min-w-[220px] items-center gap-2 rounded-lg border border-border-bright bg-arc-bg-1 px-3 focus-within:ring-2 focus-within:ring-arc-lavender">
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
