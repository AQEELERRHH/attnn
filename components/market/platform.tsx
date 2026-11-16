import type * as React from "react";
import Link from "next/link";
import { Change, Money, Num, StatStrip } from "./primitives";
import { formatChange, formatDuration, timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Platform totals, all from bids settled on Arc (see lib/market.ts). */
export interface PlatformStatsData {
  escrowUsdc: string;
  escrowSource: string;
  /**
   * The window the settled numbers cover: the last 24h when anything settled
   * in it, else the last 7 days, else all time (lib/market.ts settledHeadline).
   */
  settledWindow: "24h" | "7d" | "all";
  settledUsdc: string;
  /** Only for the 24h window's change line. */
  settledPrev24hUsdc: string;
  cleared: number;
  refunded: number;
  activeAgents: number;
  medianReply7dMs: number | null;
}

export interface FillTick {
  handle: string;
  amountUsdc: string;
  settledAt: string;
}

const SETTLED_LABEL = { "24h": "24h settled", "7d": "7d settled", all: "Settled, all time" } as const;
const CLEARED_WINDOW = { "24h": "24h", "7d": "7d", all: "all time" } as const;

/** The line under the settled amount: the change for 24h, else why the window is wider. */
function settledSub(t: PlatformStatsData): React.ReactNode {
  if (t.settledWindow === "7d") return "None in the last 24h";
  if (t.settledWindow === "all") return "None in the last 7 days";
  if (BigInt(t.settledPrev24hUsdc) === BigInt(0)) return "Nothing settled the 24h before";
  return (
    <>
      <Change value={formatChange(BigInt(t.settledUsdc), BigInt(t.settledPrev24hUsdc))} /> vs prior 24h
    </>
  );
}

/** Server-safe strip of live platform numbers (markets page, homepage). */
export function PlatformStats({ totals, enter, className }: { totals: PlatformStatsData; enter?: boolean; className?: string }) {
  return (
    <StatStrip
      className={className}
      enter={enter}
      items={[
        {
          label: "In escrow now",
          value: <Money atomic={totals.escrowUsdc} tone={BigInt(totals.escrowUsdc) > BigInt(0) ? "gold" : "default"} />,
          sub: totals.escrowSource,
          tone: "gold",
        },
        { label: SETTLED_LABEL[totals.settledWindow], value: <Money atomic={totals.settledUsdc} />, sub: settledSub(totals) },
        {
          label: `Bids cleared · ${CLEARED_WINDOW[totals.settledWindow]}`,
          value: <Num>{totals.cleared}</Num>,
          sub: `${totals.refunded} refunded`,
        },
        { label: "Active bidder agents", value: <Num>{totals.activeAgents}</Num>, sub: "Running on a schedule" },
        { label: "Median reply", value: <Num>{formatDuration(totals.medianReply7dMs)}</Num>, sub: "Across cleared bids, 7d" },
      ]}
    />
  );
}

/**
 * Scrolling tape of the latest cleared bids. Renders nothing when there are none.
 * The list is drawn twice so the tape loops without a gap; the copy is hidden from
 * screen readers. Hover pauses it; reduced-motion users get a static row.
 */
export function LiveFills({ ticker, now, className }: { ticker: FillTick[]; now: number; className?: string }) {
  if (ticker.length === 0) return null;
  const item = (f: FillTick, i: number, copy: boolean) => (
    <li key={`${copy ? "c" : "o"}${i}`} aria-hidden={copy || undefined} className="flex flex-none items-center gap-2 px-5 text-text-secondary">
      <Link href={`/c/${f.handle}`} tabIndex={copy ? -1 : undefined} className="font-medium text-text-primary hover:underline">
        @{f.handle}
      </Link>
      <span className="text-text-dim">cleared</span>
      <Money atomic={f.amountUsdc} tone="success" />
      <Num className="text-text-dim">{timeAgo(f.settledAt, now)}</Num>
      <span aria-hidden className="ml-3 h-3 w-px bg-border-bright" />
    </li>
  );
  // Roughly 4s per fill keeps the tape readable whatever its length.
  const duration = `${Math.max(30, ticker.length * 4)}s`;
  return (
    <div
      aria-label="Latest fills"
      className={cn("flex h-11 items-stretch overflow-hidden rounded-xl border border-border bg-arc-bg-1 text-[13px]", className)}
    >
      <span className="z-10 inline-flex flex-none items-center gap-2 border-r border-border bg-arc-bg-1 px-4 font-medium text-green">
        <span aria-hidden className="live-dot" />
        Live fills
      </span>
      <div className="marquee relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_40px,#000_calc(100%-40px),transparent)]">
        <ul className="marquee-track h-full items-center" style={{ ["--marquee-duration" as string]: duration }}>
          {ticker.map((f, i) => item(f, i, false))}
          {ticker.map((f, i) => item(f, i, true))}
        </ul>
      </div>
    </div>
  );
}
