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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  /** Escrow status: 0 Pending, 1 Accepted, 2 Rejected, 3 Refunded. */
  status: number;
}

/**
 * Every bid in every known escrow (ids run 1..getBidCount()), grouped by bidder.
 * Plain JSON so an Inngest step can return it.
 */
export async function indexOnChainBids(): Promise<Record<string, OnChainEntry[]>> {
  const index: Record<string, OnChainEntry[]> = {};
  for (const escrow of knownEscrowAddresses()) {
    const count = (await publicClient.readContract({ address: escrow as Hex, abi: escrowAbi, functionName: "getBidCount" })) as bigint;
    for (let i = BigInt(1); i <= count; i++) {
      const b = await publicClient.readContract({ address: escrow as Hex, abi: escrowAbi, functionName: "getBid", args: [i] });
      const bidder = lower(b[0]);
      (index[bidder] ??= []).push({ escrow, id: i.toString(), creator: lower(b[1]), amount: b[2].toString(), status: Number(b[5]) });
    }
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
    // Prefer bids still Pending on-chain (the ones with USDC actually locked).
    const pool = [...(index[lower(row.bidderAddress)] ?? [])].sort((a, b) => Number(a.status !== 0) - Number(b.status !== 0));
    const candidate = pool.find((e) => matches(row, e) && !claimed.has(key(e.escrow, e.id)));
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

// ─── Orphans: still escrowed on-chain, but the DB row says it's finished ─────────

/**
 * A closed row (accepted / rejected / refunded) with no settlement transaction on
 * record. Before the settlement fix the app wrote these statuses without the chain
 * agreeing, so some of them are still Pending in the escrow with USDC locked.
 */
export interface ClosedRow {
  id: string;
  status: string;
  bidderAddress: string;
  creatorAddress: string;
  amountUsdc: string;
  escrowAddress: string | null;
  onChainBidId: string | null;
  createdAt: string;
}

export interface OrphanReport {
  /** Closed rows to reopen as pending, linked to their on-chain bid. */
  reopen: { rowId: string; previousStatus: string; escrow: string; onChainBidId: string; amountUsdc: string }[];
  /** Pending on-chain bids with no DB row at all (needs manual handling). */
  unmatched: { escrow: string; onChainBidId: string; bidder: string; creator: string; amountUsdc: string }[];
}

/**
 * Pure. `claimed` = "escrow:id" keys owned by open rows (ok or linked). Every other
 * on-chain bid that is still Pending is an orphan; match it to a closed row with
 * the same bidder, creator and amount (exact id first, then oldest row).
 */
export function findOrphans(index: Record<string, OnChainEntry[]>, claimed: Set<string>, closed: ClosedRow[]): OrphanReport {
  const key = (escrow: string, id: string) => `${lower(escrow)}:${id}`;
  const used = new Set<string>();
  const report: OrphanReport = { reopen: [], unmatched: [] };
  for (const [bidder, entries] of Object.entries(index)) {
    for (const e of entries) {
      if (e.status !== 0 || claimed.has(key(e.escrow, e.id))) continue;
      const candidates = closed
        .filter(
          (r) =>
            !used.has(r.id) &&
            lower(r.bidderAddress) === bidder &&
            lower(r.creatorAddress) === e.creator &&
            r.amountUsdc === e.amount &&
            (!r.escrowAddress || lower(r.escrowAddress) === lower(e.escrow)),
        )
        .sort((a, b) => Number(b.onChainBidId === e.id) - Number(a.onChainBidId === e.id) || a.createdAt.localeCompare(b.createdAt));
      const match = candidates.find((r) => !r.onChainBidId || r.onChainBidId === e.id || !r.escrowAddress);
      if (match) {
        used.add(match.id);
        report.reopen.push({ rowId: match.id, previousStatus: match.status, escrow: e.escrow, onChainBidId: e.id, amountUsdc: e.amount });
      } else {
        report.unmatched.push({ escrow: e.escrow, onChainBidId: e.id, bidder, creator: e.creator, amountUsdc: e.amount });
      }
    }
  }
  return report;
}

/** Closed rows without a settlement transaction, for these bidders. */
export async function loadClosedRows(bidders: string[]): Promise<ClosedRow[]> {
  if (!bidders.length) return [];
  const rows = await db.query.bids.findMany({
    where: and(
      inArray(bids.status, ["accepted", "rejected", "refunded"]),
      isNull(bids.settlementOnChainTxHash),
      inArray(sql`lower(${bids.bidderAddress})`, bidders.map(lower)),
    ),
    columns: { id: true, status: true, bidderAddress: true, creatorAddress: true, amountUsdc: true, escrowAddress: true, onChainBidId: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Reopens a closed row whose bid is still Pending on-chain, so the creator can
 * reply or autoRefund can return the USDC. Only touches rows still closed with no
 * settlement transaction on record.
 */
export async function reopenOrphan(r: OrphanReport["reopen"][number]): Promise<"updated" | "skipped"> {
  try {
    const res = await db
      .update(bids)
      .set({
        status: "pending",
        escrowAddress: lower(r.escrow),
        onChainBidId: r.onChainBidId,
        settledAt: null,
        settlementTxHash: null,
        settlementAction: null,
        failReason: null,
      })
      .where(and(eq(bids.id, r.rowId), inArray(bids.status, ["accepted", "rejected", "refunded"]), isNull(bids.settlementOnChainTxHash)))
      .returning({ id: bids.id });
    return res.length ? "updated" : "skipped";
  } catch {
    return "skipped"; // (escrow, id) already owned by another row
  }
}
