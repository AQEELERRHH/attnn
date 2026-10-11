/**
 * Operational switches stored in app_settings (migration 0008), flipped in the
 * Supabase SQL editor without a redeploy. See docs/RUNBOOK.md.
 *
 *   bids_paused = true  → no new bids (manual, agent, counter re-bids) and no agent runs.
 *                         Replies, declines and refunds keep working, so no money is trapped.
 *
 * Cached for 15 seconds per server instance so a busy route doesn't query on every call.
 * If the setting can't be read, new bids are refused: refusing a bid is always safe
 * (no USDC moves), accepting one during an unknown problem isn't.
 */
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { appSettings } from "./db/schema";

const TTL_MS = 15_000;
let cache: { at: number; paused: boolean } | null = null;

export async function bidsPaused(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.paused;
  try {
    const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, "bids_paused") });
    const paused = row?.value === true;
    cache = { at: Date.now(), paused };
    return paused;
  } catch (err) {
    console.error("app-settings: could not read bids_paused; refusing new bids to be safe", err);
    return true;
  }
}

export const PAUSED_MESSAGE = "New bids are paused for maintenance. Replies and refunds still work. Please try again soon.";
