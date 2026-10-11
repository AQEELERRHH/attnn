/**
 * The money health check (docs/RUNBOOK.md). Read-only: it reports, it never repairs.
 *
 * Quick checks (every hour):
 *   - bids still "placing" after an hour (placement should take under 5 minutes)
 *   - settlements in flight for over an hour
 *   - creator registrations still confirming after an hour
 *   - the pause switch is on (a reminder, not a problem)
 *
 * Full check (once a day; reads every bid in the escrow from Arc, pinned to one block):
 *   - settlements that failed and are still waiting for a retry
 *   - the escrow holds at least the total of its bids that are still Pending on-chain
 *     (less would mean it can't pay everyone: stop and investigate)
 *   - every open bid in the database is a real Pending bid on-chain, and every
 *     Pending bid on-chain has an open row (so the creator can reply and the
 *     3-day auto-refund can claim it)
 */
import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "./db/client";
import { bids, profiles, rateLimits } from "./db/schema";
import { escrowAbi, publicClient, usdcAbi, USDC_ADDRESS } from "./arc";
import { escrowAdmin, readEscrowBid } from "./escrow";
import { escrowAddress, knownEscrowAddresses } from "./chain";
import { formatUsd } from "./bid-rules";
import { appSwitchPaused } from "./app-settings";
import { classifyOpenRows, findOrphans, loadClosedRows, loadOpenRows, type OnChainEntry } from "./reconcile";

export interface HealthReport {
  problems: string[];
  notes: string[];
}

const HOUR = 60 * 60 * 1000;

export async function quickHealthCheck(now = Date.now()): Promise<HealthReport> {
  const problems: string[] = [];
  const notes: string[] = [];
  const hourAgo = new Date(now - HOUR);

  const stuckPlacing = await db
    .select({ id: bids.id, amount: bids.amountUsdc })
    .from(bids)
    .where(and(eq(bids.status, "placing"), lt(bids.createdAt, hourAgo)));
  if (stuckPlacing.length) {
    problems.push(`${stuckPlacing.length} bid(s) still "placing" after an hour: ${stuckPlacing.map((b) => b.id).slice(0, 10).join(", ")}`);
  }

  const stuckSettling = await db
    .select({ id: bids.id, action: bids.settlementAction })
    .from(bids)
    .where(
      and(
        inArray(bids.status, ["pending", "counter_offered"]),
        isNotNull(bids.settlementTxHash),
        // Sent before migration 0008 (no timestamp) counts as old.
        or(isNull(bids.settlementSubmittedAt), lt(bids.settlementSubmittedAt, hourAgo)),
      ),
    );
  if (stuckSettling.length) {
    problems.push(
      `${stuckSettling.length} settlement(s) in flight for over an hour: ${stuckSettling
        .slice(0, 10)
        .map((b) => `${b.id} (${b.action})`)
        .join(", ")}`,
    );
  }

  // Registering: sent to the registry, not confirmed yet, no error recorded. The sweep
  // confirms these within minutes, so any older than an hour are worth a look.
  const registering = await db
    .select({ handle: profiles.handle })
    .from(profiles)
    .where(
      and(eq(profiles.isActive, false), isNotNull(profiles.onChainTx), isNull(profiles.registrationError), lt(profiles.createdAt, hourAgo)),
    );
  if (registering.length) notes.push(`${registering.length} creator market(s) still registering on Arc: ${registering.map((p) => p.handle).slice(0, 10).join(", ")}`);

  if (await appSwitchPaused()) notes.push("New bids are PAUSED (app_settings.bids_paused = true).");
  await checkEscrowAdmin(problems, notes);

  return { problems, notes };
}

/**
 * The escrow's admin state (v2). Pausing is an emergency action, and a new owner or an
 * open handover nobody planned means the admin wallet may be compromised, so all three
 * are alerts. ATTN_ESCROW_ADMIN is the address you expect to own the escrow.
 */
async function checkEscrowAdmin(problems: string[], notes: string[]): Promise<void> {
  const escrow = escrowAddress();
  if (!escrow) return;
  let admin: Awaited<ReturnType<typeof escrowAdmin>>;
  try {
    admin = await escrowAdmin(escrow);
  } catch (err) {
    problems.push(`Could not read the escrow's admin state: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!admin) return; // v1 escrow: no admin
  if (admin.paused) {
    problems.push("The escrow contract is PAUSED on-chain: new bids are refused (replies and refunds still work). If you didn't pause it, the admin wallet may be compromised: see docs/RUNBOOK.md.");
  }
  const expected = process.env.ATTN_ESCROW_ADMIN?.trim().toLowerCase();
  if (!expected) {
    notes.push(`ATTN_ESCROW_ADMIN is not set, so the escrow owner (${admin.owner}) isn't being checked.`);
  } else if (admin.owner.toLowerCase() !== expected) {
    problems.push(`The escrow's owner is ${admin.owner}, not ATTN_ESCROW_ADMIN (${expected}). If you didn't hand it over, treat the admin wallet as compromised: see docs/RUNBOOK.md.`);
  }
  if (!/^0x0{40}$/i.test(admin.pendingOwner)) {
    problems.push(`An escrow ownership handover to ${admin.pendingOwner} is open. If you didn't start it, cancel it now: see docs/RUNBOOK.md.`);
  }
}

/** One block every on-chain read of a full check is pinned to (JSON-safe for Inngest steps). */
export interface HealthSnapshot {
  blockNumber: string;
  /** Block time, ms since epoch. */
  blockTime: number;
}

export interface ChainBid extends OnChainEntry {
  bidder: string;
}

export async function snapshotBlock(): Promise<HealthSnapshot> {
  const blockNumber = await publicClient.getBlockNumber();
  const block = await publicClient.getBlock({ blockNumber });
  return { blockNumber: blockNumber.toString(), blockTime: Number(block.timestamp) * 1000 };
}

/** How many bids each known escrow had at the snapshot block. */
export async function escrowBidCounts(snap: HealthSnapshot): Promise<{ escrow: string; count: number }[]> {
  const out: { escrow: string; count: number }[] = [];
  for (const escrow of knownEscrowAddresses()) {
    const count = (await publicClient.readContract({
      address: escrow as Hex,
      abi: escrowAbi,
      functionName: "getBidCount",
      blockNumber: BigInt(snap.blockNumber),
    })) as bigint;
    out.push({ escrow, count: Number(count) });
  }
  return out;
}

/** Bids [from, to] of one escrow at the snapshot block, 20 reads at a time. */
export async function readEscrowBids(escrow: string, from: number, to: number, snap: HealthSnapshot): Promise<ChainBid[]> {
  const ids = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const out: ChainBid[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = await Promise.all(
      ids.slice(i, i + 20).map(async (id) => {
        const b = await readEscrowBid(escrow, BigInt(id), BigInt(snap.blockNumber));
        return {
          escrow,
          id: String(id),
          bidder: b.bidder.toLowerCase(),
          creator: b.creator.toLowerCase(),
          amount: b.amount.toString(),
          status: b.status,
        };
      }),
    );
    out.push(...chunk);
  }
  return out;
}

/**
 * Compares the escrow at the snapshot block with the database. Rows created after the
 * block, and bids settled after it, are left out: they changed while the check ran.
 */
export async function evaluateFullHealth(chainBids: ChainBid[], snap: HealthSnapshot): Promise<HealthReport> {
  const problems: string[] = [];
  const notes: string[] = [];
  const escrow = escrowAddress();
  if (!escrow) return { problems: ["ATTN_ESCROW_CONTRACT is not set"], notes };
  const asOf = new Date(snap.blockTime);

  const index: Record<string, OnChainEntry[]> = {};
  for (const b of chainBids) (index[b.bidder] ??= []).push({ escrow: b.escrow, id: b.id, creator: b.creator, amount: b.amount, status: b.status });

  const pendingOnChain = chainBids.filter((e) => e.status === 0 && e.escrow.toLowerCase() === escrow);
  const owed = pendingOnChain.reduce((s, e) => s + BigInt(e.amount), BigInt(0));
  const held = (await publicClient.readContract({
    address: USDC_ADDRESS as Hex,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [escrow as Hex],
    blockNumber: BigInt(snap.blockNumber),
  })) as bigint;
  if (held < owed) {
    problems.push(
      `ESCROW SHORTFALL at block ${snap.blockNumber}: the escrow holds ${formatUsd(held)} but owes ${formatUsd(owed)} across ${pendingOnChain.length} pending bid(s). Pause new bids and investigate now.`,
    );
  } else {
    notes.push(`Escrow holds ${formatUsd(held)} for ${pendingOnChain.length} pending bid(s) totalling ${formatUsd(owed)} (block ${snap.blockNumber}).`);
    if (held > owed) notes.push(`${formatUsd(held - owed)} more than owed (USDC sent straight to the contract; nobody can withdraw it).`);
  }

  // Reported once a day, not hourly: such a bid keeps its reason until the next try,
  // and the creator or auto-refund usually retries it.
  const failedSettlements = await db
    .select({ id: bids.id, reason: bids.failReason })
    .from(bids)
    .where(and(inArray(bids.status, ["pending", "counter_offered"]), isNotNull(bids.failReason)));
  if (failedSettlements.length) {
    problems.push(
      `${failedSettlements.length} open bid(s) with a failed settlement waiting for a retry: ${failedSettlements
        .slice(0, 5)
        .map((b) => `${b.id}: ${(b.reason ?? "").slice(0, 80)}`)
        .join(" | ")}`,
    );
  }

  const rows = (await loadOpenRows()).filter((r) => new Date(r.createdAt) <= asOf);
  const verdicts = classifyOpenRows(rows, index);
  const phantoms = rows.filter((r) => verdicts.get(r.id)?.kind === "phantom");
  const relink = rows.filter((r) => verdicts.get(r.id)?.kind === "linked");
  if (phantoms.length) problems.push(`${phantoms.length} open bid row(s) have no bid on-chain: ${phantoms.map((r) => r.id).slice(0, 10).join(", ")}`);
  if (relink.length) problems.push(`${relink.length} open bid row(s) point at the wrong on-chain bid (run the reconcile job as a dry run)`);

  const key = (e: string, id: string) => `${e.toLowerCase()}:${id}`;
  const claimed = new Set<string>();
  for (const r of rows) {
    const v = verdicts.get(r.id);
    if (v?.kind === "ok" && r.escrowAddress && r.onChainBidId) claimed.add(key(r.escrowAddress, r.onChainBidId));
    if (v?.kind === "linked") claimed.add(key(v.escrow, v.onChainBidId));
  }
  // Owned elsewhere: bids with a settlement in flight (not in loadOpenRows) and bids
  // settled after the snapshot (Pending at the block, closed now).
  const owners = await db
    .select({ escrow: bids.escrowAddress, id: bids.onChainBidId })
    .from(bids)
    .where(
      and(
        isNotNull(bids.onChainBidId),
        or(inArray(bids.status, ["pending", "counter_offered", "placing"]), gt(bids.settledAt, asOf)),
      ),
    );
  for (const o of owners) if (o.escrow && o.id) claimed.add(key(o.escrow, o.id));
  // A bid escrowed just before the block whose row is still "placing" (finalize not run yet).
  const placing = await db
    .select({ bidder: bids.bidderAddress, creator: bids.creatorAddress, amount: bids.amountUsdc })
    .from(bids)
    .where(eq(bids.status, "placing"));
  const placingKeys = new Set(placing.map((p) => `${p.bidder.toLowerCase()}|${p.creator.toLowerCase()}|${p.amount}`));
  const orphanBidders = Object.entries(index)
    .filter(([, list]) => list.some((e) => e.status === 0 && !claimed.has(key(e.escrow, e.id))))
    .map(([bidder]) => bidder);
  const orphans = findOrphans(index, claimed, await loadClosedRows(orphanBidders));
  const unexplained = [
    ...orphans.reopen.map((o) => ({ escrow: o.escrow, id: o.onChainBidId })),
    ...orphans.unmatched.filter((u) => !placingKeys.has(`${u.bidder}|${u.creator}|${u.amountUsdc}`)).map((u) => ({ escrow: u.escrow, id: u.onChainBidId })),
  ];
  if (unexplained.length) {
    problems.push(
      `${unexplained.length} bid(s) are Pending on-chain with no open row, so nobody can reply and auto-refund won't claim them: ${unexplained
        .slice(0, 10)
        .map((u) => `#${u.id}`)
        .join(", ")} (run the reconcile job as a dry run, then apply)`,
    );
  }
  return { problems, notes };
}

/** Read sizes for the job's steps (each step reads at most this many bids). */
export const BIDS_PER_STEP = 200;

/** The whole full check in one call (tests, small escrows). The job splits it into steps. */
export async function fullHealthCheck(): Promise<HealthReport> {
  const snap = await snapshotBlock();
  const counts = await escrowBidCounts(snap);
  const all: ChainBid[] = [];
  for (const { escrow, count } of counts) {
    for (let from = 1; from <= count; from += BIDS_PER_STEP) all.push(...(await readEscrowBids(escrow, from, Math.min(count, from + BIDS_PER_STEP - 1), snap)));
  }
  return evaluateFullHealth(all, snap);
}

/** Housekeeping: rate-limit rows older than two days are no longer needed. */
export async function pruneRateLimits(): Promise<number> {
  const rows = await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(Date.now() - 2 * 24 * HOUR))).returning({ key: rateLimits.key });
  return rows.length;
}
