/**
 * Decision History (stage 3):
 *   - every log row one bidder run writes carries the same runId, so the screen shows a
 *     run as one group; separate runs never mix;
 *   - "Ask again" (POST /api/agent/rescore) retires the earlier score for one creator, so
 *     the next run asks the AI again; nothing is erased, no bid is placed by it, only the
 *     signed-in user's own scores are touched, and the fresh score still goes through the
 *     same rules.
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installFakes, world } from "../helpers/fakes.mts";
import { closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";

await installFakes();

const session = { userId: ids.bidder as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: {
    auth: async () => (session.userId ? { user: { id: session.userId, role: "bidder", email: "t@test" } } : null),
  },
});

// Fake AI: score / red flag per creator handle; counts calls.
const ai = { scores: new Map<string, { score: number; proceed?: boolean }>(), asked: [] as string[] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("http://127.0.0.1:9")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
  const user = body.messages.find((m) => m.role === "user")?.content ?? "";
  const handle = /"handle":"([^"]+)"/.exec(user)?.[1] ?? "";
  ai.asked.push(handle);
  const a = ai.scores.get(handle) ?? { score: 2 };
  const answer = { score: a.score, proceed: a.proceed ?? true, reason: `fit ${a.score}` };
  return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { db } = await import("../../lib/db/client.ts");
const { agentLogs, bidderConfigs, bids } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { NextRequest } = await import("next/server");
const { runBidderAgent } = await import("../../lib/agent.ts");
const { groupRuns } = await import("../../lib/decision-history.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const { clearRegistryFeatureCache } = await import("../../lib/registration.ts");
const rescoreRoute = await import("../../app/api/agent/rescore/route.ts");

const askAgain = (creator: unknown, headers: Record<string, string> = {}) =>
  rescoreRoute.POST(
    new NextRequest("http://localhost:3000/api/agent/rescore", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...headers },
      body: JSON.stringify({ creator }),
    }),
  );

const allRows = async () =>
  (await db.select().from(agentLogs).orderBy(agentLogs.createdAt)).map((r) => ({ id: r.id, action: r.action, data: r.data as Record<string, unknown>, createdAt: r.createdAt.toISOString(), userId: r.userId }));
const asked = (h: string) => ai.asked.filter((x) => x === h).length;

describe("decision history", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    clearRegistryFeatureCache();
    await truncateAll();
    session.userId = ids.bidder;
    await seedMarket({ creatorMinBid: "20000000", agentUsdc: BigInt(100_000_000) });
    // amina scores below the minimum, so no bid and the next run reconsiders her.
    await db.update(bidderConfigs).set({ minFitScore: 9, maxBidPerCreator: "50000000", goal: "find Solidity developers" }).where(eq(bidderConfigs.userId, ids.bidder));
    ai.scores.clear();
    ai.asked.length = 0;
    ai.scores.set("amina", { score: 6 });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await closeDb();
  });

  test("every row a run writes shares one runId; two runs are two groups", async () => {
    await runBidderAgent(ids.bidder);
    await runBidderAgent(ids.bidder);
    const rows = (await allRows()).filter((r) => r.action === "creator_scored" || r.action === "creator_discovered");
    const runIds = new Set(rows.map((r) => r.data.runId));
    assert.equal(runIds.size, 2, "two runs");
    assert.ok([...runIds].every((id) => typeof id === "string" && id.length > 0));

    const runs = groupRuns(rows);
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.equal(run.summary?.found, 1);
      assert.deepEqual(run.decisions.map((d) => [d.creator, d.decision, d.score]), [["amina", "SKIPPED", 6]]);
    }
    assert.equal(runs[0]!.decisions[0]!.scoreSource, "cache", "newest run reused the score");
    assert.equal(runs[0]!.decisions[0]!.canAskAgain, true, "Ask again on the newest score only");
    assert.equal(runs[1]!.decisions[0]!.canAskAgain, false);
  });

  test("Ask again: the next run asks the AI for a fresh score; nothing is erased", async () => {
    await runBidderAgent(ids.bidder);
    const before = (await allRows()).find((r) => r.action === "creator_scored")!;

    const res = await askAgain("@amina");
    assert.equal(res.status, 200);
    assert.equal((await db.select().from(bids)).length, 0, "asking again places no bid");

    const kept = (await allRows()).find((r) => r.id === before.id)!;
    assert.equal(kept.data.score, 6, "the earlier score and reason are kept");
    assert.equal(kept.data.aiReason, before.data.aiReason);
    assert.equal(typeof kept.data.rescoreRequestedAt, "string", "only annotated");
    assert.equal(groupRuns([kept]).at(0)!.decisions[0]!.freshScoreRequested, true);

    ai.scores.set("amina", { score: 4 });
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2, "asked the AI again");
    const fresh = (await allRows()).filter((r) => r.action === "creator_scored").at(-1)!;
    assert.equal(fresh.data.score, 4);
    assert.equal(fresh.data.scoreSource, "ai");

    // The fresh score is reused from then on, like any other.
    await runBidderAgent(ids.bidder);
    assert.equal(asked("amina"), 2);
  });

  test("Ask again clears a red flag only if the AI now agrees, and the rules still decide", async () => {
    await db.update(bidderConfigs).set({ minFitScore: 4 }).where(eq(bidderConfigs.userId, ids.bidder));
    ai.scores.set("amina", { score: 8, proceed: false });
    await runBidderAgent(ids.bidder);
    await askAgain("amina");
    await runBidderAgent(ids.bidder); // the AI still flags her
    assert.equal((await db.select().from(bids)).length, 0, "still flagged: no bid");

    ai.scores.set("amina", { score: 8, proceed: true });
    await askAgain("amina");
    await runBidderAgent(ids.bidder);
    const placed = await db.select().from(bids);
    assert.equal(placed.length, 1, "now unflagged and over the minimum: bid queued");
    assert.equal(placed[0]!.amountUsdc, "20000000", "at her floor, as always");
    assert.equal(placed[0]!.status, "placing");
  });

  test("a second Ask again before the next run is a 404 (a fresh score is already on its way)", async () => {
    await runBidderAgent(ids.bidder);
    assert.equal((await askAgain("amina")).status, 200);
    assert.equal((await askAgain("amina")).status, 404);
  });

  test("only the signed-in user's own scores are touched", async () => {
    await runBidderAgent(ids.bidder);
    session.userId = ids.other;
    assert.equal((await askAgain("amina")).status, 404, "the other user has no score for amina");
    const row = (await allRows()).find((r) => r.action === "creator_scored")!;
    assert.equal(row.data.rescoreRequestedAt, undefined, "the bidder's score is untouched");
  });

  test("refused: signed out, cross-site, or no creator named", async () => {
    await runBidderAgent(ids.bidder);
    assert.equal((await askAgain("amina", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await askAgain("")).status, 400);
    assert.equal((await askAgain({ handle: "amina" })).status, 400);
    session.userId = null;
    assert.equal((await askAgain("amina")).status, 401);
    const row = (await allRows()).find((r) => r.action === "creator_scored")!;
    assert.equal(row.data.rescoreRequestedAt, undefined);
  });
});
