import Link from "next/link";
import { Change, Money, Num, StatStrip } from "./primitives";
import { formatChange, formatDuration, timeAgo } from "@/lib/format";

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
  );
}

/** Horizontal ticker of the latest cleared bids. Renders nothing when there are none. */
export function LiveFills({ ticker, now, className }: { ticker: FillTick[]; now: number; className?: string }) {
  if (ticker.length === 0) return null;
  return (
    <div
      aria-label="Latest fills"
      className={`flex items-center gap-4 overflow-x-auto whitespace-nowrap rounded-[10px] border border-border bg-arc-bg-1 px-4 py-2.5 text-[13px] ${className ?? ""}`}
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
  );
}
