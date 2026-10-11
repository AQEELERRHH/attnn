/**
 * The money health check (docs/RUNBOOK.md). Read-only: it reports, it never repairs.
 *
 * Quick checks (every hour):
 *   - bids still "placing" after an hour (placement should take under 5 minutes)
 *   - settlements in flight for over an hour
 *   - settlements that failed and are waiting for a retry
 *   - creator registrations still confirming after an hour
 *   - the pause switch is on (a reminder, not a problem)
 *
 * Full check (once a day; reads every bid in the escrow from Arc):
 *   - the escrow holds at least the total of its bids that are still Pending on-chain
 *     (less would mean it can't pay everyone: stop and investigate)
 *   - every open bid in the database is a real Pending bid on-chain, and every
 *     Pending bid on-chain has an open row (so the creator can reply and the
 *     3-day auto-refund can claim it)
 */
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "./db/client";
import { bids, profiles } from "./db/schema";
import { publicClient, usdcAbi, USDC_ADDRESS } from "./arc";
import { escrowAddress } from "./chain";
import { formatUsd } from "./bid-rules";
import { bidsPaused } from "./app-settings";
import { classifyOpenRows, findOrphans, indexOnChainBids, loadClosedRows, loadOpenRows } from "./reconcile";

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
        lt(bids.settlementSubmittedAt, hourAgo),
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

  // Registering: sent to the registry, not confirmed yet, no error recorded. The sweep
  // confirms these within minutes, so any older than an hour are worth a look.
  const registering = await db
    .select({ handle: profiles.handle })
    .from(profiles)
    .where(
      and(eq(profiles.isActive, false), isNotNull(profiles.onChainTx), isNull(profiles.registrationError), lt(profiles.createdAt, hourAgo)),
    );
  if (registering.length) notes.push(`${registering.length} creator market(s) still registering on Arc: ${registering.map((p) => p.handle).slice(0, 10).join(", ")}`);

  if (await bidsPaused()) notes.push("New bids are PAUSED (app_settings.bids_paused = true).");

  return { problems, notes };
}

export async function fullHealthCheck(): Promise<HealthReport> {
  const problems: string[] = [];
  const notes: string[] = [];
  const escrow = escrowAddress();
  if (!escrow) return { problems: ["ATTN_ESCROW_CONTRACT is not set"], notes };

  const index = await indexOnChainBids();
  const pendingOnChain = Object.values(index)
    .flat()
    .filter((e) => e.status === 0 && e.escrow.toLowerCase() === escrow);
  const owed = pendingOnChain.reduce((s, e) => s + BigInt(e.amount), BigInt(0));
  const held = (await publicClient.readContract({
    address: USDC_ADDRESS as Hex,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [escrow as Hex],
  })) as bigint;
  if (held < owed) {
    problems.push(
      `ESCROW SHORTFALL: the escrow holds ${formatUsd(held)} but owes ${formatUsd(owed)} across ${pendingOnChain.length} pending bid(s). Pause new bids and investigate now.`,
    );
  } else {
    notes.push(`Escrow holds ${formatUsd(held)} for ${pendingOnChain.length} pending bid(s) totalling ${formatUsd(owed)}.`);
    if (held > owed) notes.push(`${formatUsd(held - owed)} more than owed (USDC sent straight to the contract; nobody can withdraw it).`);
  }

  const rows = await loadOpenRows();
  const verdicts = classifyOpenRows(rows, index);
  const phantoms = rows.filter((r) => verdicts.get(r.id)?.kind === "phantom");
  const relink = rows.filter((r) => verdicts.get(r.id)?.kind === "linked");
  if (phantoms.length) problems.push(`${phantoms.length} open bid row(s) have no bid on-chain: ${phantoms.map((r) => r.id).slice(0, 10).join(", ")}`);
  if (relink.length) problems.push(`${relink.length} open bid row(s) point at the wrong on-chain bid (run the reconcile job as a dry run)`);

  const claimed = new Set<string>();
  for (const r of rows) {
    const v = verdicts.get(r.id);
    if (v?.kind === "ok" && r.escrowAddress && r.onChainBidId) claimed.add(`${r.escrowAddress.toLowerCase()}:${r.onChainBidId}`);
    if (v?.kind === "linked") claimed.add(`${v.escrow.toLowerCase()}:${v.onChainBidId}`);
  }
  // Bids with a settlement in flight aren't in loadOpenRows; count them as owned.
  const settling = await db
    .select({ escrow: bids.escrowAddress, id: bids.onChainBidId })
    .from(bids)
    .where(and(inArray(bids.status, ["pending", "counter_offered", "placing"]), isNotNull(bids.onChainBidId)));
  for (const s of settling) if (s.escrow && s.id) claimed.add(`${s.escrow.toLowerCase()}:${s.id}`);
  const orphanBidders = Object.entries(index)
    .filter(([, list]) => list.some((e) => e.status === 0 && !claimed.has(`${e.escrow.toLowerCase()}:${e.id}`)))
    .map(([bidder]) => bidder);
  const orphans = findOrphans(index, claimed, await loadClosedRows(orphanBidders));
  const orphanCount = orphans.reopen.length + orphans.unmatched.length;
  if (orphanCount) {
    problems.push(
      `${orphanCount} bid(s) are Pending on-chain with no open row, so nobody can reply and auto-refund won't claim them (run the reconcile job as a dry run, then apply)`,
    );
  }
  return { problems, notes };
}
