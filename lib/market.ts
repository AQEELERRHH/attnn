/**
 * Market numbers, computed ONLY from bids that are provably settled on Arc.
 *
 * "Cleared" = status accepted AND a settlement transaction hash recorded from
 * the chain. Old rows marked accepted before the settlement fix (no hash) are
 * excluded, because many of them never actually paid out.
 *
 * The pure functions here are unit-tested; the loaders below just fetch rows.
 */
import { and, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import type { BidStatus } from "./db/schema";

const DAY = 24 * 60 * 60 * 1000;

export interface MarketBid {
  id: string;
  creatorUserId: string;
  bidderUserId: string;
  amountUsdc: string;
  status: BidStatus;
  createdAt: Date;
  settledAt: Date | null;
  settlementOnChainTxHash: string | null;
  settlementTxHash: string | null;
}

export interface Fill {
  bidId: string;
  bidderUserId: string;
  amountUsdc: string;
  settledAt: string; // ISO
  replyMs: number;
  txHash: string;
}

export interface CreatorMarketStats {
  floorUsdc: string;
  /** Highest escrowed bid, or null if none. */
  topBidUsdc: string | null;
  openBids: number;
  lastClearedUsdc: string | null;
  /** The fill before the last one, for the % change. */
  prevClearedUsdc: string | null;
  volume7dUsdc: string;
  /** Cleared ÷ (cleared + refunded-after-no-reply), last 30 days. null if none ended. */
  replyRate: number | null;
  /** Median time from bid to paid reply, last 30 days. */
  medianReplyMs: number | null;
  /** Cleared prices over the last 7 days (dollars), oldest first, for sparklines. */
  trend7d: number[];
  /** Most recent fills first (last 30 days). */
  fills: Fill[];
  /** True once the creator has at least one cleared bid. */
  hasHistory: boolean;
}

const OPEN: BidStatus[] = ["pending", "counter_offered"];

export function isCleared(b: MarketBid): b is MarketBid & { settledAt: Date; settlementOnChainTxHash: string } {
  return b.status === "accepted" && !!b.settledAt && !!b.settlementOnChainTxHash;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const toDollars = (atomic: string) => Number(BigInt(atomic) / BigInt(10_000)) / 100;

/** Stats for one creator from that creator's bids (any statuses, last 30 days + all open). */
export function computeCreatorStats(bidsForCreator: MarketBid[], floorUsdc: string, now: number = Date.now()): CreatorMarketStats {
  const open = bidsForCreator.filter((b) => OPEN.includes(b.status));
  const top = open.reduce<bigint | null>((m, b) => (m === null || BigInt(b.amountUsdc) > m ? BigInt(b.amountUsdc) : m), null);

  const cleared = bidsForCreator
    .filter(isCleared)
    .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime());
  const cleared30 = cleared.filter((b) => b.settledAt.getTime() >= now - 30 * DAY);
  const cleared7 = cleared.filter((b) => b.settledAt.getTime() >= now - 7 * DAY);

  const ignored30 = bidsForCreator.filter(
    (b) => b.status === "refunded" && b.settledAt && b.settledAt.getTime() >= now - 30 * DAY,
  ).length;
  const ended = cleared30.length + ignored30;

  return {
    floorUsdc,
    topBidUsdc: top === null ? null : top.toString(),
    openBids: open.length,
    lastClearedUsdc: cleared[0]?.amountUsdc ?? null,
    prevClearedUsdc: cleared[1]?.amountUsdc ?? null,
    volume7dUsdc: cleared7.reduce((s, b) => s + BigInt(b.amountUsdc), BigInt(0)).toString(),
    replyRate: ended ? cleared30.length / ended : null,
    medianReplyMs: median(cleared30.map((b) => b.settledAt.getTime() - b.createdAt.getTime())),
    trend7d: [...cleared7].reverse().map((b) => toDollars(b.amountUsdc)),
    fills: cleared30.map((b) => ({
      bidId: b.id,
      bidderUserId: b.bidderUserId,
      amountUsdc: b.amountUsdc,
      settledAt: b.settledAt.toISOString(),
      replyMs: b.settledAt.getTime() - b.createdAt.getTime(),
      txHash: b.settlementOnChainTxHash,
    })),
    hasHistory: cleared.length > 0,
  };
}

export interface PlatformTotals {
  /** Sum of escrowed bids in the DB (the page prefers the on-chain number when available). */
  openEscrowUsdc: string;
  settled24hUsdc: string;
  settledPrev24hUsdc: string;
  cleared24h: number;
  refunded24h: number;
  medianReply7dMs: number | null;
}

export function computePlatformTotals(all: MarketBid[], now: number = Date.now()): PlatformTotals {
  const cleared = all.filter(isCleared);
  const inWindow = (d: Date | null, from: number, to: number) => !!d && d.getTime() >= from && d.getTime() < to;
  const c24 = cleared.filter((b) => inWindow(b.settledAt, now - DAY, now + 1));
  const cPrev = cleared.filter((b) => inWindow(b.settledAt, now - 2 * DAY, now - DAY));
  const sum = (xs: MarketBid[]) => xs.reduce((s, b) => s + BigInt(b.amountUsdc), BigInt(0)).toString();
  return {
    openEscrowUsdc: sum(all.filter((b) => OPEN.includes(b.status))),
    settled24hUsdc: sum(c24),
    settledPrev24hUsdc: sum(cPrev),
    cleared24h: c24.length,
    refunded24h: all.filter((b) => b.status === "refunded" && inWindow(b.settledAt, now - DAY, now + 1)).length,
    medianReply7dMs: median(
      cleared.filter((b) => b.settledAt.getTime() >= now - 7 * DAY).map((b) => b.settledAt.getTime() - b.createdAt.getTime()),
    ),
  };
}

// ─── Loaders (server only) ──────────────────────────────────────────────────

const marketColumns = {
  id: true,
  creatorUserId: true,
  bidderUserId: true,
  amountUsdc: true,
  status: true,
  createdAt: true,
  settledAt: true,
  settlementOnChainTxHash: true,
  settlementTxHash: true,
} as const;

/** Open bids plus anything settled in the last 30 days, optionally for one creator. */
export async function loadMarketBids(creatorUserId?: string, now: number = Date.now()): Promise<MarketBid[]> {
  const { db } = await import("./db/client");
  const { bids } = await import("./db/schema");
  const since = new Date(now - 30 * DAY);
  const relevant = or(
    inArray(bids.status, OPEN),
    and(inArray(bids.status, ["accepted", "rejected", "refunded"]), isNotNull(bids.settledAt), gte(bids.settledAt, since)),
  );
  return db.query.bids.findMany({
    columns: marketColumns,
    where: creatorUserId ? and(eq(bids.creatorUserId, creatorUserId), relevant) : relevant,
    orderBy: [desc(bids.createdAt)],
    limit: 5000,
  });
}

/**
 * USDC currently held by the escrow contracts (the current one plus any earlier
 * deployment that still holds old bids), read from Arc. null if a read fails.
 */
export async function readEscrowBalance(): Promise<string | null> {
  try {
    const { publicClient, usdcAbi, USDC_ADDRESS } = await import("./arc");
    const { knownEscrowAddresses } = await import("./chain");
    const escrows = knownEscrowAddresses();
    if (!escrows.length) return null;
    const balances = await Promise.all(
      escrows.map((escrow) =>
        publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [escrow] }),
      ),
    );
    return balances.reduce((sum, b) => sum + b, BigInt(0)).toString();
  } catch (err) {
    console.warn("readEscrowBalance failed:", err);
    return null;
  }
}
