/**
 * Bidder agent decisions (stage 1): an unaffordable creator is skipped, not the end of
 * the run; every creator gets a decision record (BID / SKIPPED / BLOCKED / FAILED /
 * NOT_REACHED) with the reason; the AI only recommends (its red flag can stop a bid,
 * never start one); budget, wallet, self and duplicate rules still hold.
 *
 * Testnet minimum bid here is $5, so the scenario uses a $20 creator (too expensive for
 * a $10 agent wallet) next to a $5 one, mirroring production's $5 vs $1.
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";

await installFakes();

// ── Fake AI: score and red flag per creator handle ──
const ai = { scores: new Map<string, { score: number; proceed: boolean; reason?: string }>() };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("http://127.0.0.1:9")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
  const user = body.messages.find((m) => m.role === "user")?.content ?? "";
  const handle = /"handle":"([^"]+)"/.exec(user)?.[1] ?? "";
  const a = ai.scores.get(handle) ?? { score: 5, proceed: true };
  const answer = { score: a.score, proceed: a.proceed, reason: a.reason ?? `fit ${a.score}` };
  return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { db } = await import("../../lib/db/client.ts");
const { agentLogs, bidderConfigs, bids, profiles, users, wallets } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { runBidderAgent, spentToday } = await import("../../lib/agent.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const { clearRegistryFeatureCache } = await import("../../lib/registration.ts");

const CHEAP = { id: "00000000-0000-0000-0000-0000000000e1", handle: "cheapdev", wallet: "0xe100000000000000000000000000000000000001" };

async function addCreator(c: typeof CHEAP, floor: string, tags = ["ai"]) {
  await db.insert(users).values({ id: c.id, email: `${c.handle}@test`, role: "creator" });
  await db.insert(wallets).values({ userId: c.id, circleWalletId: `w-${c.handle}`, address: c.wallet, blockchain: "ARC-TESTNET", state: "active", purpose: "main" });
  await db.insert(profiles).values({ userId: c.id, handle: c.handle, minBid: floor, tags, isActive: true });
  world.activeCreators.add(c.wallet);
  world.usdc.set(c.wallet, BigInt(0));
}

type Rec = { creator: string; decision: string; reason: string; score?: number; aiReason?: string; flagged?: boolean; spendable?: string; budgetLeft?: string };
const records = async () =>
  (await db.select().from(agentLogs).where(eq(agentLogs.action, "creator_scored"))).map((l) => l.data as Rec);
const decisionOf = async (handle: string) => (await records()).find((r) => r.creator === handle)!;
const summary = async () =>
  (await db.select().from(agentLogs).where(eq(agentLogs.action, "creator_discovered"))).map((l) => l.data as Record<string, unknown>)[0]!;

describe("bidder agent decisions", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    clearRegistryFeatureCache();
    await truncateAll();
    // amina: $20 floor, scores highest. cheapdev: $5 floor, lower score. Agent wallet: $10.
    await seedMarket({ creatorMinBid: "20000000", agentUsdc: BigInt(10_000_000) });
    await db.update(bidderConfigs).set({ maxBidPerCreator: "50000000", minFitScore: 4 }).where(eq(bidderConfigs.userId, ids.bidder));
    await addCreator(CHEAP, "5000000");
    ai.scores.clear();
    ai.scores.set("amina", { score: 7, proceed: true });
    ai.scores.set("cheapdev", { score: 6, proceed: true });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await closeDb();
  });

  test("an unaffordable creator is BLOCKED and the run goes on to bid the eligible cheaper one", async () => {
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 1, JSON.stringify(result.errors));
    const placed = await db.select().from(bids);
    assert.equal(placed.length, 1);
    assert.equal(placed[0]!.creatorUserId, CHEAP.id);
    assert.equal(placed[0]!.amountUsdc, "5000000", "the creator's floor");

    const amina = await decisionOf("amina");
    assert.equal(amina.decision, "BLOCKED");
    assert.match(amina.reason, /Floor \$20\.00 plus network fees is more than the \$10\.00 your agent wallet can spend/);
    assert.equal((await decisionOf("cheapdev")).decision, "BID");
    assert.equal(world.calls("approve").length + world.calls("placeBid").length, 0, "the agent itself never touches the chain");
  });

  test("the run summary counts each stage separately", async () => {
    await runBidderAgent(ids.bidder);
    const s = await summary();
    assert.deepEqual(
      { found: s.count, evaluated: s.evaluated, qualified: s.qualified, attempted: s.attempted, queued: s.queued },
      { found: 2, evaluated: 2, qualified: 2, attempted: 1, queued: 1 },
    );
  });

  test("below the saved minimum score: SKIPPED, even if it's the only affordable one", async () => {
    ai.scores.set("cheapdev", { score: 3, proceed: true });
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 0);
    const cheap = await decisionOf("cheapdev");
    assert.equal(cheap.decision, "SKIPPED");
    assert.equal(cheap.reason, "Score 3/10 is below your minimum of 4/10");
    assert.equal(cheap.score, 3);
  });

  test("the AI's red flag can stop a bid but never start one", async () => {
    ai.scores.set("cheapdev", { score: 9, proceed: false, reason: "looks like an impersonation account" });
    ai.scores.set("amina", { score: 2, proceed: true });
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 0);
    const cheap = await decisionOf("cheapdev");
    assert.equal(cheap.decision, "SKIPPED");
    assert.match(cheap.reason, /flagged this creator as unsuitable: looks like an impersonation account/);
    assert.equal(cheap.flagged, true);
    assert.equal((await decisionOf("amina")).decision, "SKIPPED", "a 'yes' from the AI doesn't override the minimum score");
  });

  test("the AI's reason is recorded with every score", async () => {
    ai.scores.set("cheapdev", { score: 6, proceed: true, reason: "Builds Solidity tooling" });
    await runBidderAgent(ids.bidder);
    assert.equal((await decisionOf("cheapdev")).aiReason, "Builds Solidity tooling");
  });

  test("daily budget: a bid that doesn't fit what's left is BLOCKED with the amount left", async () => {
    await db.update(bidderConfigs).set({ dailyBudget: "6000000" }).where(eq(bidderConfigs.userId, ids.bidder));
    world.usdc.set(addr.bidderAgent, BigInt(100_000_000)); // plenty in the wallet
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 1, "the $5 creator fits the $6 budget");
    const amina = await decisionOf("amina");
    assert.equal(amina.decision, "BLOCKED");
    assert.match(amina.reason, /Floor \$20\.00 is more than the \$6\.00 left in today's budget/);
  });

  test("bids still being placed from the wallet count as already committed", async () => {
    // A $6 re-bid from the agent wallet is still placing: only $4 of the $10 is free.
    await db.insert(bids).values({
      bidderUserId: ids.bidder,
      creatorUserId: ids.other,
      bidderAddress: addr.bidderAgent,
      creatorAddress: "0xd100000000000000000000000000000000000001",
      amountUsdc: "6000000",
      status: "placing",
      createdAt: new Date(Date.now() - 25 * 3600 * 1000), // yesterday: doesn't touch today's budget
    });
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 0);
    const cheap = await decisionOf("cheapdev");
    assert.equal(cheap.decision, "BLOCKED");
    assert.match(cheap.reason, /more than the \$4\.00 your agent wallet can spend/);
  });

  test("a refused bid is FAILED, doesn't count as spend, and the run carries on", async () => {
    world.usdc.set(addr.bidderAgent, BigInt(100_000_000));
    // Arc's registry still has amina's old $30 floor: her $20 bid is refused before any USDC moves.
    world.registryFloors.set(addr.creatorMain, BigInt(30_000_000));
    world.registryFloors.set(CHEAP.wallet, BigInt(5_000_000));
    clearRegistryFeatureCache(); // this registry now has minBidOf()
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 1);
    const amina = await decisionOf("amina");
    assert.equal(amina.decision, "FAILED");
    assert.match(amina.reason, /minimum on Arc is still \$30\.00/);
    assert.equal((await decisionOf("cheapdev")).decision, "BID");
    assert.equal(await spentToday(ids.bidder), BigInt(5_000_000), "only the bid that was recorded counts");
  });

  test("at most 5 bids per run; the rest are NOT_REACHED with the reason", async () => {
    world.usdc.set(addr.bidderAgent, BigInt(100_000_000));
    await db.update(bidderConfigs).set({ dailyBudget: "100000000" }).where(eq(bidderConfigs.userId, ids.bidder));
    await db.update(profiles).set({ minBid: "5000000" }).where(eq(profiles.userId, ids.creator));
    for (let i = 2; i <= 6; i++) {
      await addCreator(
        { id: `00000000-0000-0000-0000-0000000000e${i}`, handle: `dev${i}`, wallet: `0xe${i}00000000000000000000000000000000000001` },
        "5000000",
      );
      ai.scores.set(`dev${i}`, { score: 5, proceed: true });
    }
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 5);
    const notReached = (await records()).filter((r) => r.decision === "NOT_REACHED");
    assert.equal(notReached.length, 2);
    assert.match(notReached[0]!.reason, /at most 5 bids per run/);
  });

  test("self and already-bid-today creators are never considered", async () => {
    // The bidder also runs a market; and the agent already bid on cheapdev today.
    await db.insert(wallets).values({ userId: ids.bidder, circleWalletId: "w-bidder-main-2", address: "0xb300000000000000000000000000000000000003", blockchain: "ARC-TESTNET", state: "active", purpose: "legacy" });
    await db.insert(profiles).values({ userId: ids.bidder, handle: "myself", minBid: "5000000", tags: ["ai"], isActive: true });
    await db.insert(bids).values({
      bidderUserId: ids.bidder,
      creatorUserId: CHEAP.id,
      bidderAddress: addr.bidderAgent,
      creatorAddress: CHEAP.wallet,
      amountUsdc: "5000000",
      status: "failed",
    });
    await runBidderAgent(ids.bidder);
    const handles = (await records()).map((r) => r.creator).sort();
    assert.deepEqual(handles, ["amina"], "only amina was considered");
  });

  test("two runs at once: only one spends", async () => {
    world.usdc.set(addr.bidderAgent, BigInt(100_000_000));
    const [a, b] = await Promise.all([runBidderAgent(ids.bidder), runBidderAgent(ids.bidder)]);
    assert.equal(a.bidsPlaced + b.bidsPlaced <= 2, true);
    assert.ok([a, b].some((r) => r.errors.includes("Another agent run is already in progress")));
    assert.equal((await db.select().from(bids)).length, a.bidsPlaced + b.bidsPlaced, "no duplicate bids");
  });
});
