/**
 * Security audit of the external bid API (outside agents bidding from their own wallets).
 * Complements tests/integration/external-bids.test.mts with the adversarial and
 * concurrent cases, and with proof that Attnn. users' bids behave exactly as before.
 *
 *   Refunds      only Attnn.-held wallets ever enter a refund submission
 *   Settlement   outside bids never reach bidder settlement, placement or counter flows
 *   Webhooks     only the configured escrow's events, on this chain, verified on Arc,
 *                change an outside bid
 *   Verification wallet, creator, amount, escrow, fingerprint, receipt and on-chain status
 *   Concurrency  simultaneous confirm + webhook, repeated confirm, repeated API requests
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decodeFunctionData, encodeEventTopics, type Hex } from "viem";
import { installFakes, world, escrowBid, bidPlacedLog } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();

mock.module(pathToFileURL(path.resolve("lib/circle-webhook.ts")).href, {
  namedExports: { verifyCircleSignature: async () => true },
});

const { NextRequest } = await import("next/server");
const { db } = await import("../../lib/db/client.ts");
const { bids, bidderConfigs, externalBidIntents, x402Payments } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { escrowAbi } = await import("../../lib/arc.ts");
const { clearEscrowCache } = await import("../../lib/escrow.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const { clearRegistryFeatureCache } = await import("../../lib/registration.ts");
const { submitSettlement } = await import("../../lib/bids.ts");
const { syncExternalRefund } = await import("../../lib/external-bids.ts");
const readRoute = await import("../../app/api/v1/bids/[id]/route.ts");
const createRoute = await import("../../app/api/v1/bids/route.ts");
const confirmRoute = await import("../../app/api/v1/bids/[id]/confirm/route.ts");
const webhook = await import("../../app/api/webhooks/circle-events/route.ts");
const functions = await import("../../inngest/functions.ts");
const lifecycle = await import("../../inngest/bid-lifecycle.ts");

const AGENT = "0xa9e0000000000000000000000000000000000a9e";
const OTHER_ESCROW = "0x0000000000000000000000000000000000e5c099";
const REPLY = "Thanks for reaching out. I've looked at your tooling and here are my honest thoughts on where it could improve.";

const step = {
  run: async (_id: string, fn: () => unknown) => fn(),
  sleep: async () => {},
  sendEvent: async (_id: string, payload: { name: string; data: unknown }) => {
    world.events.push(payload);
  },
};
type Handler = (ctx: { event: { data: unknown }; step: unknown }) => Promise<Record<string, unknown>>;
const handlerOf = (fn: unknown) => (fn as { __fn: unknown[] }).__fn[2] as Handler;
const events = (name: string) => world.events.filter((e) => (e as { name: string }).name === name);

async function payForProfile(payer = AGENT) {
  await db.insert(x402Payments).values({
    signatureHash: `sig-${crypto.randomUUID()}`,
    resource: "profile:amina",
    payer,
    amountUsdc: "1000",
    network: "eip155:5042002",
    transaction: `gw-${crypto.randomUUID()}`,
  });
}

type Created = { id: string; accessToken: string; calls: { data: Hex }[]; messageHash: string; error?: string };
async function createBid(body: Record<string, unknown> = {}, key?: string) {
  const res = await createRoute.POST(
    new NextRequest("http://localhost:3000/api/v1/bids", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...(key ? { "idempotency-key": key } : {}) },
      body: JSON.stringify({ handle: "amina", amount: "20000000", bidder: AGENT, message: "Hello Amina", ...body }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Created };
}

let txN = 0;
/** The agent's own transaction: puts the bid in the fake escrow and a receipt on the fake chain. */
function agentSends(placeBid: { data: Hex }, opts: { escrow?: string; onChainAmount?: bigint } = {}) {
  const { args } = decodeFunctionData({ abi: escrowAbi, data: placeBid.data });
  const [creator, amount, messageHash] = args as [string, bigint, Hex];
  const id = escrowBid({ bidder: AGENT, creator, amount: opts.onChainAmount ?? amount, messageHash });
  const hash = `0x${(++txN).toString(16).padStart(64, "b")}`;
  world.receipts.set(hash, { status: "success", logs: [bidPlacedLog(opts.escrow ?? ESCROW, BigInt(id), AGENT, creator, amount)] });
  return { hash, onChainBidId: id };
}

const confirm = async (id: string, token: string, txHash: string) => {
  const res = await confirmRoute.POST(
    new NextRequest(`http://localhost:3000/api/v1/bids/${id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ txHash }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

/** A Circle contract-event notification, as the webhook receives it. */
function notify(log: { topics: readonly unknown[]; data: string }, opts: { txHash?: string; contract?: string; blockchain?: string } = {}) {
  return webhook.POST(
    new NextRequest("http://attnn.test/api/webhooks/circle-events", {
      method: "POST",
      body: JSON.stringify({
        notificationId: `n-${crypto.randomUUID()}`,
        notificationType: "contracts.eventLog",
        notification: { txHash: opts.txHash ?? `0x${"7".repeat(64)}`, contractAddress: opts.contract ?? ESCROW, blockchain: opts.blockchain ?? "ARC-TESTNET", topics: log.topics, data: log.data },
      }),
    }),
  );
}
const refundedLog = (onChainBidId: string, bidder = AGENT) => ({
  topics: encodeEventTopics({ abi: escrowAbi, eventName: "BidRefunded", args: { bidId: BigInt(onChainBidId), bidder: bidder as Hex } }),
  data: "0x",
});

const externalRows = async () => (await db.select().from(bids)).filter((b) => b.bidderUserId === null);
async function escrowedExternalBid() {
  await payForProfile();
  const { body } = await createBid();
  const sent = agentSends(body.calls[1]!);
  assert.equal((await confirm(body.id, body.accessToken, sent.hash)).status, 200);
  const [row] = await externalRows();
  return { row: row!, sent, intent: body };
}

describe("external bid API: security audit", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearEscrowCache();
    clearSettingsCache();
    clearRegistryFeatureCache();
    await truncateAll();
    await db.delete(x402Payments);
    await seedMarket({ creatorMinBid: "20000000" });
  });
  after(closeDb);

  // ── 1. Refunds ──────────────────────────────────────────────────────────────

  test("refunds: nobody can submit a refund for an outside bid, whoever they claim to be", async () => {
    const { row } = await escrowedExternalBid();
    for (const actor of [ids.bidder, ids.creator, ids.other, ""]) {
      await assert.rejects(submitSettlement({ bidId: row.id, action: "refund", actorUserId: actor }), /Only the bidder/, `actor ${actor || "(empty)"}`);
    }
    assert.equal(world.calls("claimRefund").length, 0);
  });

  // ── 2. Settlement, placement, counters ──────────────────────────────────────

  test("settlement: the creator declines an outside bid from the creator's own wallet (the agent is refunded on-chain)", async () => {
    const { row } = await escrowedExternalBid();
    await submitSettlement({ bidId: row.id, action: "reject", actorUserId: ids.creator });
    const sent = world.calls("rejectBid");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.walletId, "w-creator-main");
    await assert.rejects(submitSettlement({ bidId: row.id, action: "accept", actorUserId: ids.bidder, reply: REPLY }), /Only the creator/);
  });

  test("placement: the placeBid job never sends anything for a bid with no Attnn. bidder", async () => {
    const [row] = await db
      .insert(bids)
      .values({ bidderUserId: null, creatorUserId: ids.creator, bidderAddress: AGENT, creatorAddress: addr.creatorMain, amountUsdc: "20000000", status: "placing", escrowAddress: ESCROW })
      .returning();
    await handlerOf(lifecycle.placeBid)({ event: { data: { bidId: row!.id, bidderUserId: null } }, step });
    assert.equal(world.calls("approve").length + world.calls("placeBid").length, 0);
  });

  test("counters: the counter-offer handler skips an outside bid even if an event arrives", async () => {
    const { row } = await escrowedExternalBid();
    await db.update(bids).set({ status: "counter_offered", counterOfferAmount: "50000000" }).where(eq(bids.id, row.id));
    const out = await handlerOf(functions.handleCounterOffer)({ event: { data: { bidId: row.id, bidderUserId: null, counterOfferAmount: "50000000" } }, step });
    assert.equal(out.skipped, true);
    assert.equal((await db.select().from(bids)).length, 1, "no re-bid created");
  });

  // ── 3. Webhooks ─────────────────────────────────────────────────────────────

  test("webhook: a BidRefunded notification for an outside bid is applied only when the escrow says it was refunded", async () => {
    const { row, sent } = await escrowedExternalBid();
    // Still Pending on-chain: a notification claiming otherwise is ignored.
    let res = await notify(refundedLog(sent.onChainBidId));
    assert.equal(res.status, 200);
    assert.equal((await db.query.bids.findFirst({ where: eq(bids.id, row.id) }))!.status, "pending");

    // The agent really claimed its refund.
    world.escrowBids.get(sent.onChainBidId)!.status = 3;
    res = await notify(refundedLog(sent.onChainBidId));
    assert.equal(res.status, 200);
    const after = await db.query.bids.findFirst({ where: eq(bids.id, row.id) });
    assert.equal(after!.status, "refunded");
  });

  test("webhook: events from another contract or another chain never touch an outside bid", async () => {
    const { row, sent } = await escrowedExternalBid();
    world.escrowBids.get(sent.onChainBidId)!.status = 3;
    await notify(refundedLog(sent.onChainBidId), { contract: OTHER_ESCROW });
    await notify(refundedLog(sent.onChainBidId), { blockchain: "ETH-SEPOLIA" });
    assert.equal((await db.query.bids.findFirst({ where: eq(bids.id, row.id) }))!.status, "pending");
  });

  test("webhook: a BidPlaced in another escrow contract is never recorded, even for a waiting intent", async () => {
    await payForProfile();
    const { body } = await createBid();
    const sent = agentSends(body.calls[1]!, { escrow: OTHER_ESCROW });
    const log = world.receipts.get(sent.hash)!.logs[0] as { topics: unknown[]; data: string };
    await notify(log, { txHash: sent.hash });
    assert.equal((await confirm(body.id, body.accessToken, sent.hash)).status, 409);
    assert.equal((await externalRows()).length, 0);
  });

  test("webhook: a BidPlaced notification can't invent a bid: the transaction is read from Arc", async () => {
    await payForProfile();
    await createBid();
    // A signed notification whose transaction Arc doesn't have (or that placed nothing).
    const fake = bidPlacedLog(ESCROW, BigInt(99), AGENT, addr.creatorMain, BigInt(20_000_000));
    const res = await notify(fake as unknown as { topics: unknown[]; data: string }, { txHash: `0x${"6".repeat(64)}` });
    assert.equal(res.status, 200);
    assert.equal((await externalRows()).length, 0);
    assert.equal((await db.select().from(externalBidIntents))[0]!.bidId, null, "still waiting");
  });

  test("missed refund webhook: the agent's status read catches up, only from the escrow's own record", async () => {
    const { row, sent, intent } = await escrowedExternalBid();
    const read = async () => {
      const res = await readRoute.GET(
        new NextRequest(`http://localhost:3000/api/v1/bids/${intent.id}`, { headers: { authorization: `Bearer ${intent.accessToken}` } }),
        { params: Promise.resolve({ id: intent.id }) },
      );
      return (await res.json()) as { status: string };
    };
    // Inside the window: never touched, even if the escrow says refunded.
    world.escrowBids.get(sent.onChainBidId)!.status = 3;
    assert.equal((await read()).status, "pending");

    // Past the window but still Pending on-chain: nothing inferred.
    await db.update(bids).set({ createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000) }).where(eq(bids.id, row.id));
    world.escrowBids.get(sent.onChainBidId)!.status = 0;
    assert.equal((await read()).status, "pending");

    // Past the window and Refunded on-chain (the agent claimed it, no webhook arrived).
    world.escrowBids.get(sent.onChainBidId)!.status = 3;
    assert.equal((await read()).status, "refunded");
    assert.equal(world.calls("claimRefund").length, 0, "Attnn. sent nothing");
  });

  test("missed refund webhook: the catch-up never applies to a user's own bid", async () => {
    const own = await seedEscrowedBid({ ageSeconds: 4 * 24 * 3600 });
    world.escrowBids.get(own.onChainBidId!)!.status = 3;
    const row = await db.query.bids.findFirst({ where: eq(bids.id, own.id) });
    assert.equal(await syncExternalRefund(row!, 3 * 24 * 3600 * 1000), false);
    assert.equal((await db.query.bids.findFirst({ where: eq(bids.id, own.id) }))!.status, "pending");
  });

  // ── 4. Verification ─────────────────────────────────────────────────────────

  test("verification: the escrow's own record must match the event (amount)", async () => {
    await payForProfile();
    const { body } = await createBid();
    const sent = agentSends(body.calls[1]!, { onChainAmount: BigInt(5_000_000) });
    assert.equal((await confirm(body.id, body.accessToken, sent.hash)).status, 409);
    assert.equal((await externalRows()).length, 0);
  });

  test("verification: a bid already settled on-chain before it was recorded isn't recorded as open", async () => {
    await payForProfile();
    const { body } = await createBid();
    const sent = agentSends(body.calls[1]!);
    world.escrowBids.get(sent.onChainBidId)!.status = 3;
    const res = await confirm(body.id, body.accessToken, sent.hash);
    assert.equal(res.status, 409);
    assert.match(String(res.body.error), /already settled on-chain/);
  });

  test("verification: one bid's transaction can't confirm another bid with the same details", async () => {
    await payForProfile();
    const a = (await createBid()).body;
    const b = (await createBid()).body;
    assert.notEqual(a.messageHash, b.messageHash, "every bid gets its own fingerprint");
    const sentA = agentSends(a.calls[1]!);
    assert.equal((await confirm(b.id, b.accessToken, sentA.hash)).status, 409, "B can't claim A's transaction");
    assert.equal((await externalRows()).length, 0);
    assert.equal((await confirm(a.id, a.accessToken, sentA.hash)).status, 200, "A still confirms");
    assert.equal((await confirm(b.id, a.accessToken, sentA.hash)).status, 404, "A's token doesn't open B");
  });

  // ── 5. Idempotency and concurrency ──────────────────────────────────────────

  test("concurrency: three confirms and the webhook at once give exactly one bid and one creator notice", async () => {
    await payForProfile();
    const { body } = await createBid();
    const sent = agentSends(body.calls[1]!);
    const log = world.receipts.get(sent.hash)!.logs[0] as { topics: unknown[]; data: string };
    const results = await Promise.all([
      confirm(body.id, body.accessToken, sent.hash),
      confirm(body.id, body.accessToken, sent.hash),
      notify(log, { txHash: sent.hash }).then((r) => ({ status: r.status })),
      confirm(body.id, body.accessToken, sent.hash),
    ]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal((await externalRows()).length, 1);
    assert.equal(events("attnn/bid.placed").length, 1, "the creator's agent is told once");
  });

  test("idempotency: confirming again later changes nothing", async () => {
    const { intent, sent } = await escrowedExternalBid();
    const before = events("attnn/bid.placed").length;
    for (let i = 0; i < 3; i++) assert.equal((await confirm(intent.id, intent.accessToken, sent.hash)).status, 200);
    assert.equal((await externalRows()).length, 1);
    assert.equal(events("attnn/bid.placed").length, before);
  });

  test("idempotency: simultaneous requests with one Idempotency-Key create one bid", async () => {
    await payForProfile();
    const results = await Promise.all([createBid({}, "same-key"), createBid({}, "same-key"), createBid({}, "same-key")]);
    assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
    assert.equal(new Set(results.map((r) => r.body.accessToken)).size, 1);
    assert.equal((await db.select().from(externalBidIntents)).length, 1);
  });

  test("idempotency: a key reused for a different bid is refused, never answered with the old one", async () => {
    await payForProfile();
    assert.equal((await createBid({}, "k")).status, 201);
    assert.equal((await createBid({}, "k")).status, 200, "the same bid again");
    assert.equal((await createBid({ amount: "30000000" }, "k")).status, 409, "another amount");
    assert.equal((await createBid({ message: "Something else" }, "k")).status, 409, "another message");
    assert.equal((await db.select().from(externalBidIntents)).length, 1);
  });

  test("idempotency: the same amount written differently is the same bid (leading zeros, number vs string)", async () => {
    await payForProfile();
    const first = await createBid({ amount: "020000000" }, "kz");
    assert.equal(first.status, 201, JSON.stringify(first.body));
    for (const amount of ["020000000", "20000000", 20000000, " 20000000 "]) {
      const again = await createBid({ amount }, "kz");
      assert.equal(again.status, 200, `retry with ${JSON.stringify(amount)}`);
      assert.equal(again.body.id, first.body.id);
      assert.equal(again.body.accessToken, first.body.accessToken);
    }
    assert.equal((await createBid({ amount: "020000001" }, "kz")).status, 409, "a really different amount is still refused");
    assert.equal((await db.select().from(externalBidIntents)).length, 1);
  });

  test("idempotency: keys are per wallet, so one agent can't collide with another's", async () => {
    const OTHER_AGENT = "0x0a9e00000000000000000000000000000000a9e0";
    await payForProfile();
    await payForProfile(OTHER_AGENT);
    const mine = await createBid({}, "k");
    const theirs = await createBid({ bidder: OTHER_AGENT }, "k");
    assert.equal(mine.status, 201);
    assert.equal(theirs.status, 201);
    assert.notEqual(mine.body.id, theirs.body.id);
  });

  test("limits: at most 10 bids waiting per wallet", async () => {
    await payForProfile();
    for (let i = 0; i < 10; i++) assert.equal((await createBid()).status, 201);
    assert.equal((await createBid()).status, 429);
  });

  // ── 8. Attnn. users' own bids: exactly as before ────────────────────────────

  test("before/after: a user's own bid still refunds automatically, from their wallet", async () => {
    const own = await seedEscrowedBid({ ageSeconds: 3 * 24 * 3600 + 3600 });
    const out = await handlerOf(functions.autoRefund)({ event: { data: {} }, step });
    assert.equal(out.submitted, 1);
    assert.equal(world.calls("claimRefund")[0]!.walletId, "w-bidder-main");
    assert.ok(own);
  });

  test("before/after: a user's own BidRefunded is still applied straight from the notification", async () => {
    const own = await seedEscrowedBid();
    // Unchanged behaviour: the escrow isn't re-read for Attnn. users' bids.
    const res = await notify(refundedLog(own.onChainBidId!, addr.bidderMain));
    assert.equal(res.status, 200);
    assert.equal((await db.query.bids.findFirst({ where: eq(bids.id, own.id) }))!.status, "refunded");
  });

  test("before/after: a user's own BidPlaced is finished as before and creates no outside bid", async () => {
    world.autoMine = true;
    const { createBidIntent } = await import("../../lib/bids.ts");
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "20000000" });
    await handlerOf(lifecycle.placeBid)({ event: { data: { bidId: bid.id, bidderUserId: ids.bidder } }, step });
    const row = await db.query.bids.findFirst({ where: eq(bids.id, bid.id) });
    assert.equal(row!.status, "pending");
    assert.equal(row!.bidderUserId, ids.bidder);
    assert.equal((await externalRows()).length, 0);
  });

  test("before/after: a user's agent still answers a counter on its own bid", async () => {
    await db.update(bidderConfigs).set({ maxBidPerCreator: "100000000", dailyBudget: "100000000" }).where(eq(bidderConfigs.userId, ids.bidder));
    const original = await seedEscrowedBid({ status: "counter_offered", fromAgent: true, amount: BigInt(20_000_000) });
    await db.update(bids).set({ counterOfferAmount: "30000000" }).where(eq(bids.id, original.id));
    const out = await handlerOf(functions.handleCounterOffer)({ event: { data: { bidId: original.id, bidderUserId: ids.bidder, counterOfferAmount: "30000000" } }, step });
    assert.notEqual(out.skipped, true, JSON.stringify(out));
    const rebids = await db.select().from(bids).where(eq(bids.replacesBidId, original.id));
    assert.equal(rebids.length, 1);
  });
});
