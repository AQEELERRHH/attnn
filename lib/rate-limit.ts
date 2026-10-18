/**
 * Fixed-window rate limits stored in Postgres (rate_limits table, migration 0008).
 * Serverless functions share no memory, so counting has to happen in the database.
 * One upsert per check; a database error lets the request through (and logs), so an
 * outage of this table never blocks money moving that is otherwise allowed.
 */
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "./db/client";
import { rateLimits } from "./db/schema";

export interface RateLimit {
  /** What is being limited, e.g. "wallet-send". */
  name: string;
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

export const LIMITS = {
  walletSend: { name: "wallet-send", max: 10, windowMs: 60 * 60 * 1000 },
  // Emailed codes for new withdrawal addresses (on top of the 1-a-minute cooldown per address).
  withdrawalCode: { name: "withdrawal-code", max: 5, windowMs: 60 * 60 * 1000 },
  walletAgent: { name: "wallet-agent", max: 20, windowMs: 60 * 60 * 1000 },
  bidPlace: { name: "bid-place", max: 60, windowMs: 60 * 60 * 1000 },
  bidSettle: { name: "bid-settle", max: 120, windowMs: 60 * 60 * 1000 },
  agentRun: { name: "agent-run", max: 10, windowMs: 60 * 60 * 1000 },
  profileWrite: { name: "profile-write", max: 60, windowMs: 60 * 60 * 1000 },
  upload: { name: "upload", max: 20, windowMs: 60 * 60 * 1000 },
  // Card-checkout sessions (Onramp Kit): each one costs a Circle API call.
  onrampSession: { name: "onramp-session", max: 30, windowMs: 60 * 60 * 1000 },
  // Per address: one link a minute. A cooldown, not a daily cap, so nobody can lock
  // someone else out by requesting links for their address (those links go to the owner).
  signInEmail: { name: "sign-in-email", max: 1, windowMs: 60 * 1000 },
  // Per requesting IP: stops one client flooding many inboxes.
  signInIp: { name: "sign-in-ip", max: 20, windowMs: 60 * 60 * 1000 },
} satisfies Record<string, RateLimit>;

/** Counts one request for `subject` (a user id, an email, an IP). True = allowed. */
export async function hit(limit: RateLimit, subject: string): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / limit.windowMs) * limit.windowMs);
  const key = `${limit.name}:${subject}`;
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.windowStart} = excluded.window_start then ${rateLimits.count} + 1 else 1 end`,
          windowStart: sql`excluded.window_start`,
        },
      })
      .returning({ count: rateLimits.count });
    return (row?.count ?? 1) <= limit.max;
  } catch (err) {
    console.error(`rate-limit: ${limit.name} check failed, allowing`, err);
    return true;
  }
}

/** A 429 response, or null when the request is within the limit. */
export async function limitOrNull(limit: RateLimit, subject: string): Promise<NextResponse | null> {
  if (await hit(limit, subject)) return null;
  return NextResponse.json({ error: "Too many requests. Please wait a little and try again." }, { status: 429 });
}
