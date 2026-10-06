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
export function OrderBook({ bids, floorUsdc, className }: { bids: OrderBookBid[]; floorUsdc: string; className?: string }) {
  const floor = creatorFloor(floorUsdc);
  const top = bids.reduce((m, b) => (BigInt(b.amountUsdc) > m ? BigInt(b.amountUsdc) : m), BigInt(0));
  const ranked = React.useMemo(
    () => [...bids].sort((a, b) => (BigInt(b.amountUsdc) > BigInt(a.amountUsdc) ? 1 : BigInt(b.amountUsdc) < BigInt(a.amountUsdc) ? -1 : 0)),
    [bids],
  );

  const columns: MarketColumn<OrderBookBid>[] = [
    { key: "rank", label: "#", render: (_b, i) => <Num className="text-text-secondary">{i + 1}</Num> },
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
            <span aria-hidden className="absolute inset-y-[-6px] right-0 rounded bg-arc-gold/[0.08]" style={{ width: `${pct}%` }} />
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
        return <Num className="text-arc-lavender">{pct > 0 ? `+${pct}%` : `${pct}%`}</Num>;
      },
    },
    { key: "placed", label: "Placed", render: (b) => <Num className="text-text-secondary">{timeAgo(b.createdAt)}</Num> },
    {
      key: "refund",
      label: "Refund",
      render: (b) => {
        const r = refundCountdown(b.createdAt);
        return <Num className={cn(r.due ? "text-arc-coral" : "text-arc-coral/90")}>{r.label}</Num>;
      },
    },
    {
      key: "score",
      label: "Creator score",
      align: "right",
      render: (b) => <Num>{b.score == null ? "—" : b.score.toFixed(1)}</Num>,
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
      empty="No open bids. Be the first: anything at or above the floor gets escrowed."
    />
  );
}
