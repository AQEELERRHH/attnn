/**
 * One bidder-agent action per user at a time.
 *
 * The daily budget is checked by reading what was spent today and then creating a
 * bid. Two runs at once (the 30-minute cron, "Run now", a double click, a counter
 * re-bid) could each read the same total and both spend the full budget. Holding
 * this lease around every agent spend makes the read-then-bid safe.
 *
 * It's a lease, not a lock: it expires on its own, so a crashed run can't block
 * the agent forever.
 */
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "./db/client";
import { bidderConfigs } from "./db/schema";

/** Longer than any agent run (≤ 10 AI scorings plus a few bid inserts). */
export const AGENT_LEASE_MS = 10 * 60 * 1000;

/** Takes the lease. Returns a token to release it with, or null if another run holds it. */
export async function acquireAgentLease(userId: string, ms = AGENT_LEASE_MS): Promise<Date | null> {
  const now = new Date();
  const until = new Date(now.getTime() + ms);
  const rows = await db
    .update(bidderConfigs)
    .set({ runLeaseUntil: until })
    .where(
      and(
        eq(bidderConfigs.userId, userId),
        or(isNull(bidderConfigs.runLeaseUntil), lt(bidderConfigs.runLeaseUntil, now)),
      ),
    )
    .returning({ id: bidderConfigs.id });
  return rows.length ? until : null;
}

/**
 * Extends a lease this caller still holds and returns the new token, or null if it
 * was lost (it expired and another run took it). Call before every spend.
 */
export async function renewAgentLease(userId: string, token: Date, ms = AGENT_LEASE_MS): Promise<Date | null> {
  const until = new Date(Date.now() + ms);
  const rows = await db
    .update(bidderConfigs)
    .set({ runLeaseUntil: until })
    .where(and(eq(bidderConfigs.userId, userId), eq(bidderConfigs.runLeaseUntil, token)))
    .returning({ id: bidderConfigs.id });
  return rows.length ? until : null;
}

/** Releases a lease this caller holds (a later holder's lease is left alone). */
export async function releaseAgentLease(userId: string, token: Date): Promise<void> {
  await db
    .update(bidderConfigs)
    .set({ runLeaseUntil: null })
    .where(and(eq(bidderConfigs.userId, userId), eq(bidderConfigs.runLeaseUntil, token)));
}
