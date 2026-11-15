import Link from "next/link";
import { Change, Money, Num, StatStrip } from "./primitives";
import { formatChange, formatDuration, timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Platform totals, all from bids settled on Arc (see lib/market.ts). */
export interface PlatformStatsData {
  escrowUsdc: string;
  escrowSource: string;
  settled24hUsdc: string;
  settledPrev24hUsdc: string;
  cleared24h: number;
  refunded24h: number;
  activeAgents: number;
  medianReply7dMs: number | null;
}

export interface FillTick {
  handle: string;
  amountUsdc: string;
  settledAt: string;
}

/** Server-safe strip of live platform numbers (markets page, homepage). */
export function PlatformStats({ totals, className }: { totals: PlatformStatsData; className?: string }) {
  return (
    <StatStrip
      className={className}
      items={[
        { label: "In escrow now", value: <Money atomic={totals.escrowUsdc} tone="gold" />, sub: totals.escrowSource, tone: "gold" },
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
