import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installFakes, world } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";

await installFakes();

// Signed-in user for route tests; change `session.userId` per test.
const session = { userId: ids.bidder as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: {
    auth: async () => (session.userId ? { user: { id: session.userId, role: "bidder", email: "t@test" } } : null),
  },
});

const { db } = await import("../../lib/db/client.ts");
const { bids, bidderConfigs, wallets, appSettings } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { NextRequest } = await import("next/server");
const { acquireAgentLease, releaseAgentLease } = await import("../../lib/agent-lease.ts");
const { runBidderAgent } = await import("../../lib/agent.ts");
const { mainWallet, walletByAddress } = await import("../../lib/wallets.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const functions = await import("../../inngest/functions.ts");
const sendRoute = await import("../../app/api/wallet/send/route.ts");
const agentWalletRoute = await import("../../app/api/wallet/agent/route.ts");
const counterRoute = await import("../../app/api/bid/counter/route.ts");

type Handler = (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown>;
const handlerOf = (fn: unknown) => (fn as { __fn: unknown[] }).__fn[2] as Handler;
const step = {
  run: async (_id: string, fn: () => unknown) => fn(),
  sleep: async () => {},
  sendEvent: async (_id: string, payload: { name: string; data: unknown }) => {
    world.events.push(payload);
  },
};

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

describe("agent limits, counter-offers and wallet routes", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    await truncateAll();
    await seedMarket();
    session.userId = ids.bidder;
  });
  after(closeDb);

  // ── M1: one agent spend at a time ──
  test("M1: only one of many simultaneous lease requests wins; it expires and can be released", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => acquireAgentLease(ids.bidder)));
    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1);
    await releaseAgentLease(ids.bidder, winners[0]!);
    assert.ok(await acquireAgentLease(ids.bidder), "free again after release");
    // An expired lease (a crashed run) doesn't block forever.
    await db.update(bidderConfigs).set({ runLeaseUntil: new Date(Date.now() - 1000) }).where(eq(bidderConfigs.userId, ids.bidder));
    assert.ok(await acquireAgentLease(ids.bidder));
  });

  test("M1: an agent run while another holds the lease does nothing", async () => {
    const lease = await acquireAgentLease(ids.bidder);
    const result = await runBidderAgent(ids.bidder);
    assert.match(result.errors.join(" "), /already in progress/);
    assert.equal((await db.select().from(bids)).length, 0);
    await releaseAgentLease(ids.bidder, lease!);
  });

  test("pause switch: a paused platform stops agent runs", async () => {
    await db.insert(appSettings).values({ key: "bids_paused", value: true });
    clearSettingsCache();
    const result = await runBidderAgent(ids.bidder);
    assert.match(result.errors.join(" "), /paused/);
  });

  // ── M2 / L12: counter-offers ──
  test("the agent answers a counter on its own bid with exactly one re-bid, even if the event arrives twice", async () => {
    const original = await seedEscrowedBid({ status: "counter_offered", fromAgent: true });
    const handler = handlerOf(functions.handleCounterOffer);
    const event = { data: { bidId: original.id, bidderUserId: ids.bidder, counterOfferAmount: "15000000" } };
    const results = await Promise.allSettled([handler({ event, step }), handler({ event, step })]);
    // One wins; the other either gets the same re-bid back or is told to retry (lease busy).
    assert.ok(results.some((r) => r.status === "fulfilled" && (r.value as { decision: string }).decision === "accept"));
    const rebids = await db.select().from(bids).where(eq(bids.replacesBidId, original.id));
    assert.equal(rebids.length, 1);
    assert.equal(rebids[0]!.bidderAddress, addr.bidderAgent);
    assert.equal(rebids[0]!.amountUsdc, "15000000");
  });

  test("M2: a counter on a re-bid is never answered, and the counter route refuses it", async () => {
    const original = await seedEscrowedBid({ status: "counter_offered", fromAgent: true });
    const rebid = await seedEscrowedBid({ status: "counter_offered", fromAgent: true, replacesBidId: original.id, amount: BigInt(15_000_000) });
    const out = (await handlerOf(functions.handleCounterOffer)({
      event: { data: { bidId: rebid.id, bidderUserId: ids.bidder, counterOfferAmount: "19000000" } },
      step,
    })) as { decision: string };
    assert.equal(out.decision, "skip");

    const pendingRebid = await seedEscrowedBid({ fromAgent: true, replacesBidId: (await seedEscrowedBid({ status: "counter_offered", fromAgent: true })).id });
    session.userId = ids.creator;
    const res = await counterRoute.POST(post("/api/bid/counter", { bidId: pendingRebid.id, counterOfferAmount: "19000000" }));
    assert.equal(res.status, 400);
  });

  test("L12: the agent doesn't answer counters on bids the user placed by hand", async () => {
    const manual = await seedEscrowedBid({ status: "counter_offered", fromAgent: false });
    const out = (await handlerOf(functions.handleCounterOffer)({
      event: { data: { bidId: manual.id, bidderUserId: ids.bidder, counterOfferAmount: "15000000" } },
      step,
    })) as { decision: string; reason: string };
    assert.equal(out.decision, "skip");
    assert.match(out.reason, /wasn't placed by the agent/);
  });

  test("counters above the cap or the remaining budget are declined", async () => {
    const original = await seedEscrowedBid({ status: "counter_offered", fromAgent: true });
    const handler = handlerOf(functions.handleCounterOffer);
    const tooHigh = (await handler({ event: { data: { bidId: original.id, bidderUserId: ids.bidder, counterOfferAmount: "25000000" } }, step })) as { decision: string };
    assert.equal(tooHigh.decision, "reject", "above maxBidPerCreator ($20)");
    await db.update(bidderConfigs).set({ dailyBudget: "12000000" }).where(eq(bidderConfigs.userId, ids.bidder));
    const overBudget = (await handler({ event: { data: { bidId: original.id, bidderUserId: ids.bidder, counterOfferAmount: "15000000" } }, step })) as { decision: string };
    assert.equal(overBudget.decision, "reject", "$10 already spent today + $15 > $12 budget");
  });

  // ── H3: sending USDC ──
  test("H3: the same send request can only move money once", async () => {
    const body = { to: "0x1111111111111111111111111111111111111111", amount: "5", requestId: "6f1d2b8e-3c4a-4b5d-9e6f-7a8b9c0d1e2f" };
    const a = await sendRoute.POST(post("/api/wallet/send", body));
    const b = await sendRoute.POST(post("/api/wallet/send", body));
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(world.calls("transfer").length, 1);
    assert.equal((await a.json()).txId, (await b.json()).txId);
  });

  test("H3: sends without a request id, from another website, or too often are refused", async () => {
    const base = { to: "0x1111111111111111111111111111111111111111", amount: "5" };
    assert.equal((await sendRoute.POST(post("/api/wallet/send", base))).status, 400);
    const crossSite = await sendRoute.POST(
      post("/api/wallet/send", { ...base, requestId: crypto.randomUUID() }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    );
    assert.equal(crossSite.status, 403);
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await sendRoute.POST(post("/api/wallet/send", { ...base, requestId: crypto.randomUUID() }));
      if (r.status === 429) limited++;
    }
    assert.ok(limited >= 1, "the 11th send in an hour is refused");
    assert.ok(world.calls("transfer").length <= 10);
  });

  test("moving USDC to the agent wallet is idempotent too, and keeps gas behind", async () => {
    const requestId = crypto.randomUUID();
    await agentWalletRoute.POST(post("/api/wallet/agent", { action: "fund", amount: "10", requestId }));
    await agentWalletRoute.POST(post("/api/wallet/agent", { action: "fund", amount: "10", requestId }));
    assert.equal(world.calls("transfer").length, 1);
    world.usdc.set(addr.bidderMain, BigInt(10_000_000));
    const all = await agentWalletRoute.POST(post("/api/wallet/agent", { action: "fund", amount: "10", requestId: crypto.randomUUID() }));
    assert.equal(all.status, 400, "moving the whole balance would leave nothing for the network fee");
  });

  test("signed-out requests are refused", async () => {
    session.userId = null;
    const r = await sendRoute.POST(post("/api/wallet/send", { to: "0x1111111111111111111111111111111111111111", amount: "5", requestId: crypto.randomUUID() }));
    assert.equal(r.status, 401);
    assert.equal(world.txs.length, 0);
  });

  // ── H1: wallets from another network ──
  test("H1: a wallet from another network is never returned", async () => {
    await db.update(wallets).set({ blockchain: "ARC" }).where(eq(wallets.userId, ids.creator));
    assert.equal(await mainWallet(ids.creator), undefined);
    assert.equal(await walletByAddress(ids.creator, addr.creatorMain), undefined);
    assert.ok(await mainWallet(ids.bidder));
  });
});
