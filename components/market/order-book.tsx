"use client";

import * as React from "react";
import { MarketTable, type MarketColumn } from "./market-table";
import { Money, Num } from "./primitives";
import { creatorFloor } from "@/lib/bid-rules";
import { refundCountdown, timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface OrderBookBid {
  id: string;
  /** Bidder agent name, or the bidder's handle for manual bids. */
  agent: string;
  /** Who runs the agent (company / user), optional second line. */
  owner?: string | null;
  amountUsdc: string;
  /** ISO string (props must be serialisable from server components). */
  createdAt: string;
  /** Creator agent's score 0–10, if triaged. */
  score?: number | null;
}

/**
 * Open, escrowed bids on one creator, highest first, with a depth bar. Only pass
 * bids that are actually escrowed (status pending / counter_offered).
 */
export function OrderBook({
  bids,
  floorUsdc,
  now,
  className,
}: {
  bids: OrderBookBid[];
  floorUsdc: string;
  /** Server render time, so times match between server and browser (no hydration mismatch). */
  now?: number;
  className?: string;
}) {
  const floor = creatorFloor(floorUsdc);
  const top = bids.reduce((m, b) => (BigInt(b.amountUsdc) > m ? BigInt(b.amountUsdc) : m), BigInt(0));
  const ranked = React.useMemo(
    () => [...bids].sort((a, b) => (BigInt(b.amountUsdc) > BigInt(a.amountUsdc) ? 1 : BigInt(b.amountUsdc) < BigInt(a.amountUsdc) ? -1 : 0)),
    [bids],
  );

  const columns: MarketColumn<OrderBookBid>[] = [
    {
      key: "rank",
      label: "#",
      render: (_b, i) => (
        <Num className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs", i === 0 ? "bg-arc-gold/15 text-arc-gold" : "text-text-secondary")}>
          {i + 1}
        </Num>
      ),
    },
    {
      key: "agent",
      label: "Bidder agent",
      render: (b) => (
        <div>
          <div className="font-medium">{b.agent}</div>
          {b.owner && <div className="text-xs text-text-secondary">{b.owner}</div>}
        </div>
      ),
    },
    {
      key: "amount",
      label: "Bid",
      align: "right",
      className: "w-[150px]",
      render: (b) => {
        const pct = top > BigInt(0) ? Number((BigInt(b.amountUsdc) * BigInt(90)) / top) : 0;
        return (
          <span className="relative block">
            <span
              aria-hidden
              className="absolute inset-y-[-6px] right-[-6px] rounded-[4px] bg-gradient-to-l from-arc-gold/[0.18] to-arc-gold/[0.02]"
              style={{ width: `calc(${pct}% + 6px)` }}
            />
            <Money atomic={b.amountUsdc} tone="gold" className="relative font-medium" />
          </span>
        );
      },
    },
    {
      key: "vsFloor",
      label: "vs floor",
      align: "right",
      render: (b) => {
        const pct = Number(((BigInt(b.amountUsdc) - floor) * BigInt(100)) / floor);
        return <Num className={pct > 0 ? "text-green" : "text-text-secondary"}>{pct > 0 ? `+${pct}%` : `${pct}%`}</Num>;
      },
    },
    { key: "placed", label: "Placed", render: (b) => <Num className="text-text-secondary">{timeAgo(b.createdAt, now)}</Num> },
    {
      key: "refund",
      label: "Refund",
      render: (b) => {
        const r = refundCountdown(b.createdAt, now);
        return <Num className={cn(r.due ? "text-arc-coral" : "text-arc-coral/85")}>{r.label}</Num>;
      },
    },
    {
      key: "score",
      label: "Creator score",
      align: "right",
      render: (b) => <ScoreMeter score={b.score} />,
    },
  ];

  return (
    <MarketTable
      caption="Open bids, highest first"
      columns={columns}
      rows={ranked}
      rowKey={(b) => b.id}
      minWidth={640}
      className={className}
      empty={
        <span className="flex flex-col items-center gap-1">
          <span className="font-medium text-text-primary">No open bids</span>
          <span>Be the first: anything at or above the floor gets escrowed.</span>
        </span>
      }
      mobileCard={(b, i) => {
        const r = refundCountdown(b.createdAt, now);
        return (
          <div className="flex items-start gap-3">
            <Num className="w-5 pt-0.5 text-text-secondary">{i + 1}</Num>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{b.agent}</div>
              <div className="text-xs text-text-secondary">
                <Num>{timeAgo(b.createdAt, now)}</Num> · <Num className="text-arc-coral">refund {r.label}</Num>
                {b.score != null && (
                  <>
                    {" "}
                    · score <Num>{b.score.toFixed(1)}</Num>
                  </>
                )}
              </div>
            </div>
            <Money atomic={b.amountUsdc} tone="gold" className="font-medium" />
          </div>
        );
      }}
    />
  );
}

/**
 * The creator agent's 0–10 score as a short meter. Colours follow its thresholds
 * (README, "Creator agent"): 8+ surfaces or accepts, 5–7 may counter, under 5 declines.
 */
function ScoreMeter({ score }: { score: number | null | undefined }) {
  if (score == null) return <Num className="text-text-dim">—</Num>;
  const tone = score >= 8 ? "bg-green" : score >= 5 ? "bg-arc-gold" : "bg-arc-coral";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-arc-bg-3">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(0, Math.min(10, score)) * 10}%` }} />
      </span>
      <Num>{score.toFixed(1)}</Num>
    </span>
  );
}
