/**
 * Consistent bidder scores (stage 2): the AI is asked at temperature 0 with a fixed
 * rubric and never sees the creator's floor; the same model, prompt, goal and profile
 * reuse the earlier score (from the user's own decision records) instead of asking again;
 * any change to the goal or profile, or an old enough score, asks again; a failed AI call
 * is never cached.
 *
 * Both creators score below the minimum here, so no bid is placed and the next run
 * reconsiders them (a creator already bid on today isn't rediscovered).
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world } from "../helpers/fakes.mts";
import { closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";

await installFakes();

// ── Fake AI: records every request; score per handle; can be made to fail ──
const ai = {
  scores: new Map<string, { score: number; proceed?: boolean; reason?: string }>(),
  requests: [] as { body: Record<string, unknown>; system: string; user: string; handle: string }[],
  fail: false,
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("http://127.0.0.1:9")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] } & Record<string, unknown>;
  const system = body.messages.find((m) => m.role === "system")?.content ?? "";
  const user = body.messages.find((m) => m.role === "user")?.content ?? "";
  const handle = /"handle":"([^"]+)"/.exec(user)?.[1] ?? "";
  ai.requests.push({ body, system, user, handle });
  if (ai.fail) return new Response("upstream down", { status: 503 });
  const a = ai.scores.get(handle) ?? { score: 2 };
  const answer = { score: a.score, proceed: a.proceed ?? true, reason: a.reason ?? `fit ${a.score}` };
  return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { db } = await import("../../lib/db/client.ts");
const { agentLogs, bidderConfigs, bids, profiles } = await import("../../lib/db/schema.ts");
const { eq, sql } = await import("drizzle-orm");
const { runBidderAgent } = await import("../../lib/agent.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const { clearRegistryFeatureCache } = await import("../../lib/registration.ts");

type Rec = { creator: string; decision: string; reason: string; score?: number; aiReason?: string; flagged?: boolean; scoreSource?: string; scoredAt?: string; scoreKey?: string; model?: string; promptVersion?: string };
const runRecords = async () => {
  const rows = await db.select().from(agentLogs).where(eq(agentLogs.action, "creator_scored")).orderBy(agentLogs.createdAt);
  return rows.map((l) => l.data as Rec);
};
const latestFor = async (handle: string) => (await runRecords()).filter((r) => r.creator === handle).at(-1)!;
const asked = (handle: string) => ai.requests.filter((r) => r.handle === handle).length;

describe("consistent bidder scores", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    clearRegistryFeatureCache();
    await truncateAll();
    await seedMarket({ creatorMinBid: "20000000", agentUsdc: BigInt(100_000_000) });
    await db
      .update(bidderConfigs)
      .set({ minFitScore: 9, maxBidPerCreator: "50000000", goal: "find Solidity developers" })
      .where(eq(bidderConfigs.userId, ids.bidder));
    await db.update(profiles).set({ bio: "I build Solidity tooling and audit contracts" }).where(eq(profiles.userId, ids.creator));
    ai.scores.clear();
    ai.requests.length = 0;
    ai.fail = false;
    ai.scores.set("amina", { score: 6, reason: "Builds Solidity tooling" });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await closeDb();
  });

  test("the AI is asked at temperature 0, with the rubric, and never sees the floor", async () => {
    await runBidderAgent(ids.bidder);
    const req = ai.requests.find((r) => r.handle === "amina")!;
    assert.equal(req.body.temperature, 0);
    assert.match(req.system, /Scoring guide/);
    assert.match(req.system, /9-10/);
    assert.doesNotMatch(req.user, /minBid|20000000|floor/i, "no price in what the AI sees");
    assert.match(req.user, /I build Solidity tooling/);
  });

  test("a second run with nothing changed reuses the score instead of asking again", async () => {
    await runBidderAgent(ids.bidder);
    const first = await latestFor("amina");
    assert.equal(first.score, 6);
    assert.equal(first.scoreSource, "ai");
    assert.ok(first.scoreKey && first.scoredAt && first.model && first.promptVersion);

    // Even if the AI would now answer differently, the score stays the same.
    ai.scores.set("amina", { score: 3 });
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 1, "asked once in two runs");
    const second = await latestFor("amina");
    assert.equal(second.score, 6);
    assert.equal(second.aiReason, "Builds Solidity tooling");
    assert.equal(second.scoreSource, "cache");
    assert.equal(second.scoredAt, first.scoredAt, "points back to when the AI made it");
    assert.equal(second.scoreKey, first.scoreKey);
    assert.equal(second.decision, "SKIPPED");
    assert.equal(second.reason, "Score 6/10 is below your minimum of 9/10", "rules still decide, on the reused score");
  });

  test("a new goal asks again", async () => {
    await runBidderAgent(ids.bidder);
    await db.update(bidderConfigs).set({ goal: "find designers" }).where(eq(bidderConfigs.userId, ids.bidder));
    ai.scores.set("amina", { score: 1 });
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2);
    assert.equal((await latestFor("amina")).score, 1);
    assert.equal((await latestFor("amina")).scoreSource, "ai");
  });

  test("an edited bio asks again; a changed floor doesn't", async () => {
    await runBidderAgent(ids.bidder);
    await db.update(profiles).set({ minBid: "25000000" }).where(eq(profiles.userId, ids.creator));
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 1, "price is not part of the score");

    await db.update(profiles).set({ bio: "I paint landscapes" }).where(eq(profiles.userId, ids.creator));
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2, "new bio, fresh score");
  });

  test("a score older than 7 days is asked again", async () => {
    await runBidderAgent(ids.bidder);
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    await db.execute(sql`update agent_logs set data = jsonb_set(data, '{scoredAt}', to_jsonb(${old}::text)) where action = 'creator_scored'`);
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2);
  });

  test("a failed AI call is never cached: the next run asks again", async () => {
    ai.fail = true;
    await runBidderAgent(ids.bidder);
    const failed = await latestFor("amina");
    assert.equal(failed.decision, "SKIPPED");
    assert.equal(failed.score, undefined);
    ai.fail = false;
    await runBidderAgent(ids.bidder);
    assert.equal((await latestFor("amina")).score, 6);
    assert.equal((await latestFor("amina")).scoreSource, "ai");
  });

  test("a reused red flag still stops the bid", async () => {
    await db.update(bidderConfigs).set({ minFitScore: 4 }).where(eq(bidderConfigs.userId, ids.bidder));
    ai.scores.set("amina", { score: 8, proceed: false, reason: "impersonation account" });
    await runBidderAgent(ids.bidder);
    ai.scores.set("amina", { score: 8, proceed: true });
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 1);
    const rec = await latestFor("amina");
    assert.equal(rec.flagged, true);
    assert.equal(rec.decision, "SKIPPED");
    assert.match(rec.reason, /flagged this creator as unsuitable/);
    assert.equal((await db.select().from(bids)).length, 0);
  });

  // ── Clarifications: score 0, red-flag lifetime, price vs profile ──

  /** Moves every recorded score's "made at" time back by `days`. */
  const ageScores = async (days: number) => {
    const at = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    await db.execute(sql`update agent_logs set data = jsonb_set(data, '{scoredAt}', to_jsonb(${at}::text)) where action = 'creator_scored' and data ? 'scoredAt'`);
  };

  test("a score of 0 is reused like any other", async () => {
    ai.scores.set("amina", { score: 0, reason: "nothing to do with the goal" });
    await runBidderAgent(ids.bidder);
    ai.scores.set("amina", { score: 8 });
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 1);
    const rec = await latestFor("amina");
    assert.equal(rec.score, 0);
    assert.equal(rec.scoreSource, "cache");
  });

  test("the newest valid score wins: after expiry the fresh score (even 0) replaces the old one", async () => {
    ai.scores.set("amina", { score: 5 });
    await runBidderAgent(ids.bidder);
    await ageScores(8); // the 5 has expired
    ai.scores.set("amina", { score: 0 });
    await runBidderAgent(ids.bidder); // fresh 0
    ai.scores.set("amina", { score: 9 });
    await runBidderAgent(ids.bidder); // reuses the 0, not the expired 5, and doesn't ask
    assert.equal(asked("amina"), 2);
    assert.equal((await latestFor("amina")).score, 0);
  });

  test("a red flag stays for the whole 7 days, then is asked again", async () => {
    await db.update(bidderConfigs).set({ minFitScore: 4 }).where(eq(bidderConfigs.userId, ids.bidder));
    ai.scores.set("amina", { score: 8, proceed: false, reason: "looks like impersonation" });
    await runBidderAgent(ids.bidder);
    ai.scores.set("amina", { score: 8, proceed: true }); // the AI would now say it's fine

    await ageScores(6.9);
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 1, "day 6.9: still the flagged score");
    assert.equal((await latestFor("amina")).flagged, true);
    assert.equal((await db.select().from(bids)).length, 0);

    await ageScores(7.1);
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2, "after 7 days: asked again");
    assert.equal((await latestFor("amina")).flagged, false);
    assert.equal((await latestFor("amina")).decision, "BID_QUEUED");
  });

  test("a red flag is cleared sooner when the creator edits their profile (a goal change too: see 'a new goal asks again')", async () => {
    await db.update(bidderConfigs).set({ minFitScore: 4 }).where(eq(bidderConfigs.userId, ids.bidder));
    ai.scores.set("amina", { score: 8, proceed: false });
    await runBidderAgent(ids.bidder);
    ai.scores.set("amina", { score: 8, proceed: true });
    await db.update(profiles).set({ bio: "I build Solidity tooling. Verified on X." }).where(eq(profiles.userId, ids.creator));
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2);
    assert.equal((await latestFor("amina")).decision, "BID_QUEUED");
  });

  test("price alone never changes the score; topics do (order and case don't)", async () => {
    await runBidderAgent(ids.bidder);
    const first = await latestFor("amina");

    // Floor up, then down: same key, same score, no new AI call.
    for (const floor of ["30000000", "5000000"]) {
      await db.update(profiles).set({ minBid: floor }).where(eq(profiles.userId, ids.creator));
      await runBidderAgent(ids.bidder);
      const rec = await latestFor("amina");
      assert.equal(rec.scoreKey, first.scoreKey);
      assert.equal(rec.score, first.score);
    }
    assert.equal(asked("amina"), 1);

    // New topic: fresh score.
    await db.update(profiles).set({ tags: ["ai", "solidity"] }).where(eq(profiles.userId, ids.creator));
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2, "new tag set, fresh score");
    const withTags = await latestFor("amina");
    assert.notEqual(withTags.scoreKey, first.scoreKey);

    // Same topics reordered / different case: same key, no new call.
    await db.update(profiles).set({ tags: ["Solidity", "ai"] }).where(eq(profiles.userId, ids.creator));
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2);
    assert.equal((await latestFor("amina")).scoreKey, withTags.scoreKey);
  });

  test("scores are whole numbers", async () => {
    ai.scores.set("amina", { score: 6.6 });
    await runBidderAgent(ids.bidder);
    assert.equal((await latestFor("amina")).score, 7);
  });
});
