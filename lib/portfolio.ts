/**
 * Portfolio numbers for the dashboard. Pure functions over the signed-in user's
 * bids, so the totals follow the same rules as the market screens:
 *   - money "moved" counts only bids settled on-chain (accepted with a settlement hash)
 *   - "in escrow" counts only escrowed bids (pending / counter_offered), never placing ones
 *   - refunds count bids whose USDC went back (rejected or refunded)
 * Atomic USDC strings in, atomic USDC strings out. No float maths.
 */
import type { BidStatus } from "./db/schema";

const DAY = 24 * 60 * 60 * 1000;
const ZERO = BigInt(0);

export interface PortfolioBid {
  id: string;
  bidderUserId: string;
  creatorUserId: string;
  amountUsdc: string;
  status: BidStatus;
  createdAt: Date;
  settledAt: Date | null;
  settlementOnChainTxHash: string | null;
}

export interface SumCount {
  usdc: string;
  count: number;
}

function sum(xs: PortfolioBid[]): SumCount {
  return { usdc: xs.reduce((s, b) => s + BigInt(b.amountUsdc), ZERO).toString(), count: xs.length };
}

const isOpen = (b: PortfolioBid) => b.status === "pending" || b.status === "counter_offered";
const isCleared = (b: PortfolioBid) => b.status === "accepted" && !!b.settledAt && !!b.settlementOnChainTxHash;
const isReturned = (b: PortfolioBid) => (b.status === "refunded" || b.status === "rejected") && !!b.settledAt;
const settledSince = (b: PortfolioBid, since: number) => !!b.settledAt && b.settledAt.getTime() >= since;

export interface BidderTotals {
  inEscrow: SumCount;
  /** Bids still being escrowed (placing). Not in any balance yet. */
  confirming: SumCount;
  cleared7d: SumCount;
  returned7d: SumCount;
}

export function computeBidderTotals(all: PortfolioBid[], userId: string, now: number = Date.now()): BidderTotals {
  const mine = all.filter((b) => b.bidderUserId === userId);
  const since = now - 7 * DAY;
  return {
    inEscrow: sum(mine.filter(isOpen)),
    confirming: sum(mine.filter((b) => b.status === "placing")),
    cleared7d: sum(mine.filter((b) => isCleared(b) && settledSince(b, since))),
    returned7d: sum(mine.filter((b) => isReturned(b) && settledSince(b, since))),
  };
}

export interface CreatorTotals {
  /** Escrowed bids waiting on this creator's reply. */
  waiting: SumCount;
  earned7d: SumCount;
}

export function computeCreatorTotals(all: PortfolioBid[], userId: string, now: number = Date.now()): CreatorTotals {
  const mine = all.filter((b) => b.creatorUserId === userId);
  return {
    waiting: sum(mine.filter(isOpen)),
    earned7d: sum(mine.filter((b) => isCleared(b) && settledSince(b, now - 7 * DAY))),
  };
}

/**
 * Position of each open bid in its creator's book: 1 = highest. Ties share the
 * better rank (a bid only ranks below strictly higher bids).
 */
export function bookRanks(
  mine: { id: string; creatorUserId: string; amountUsdc: string }[],
  openBook: { creatorUserId: string; amountUsdc: string }[],
): Map<string, { rank: number; of: number }> {
  const byCreator = new Map<string, bigint[]>();
  for (const b of openBook) {
    const list = byCreator.get(b.creatorUserId) ?? [];
    list.push(BigInt(b.amountUsdc));
    byCreator.set(b.creatorUserId, list);
  }
  const out = new Map<string, { rank: number; of: number }>();
  for (const b of mine) {
    const book = byCreator.get(b.creatorUserId);
    if (!book?.length) continue;
    const amount = BigInt(b.amountUsdc);
    out.set(b.id, { rank: book.filter((a) => a > amount).length + 1, of: book.length });
  }
  return out;
}
