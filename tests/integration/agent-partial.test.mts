/**
 * A bidder run that stops on an unexpected error part-way through still reports what it
 * actually did: a bid intent already queued is counted (and kept), every creator keeps
 * its decision record, and creators the run never reached say why. Nothing is retried,
 * so no second bid intent can come from the error.
 *
 * The lease module is replaced with a stand-in whose renew can be told to throw on its
 * Nth call: renew runs right before every bid, so that is "a later step throws".
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

const lease = { renewCalls: 0, throwOnRenew: 0 };
mock.module(pathToFileURL(path.resolve("lib/agent-lease.ts")).href, {
  namedExports: {
    AGENT_LEASE_MS: 10 * 60 * 1000,
    acquireAgentLease: async () => new Date(Date.now() + 600_000),
    renewAgentLease: async () => {
      lease.renewCalls++;
      if (lease.renewCalls === lease.throwOnRenew) throw new Error("database connection reset");
      return new Date(Date.now() + 600_000);
    },
    releaseAgentLease: async () => {},
  },
});

// Fake AI: score per creator handle.
const scores = new Map<string, number>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("http://127.0.0.1:9")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
  const user = body.messages.find((m) => m.role === "user")?.content ?? "";
  const handle = /"handle":"([^"]+)"/.exec(user)?.[1] ?? "";
  const answer = { score: scores.get(handle) ?? 5, proceed: true, reason: "fit" };
  return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { db } = await import("../../lib/db/client.ts");
const { agentLogs, bidderConfigs, bids, profiles, users, wallets } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { runBidderAgent } = await import("../../lib/agent.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const { clearRegistryFeatureCache } = await import("../../lib/registration.ts");

const CHEAP = { id: "00000000-0000-0000-0000-0000000000e1", handle: "cheapdev", wallet: "0xe100000000000000000000000000000000000001" };

type Rec = { creator: string; decision: string; reason: string; bidId?: string };
const records = async () => (await db.select().from(agentLogs).where(eq(agentLogs.action, "creator_scored"))).map((l) => l.data as Rec);
const decisionOf = async (handle: string) => (await records()).find((r) => r.creator === handle)!;
const logsOf = async (action: "error" | "creator_discovered") =>
  (await db.select().from(agentLogs).where(eq(agentLogs.action, action))).map((l) => l.data as Record<string, unknown>);

describe("bidder run stopped by an unexpected error", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    clearRegistryFeatureCache();
    await truncateAll();
    lease.renewCalls = 0;
    lease.throwOnRenew = 0;
    // Two qualified, affordable creators: amina ($20, scores 7) is tried first, then cheapdev ($5, scores 6).
    await seedMarket({ creatorMinBid: "20000000", agentUsdc: BigInt(100_000_000) });
    await db
      .update(bidderConfigs)
      .set({ maxBidPerCreator: "50000000", minFitScore: 4, dailyBudget: "100000000" })
      .where(eq(bidderConfigs.userId, ids.bidder));
    await db.insert(users).values({ id: CHEAP.id, email: "cheapdev@test", role: "creator" });
    await db.insert(wallets).values({ userId: CHEAP.id, circleWalletId: "w-cheapdev", address: CHEAP.wallet, blockchain: "ARC-TESTNET", state: "active", purpose: "main" });
    await db.insert(profiles).values({ userId: CHEAP.id, handle: CHEAP.handle, minBid: "5000000", tags: ["ai"], isActive: true });
    world.activeCreators.add(CHEAP.wallet);
    world.usdc.set(CHEAP.wallet, BigInt(0));
    scores.clear();
    scores.set("amina", 7);
    scores.set("cheapdev", 6);
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await closeDb();
  });

  test("control: with no error both bids are queued", async () => {
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 2, JSON.stringify(result.errors));
  });

  test("first bid queued, then a later step throws: the queued bid is counted and kept", async () => {
    lease.throwOnRenew = 2; // the lease renewal before the SECOND bid fails
    const result = await runBidderAgent(ids.bidder);

    assert.equal(result.bidsPlaced, 1, "the bid intent queued before the error is reported");
    assert.equal(result.creatorsFound, 2);
    assert.ok(result.errors.some((e) => /Agent run failed: database connection reset/.test(e)), JSON.stringify(result.errors));

    const rows = await db.select().from(bids);
    assert.equal(rows.length, 1, "exactly one bid intent: nothing lost, nothing duplicated");
    assert.equal(rows[0]!.creatorUserId, ids.creator);
    assert.equal(rows[0]!.status, "placing", "queued, not escrowed: the placeBid job escrows it later");
    assert.equal(rows[0]!.onChainBidId, null);
    assert.equal(world.calls("placeBid").length, 0, "the run itself never touched the chain");

    const amina = await decisionOf("amina");
    assert.equal(amina.decision, "BID_QUEUED");
    assert.equal(amina.bidId, rows[0]!.id);
    assert.match(amina.reason, /not confirmed yet/);
    const cheap = await decisionOf("cheapdev");
    assert.equal(cheap.decision, "NOT_REACHED");
    assert.equal(cheap.reason, "The run stopped on an error before reaching this creator: database connection reset");
    assert.equal((await records()).length, 2, "one decision record per creator");

    const [summary] = await logsOf("creator_discovered");
    assert.deepEqual(
      { found: summary!.count, evaluated: summary!.evaluated, qualified: summary!.qualified, attempted: summary!.attempted, queued: summary!.queued, stoppedEarly: summary!.stoppedEarly },
      { found: 2, evaluated: 2, qualified: 2, attempted: 1, queued: 1, stoppedEarly: true },
    );
    const [error] = await logsOf("error");
    assert.match(String(error!.error), /after queuing 1 bid: database connection reset/);
  });

  test("an error before any bid is queued: counts stay at zero, nothing recorded as a bid", async () => {
    lease.throwOnRenew = 1; // fails before the FIRST bid
    const result = await runBidderAgent(ids.bidder);

    assert.equal(result.bidsPlaced, 0);
    assert.equal(result.creatorsFound, 2, "the creators it did find are still reported");
    assert.ok(result.errors.some((e) => /Agent run failed/.test(e)));
    assert.equal((await db.select().from(bids)).length, 0, "no bid intent");

    for (const handle of ["amina", "cheapdev"]) {
      const rec = await decisionOf(handle);
      assert.equal(rec.decision, "NOT_REACHED");
      assert.match(rec.reason, /The run stopped on an error before reaching this creator/);
    }
    const [summary] = await logsOf("creator_discovered");
    assert.equal(summary!.queued, 0);
    assert.equal(summary!.attempted, 0);
    const [error] = await logsOf("error");
    assert.match(String(error!.error), /after queuing 0 bids/);
  });

  test("the run never throws to its caller, so an Inngest step doesn't retry it into a second bid", async () => {
    lease.throwOnRenew = 2;
    await assert.doesNotReject(runBidderAgent(ids.bidder));
    // A second run (the next cron tick) skips the creator it already bid on today.
    lease.renewCalls = 0;
    lease.throwOnRenew = 0;
    await runBidderAgent(ids.bidder);
    const rows = await db.select().from(bids).where(eq(bids.creatorUserId, ids.creator));
    assert.equal(rows.length, 1, "amina still has exactly one bid");
  });
});
