/**
 * Repairs open bids (pending / counter_offered) whose DB row doesn't match the
 * escrow. Before the settlement fix, the app recorded bids as "pending" even when
 * the on-chain placeBid never happened, so some rows have no USDC behind them
 * ("phantoms"). They inflate the order books and can never be accepted or refunded.
 *
 * For each open row it looks for the real bid in every known escrow:
 *   ok       – the row's (escrow, id) is the bid. Nothing to do.
 *   linked   – the row had no/a wrong escrow or id, and exactly one unclaimed
 *              on-chain bid has this bidder, creator and amount: link it.
 *   phantom  – no such bid exists in any known escrow: mark it failed
 *              ("never escrowed, no USDC moved"). Only in apply mode.
 *
 * Read-only unless `apply` is true. Bids with a settlement in flight are skipped.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "./db/client";
import { bids } from "./db/schema";
import { escrowAbi, publicClient } from "./arc";
import { knownEscrowAddresses } from "./chain";

const lower = (a: string) => a.toLowerCase();

export interface OnChainEntry {
  escrow: string;
  id: string;
  creator: string;
  amount: string;
}

/** Every bid each bidder has in each known escrow. Plain JSON so an Inngest step can return it. */
export async function indexOnChainBids(bidders: string[]): Promise<Record<string, OnChainEntry[]>> {
  const index: Record<string, OnChainEntry[]> = {};
  for (const bidder of [...new Set(bidders.map(lower))]) {
    const entries: OnChainEntry[] = [];
    for (const escrow of knownEscrowAddresses()) {
      const ids = (await publicClient.readContract({
        address: escrow as Hex,
        abi: escrowAbi,
        functionName: "getBidderBids",
        args: [bidder as Hex],
      })) as readonly bigint[];
      for (const id of ids) {
        const b = await publicClient.readContract({ address: escrow as Hex, abi: escrowAbi, functionName: "getBid", args: [id] });
        entries.push({ escrow, id: id.toString(), creator: lower(b[1]), amount: b[2].toString() });
      }
    }
    index[bidder] = entries;
  }
  return index;
}

export interface OpenRow {
  id: string;
  bidderAddress: string;
  creatorAddress: string;
  amountUsdc: string;
  escrowAddress: string | null;
  onChainBidId: string | null;
  createdAt: string;
}

export type Verdict =
  | { kind: "ok" }
  | { kind: "linked"; escrow: string; onChainBidId: string }
  | { kind: "phantom" };

/**
 * Decides what each open row really is. Pure: `claimed` is the set of
 * "escrow:id" keys already owned by rows that are fine as they are.
 */
export function classifyOpenRows(rows: OpenRow[], index: Record<string, OnChainEntry[]>): Map<string, Verdict> {
  const key = (escrow: string, id: string) => `${lower(escrow)}:${id}`;
  const out = new Map<string, Verdict>();
  const claimed = new Set<string>();
  const matches = (row: OpenRow, e: OnChainEntry) => e.creator === lower(row.creatorAddress) && e.amount === row.amountUsdc;

  // 1. Rows whose recorded (escrow, id) — or, for NULL escrow, (any escrow, id) — is really their bid.
  const unresolved: OpenRow[] = [];
  for (const row of rows) {
    const mine = index[lower(row.bidderAddress)] ?? [];
    const exact = row.onChainBidId
      ? mine.find(
          (e) =>
            e.id === row.onChainBidId &&
            (row.escrowAddress ? lower(e.escrow) === lower(row.escrowAddress) : true) &&
            matches(row, e) &&
            !claimed.has(key(e.escrow, e.id)),
        )
      : undefined;
    if (exact) {
      claimed.add(key(exact.escrow, exact.id));
      out.set(
        row.id,
        row.escrowAddress ? { kind: "ok" } : { kind: "linked", escrow: exact.escrow, onChainBidId: exact.id },
      );
    } else {
      unresolved.push(row);
    }
  }

  // 2. The rest: link to an unclaimed on-chain bid with the same bidder, creator and
  //    amount (oldest row first), otherwise it never reached escrow.
  const sorted = [...unresolved].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const row of sorted) {
    const candidate = (index[lower(row.bidderAddress)] ?? []).find((e) => matches(row, e) && !claimed.has(key(e.escrow, e.id)));
    if (candidate) {
      claimed.add(key(candidate.escrow, candidate.id));
      out.set(row.id, { kind: "linked", escrow: candidate.escrow, onChainBidId: candidate.id });
    } else {
      out.set(row.id, { kind: "phantom" });
    }
  }
  return out;
}

export const PHANTOM_REASON = "Never escrowed on-chain (recorded before the settlement fix). No USDC moved.";

/** Open rows to check: escrowed statuses with no settlement in flight. */
export async function loadOpenRows(): Promise<OpenRow[]> {
  const rows = await db.query.bids.findMany({
    where: and(inArray(bids.status, ["pending", "counter_offered"]), isNull(bids.settlementTxHash)),
    columns: { id: true, bidderAddress: true, creatorAddress: true, amountUsdc: true, escrowAddress: true, onChainBidId: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Writes one verdict. Each update re-checks the row is still open and untouched. */
export async function applyVerdict(rowId: string, verdict: Verdict): Promise<"updated" | "skipped"> {
  const stillOpen = and(eq(bids.id, rowId), inArray(bids.status, ["pending", "counter_offered"]), isNull(bids.settlementTxHash));
  if (verdict.kind === "linked") {
    try {
      const r = await db
        .update(bids)
        .set({ escrowAddress: lower(verdict.escrow), onChainBidId: verdict.onChainBidId })
        .where(stillOpen)
        .returning({ id: bids.id });
      return r.length ? "updated" : "skipped";
    } catch {
      return "skipped"; // another row already holds this (escrow, id): unique index
    }
  }
  if (verdict.kind === "phantom") {
    const r = await db.update(bids).set({ status: "failed", failReason: PHANTOM_REASON }).where(stillOpen).returning({ id: bids.id });
    return r.length ? "updated" : "skipped";
  }
  return "skipped";
}
