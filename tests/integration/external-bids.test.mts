/**
 * External bid API: an outside agent bids from its OWN wallet (lib/external-bids.ts).
 *   - it must have paid for the creator's profile over x402 from that wallet;
 *   - the same rules as any bid (pause, live creator, floor, limits);
 *   - Attnn. returns the exact approve + placeBid calls and keeps the message private;
 *   - a bid is recorded only after the transaction is read from Arc and matches exactly,
 *     once, whichever of confirm / webhook comes first;
 *   - Attnn. never refunds it and never counters it; the creator accepts or declines as usual;
 *   - existing bids from Attnn. users behave exactly as before (auto-refund still claims them).
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decodeFunctionData, type Hex } from "viem";
import { installFakes, world, escrowBid, bidPlacedLog } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();

const session = { userId: ids.creator as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: { auth: async () => (session.userId ? { user: { id: session.userId, role: "creator", email: "t@test" } } : null) },
});
mock.module(pathToFileURL(path.resolve("lib/circle-webhook.ts")).href, {
  namedExports: { verifyCircleSignature: async () => true },
});

const { NextRequest } = await import("next/server");
const { db } = await import("../../lib/db/client.ts");
const { appSettings, bids, externalBidIntents, profiles, x402Payments } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { escrowAbi, usdcAbi } = await import("../../lib/arc.ts");
const { fingerprint, clearEscrowCache } = await import("../../lib/escrow.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const { clearRegistryFeatureCache } = await import("../../lib/registration.ts");
const { recordExternalPlacement } = await import("../../lib/external-bids.ts");
const { submitSettlement } = await import("../../lib/bids.ts");
const createRoute = await import("../../app/api/v1/bids/route.ts");
const readRoute = await import("../../app/api/v1/bids/[id]/route.ts");
const confirmRoute = await import("../../app/api/v1/bids/[id]/confirm/route.ts");
const creatorsRoute = await import("../../app/api/v1/creators/route.ts");
const counterRoute = await import("../../app/api/bid/counter/route.ts");
const webhook = await import("../../app/api/webhooks/circle-events/route.ts");
const functions = await import("../../inngest/functions.ts");

/** The outside agent's own wallet: Attnn. holds no key for it. */
const AGENT = "0xa9e0000000000000000000000000000000000a9e";
const MESSAGE = "Hi Amina, we'd love your view on our Solidity audit tooling.";

const step = {
  run: async (_id: string, fn: () => unknown) => fn(),
  sleep: async () => {},
  sendEvent: async (_id: string, payload: { name: string; data: unknown }) => {
    world.events.push(payload);
  },
};
type Handler = (ctx: { event: { data: unknown }; step: unknown }) => Promise<Record<string, unknown>>;
const handlerOf = (fn: unknown) => (fn as { __fn: unknown[] }).__fn[2] as Handler;

const json = (url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...init.headers },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

async function payForProfile(payer = AGENT, handle = "amina", at = new Date()) {
  await db.insert(x402Payments).values({
    signatureHash: `sig-${crypto.randomUUID()}`,
    resource: `profile:${handle}`,
    payer,
    amountUsdc: "1000",
    network: "eip155:5042002",
    transaction: `gw-${crypto.randomUUID()}`,
    createdAt: at,
  });
}

type Created = { id: string; accessToken: string; calls: { to: string; data: Hex }[]; messageHash: string; amount: string; error?: string };
async function createBid(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await createRoute.POST(json("/api/v1/bids", { method: "POST", body: { handle: "amina", amount: "20000000", bidder: AGENT, message: MESSAGE, ...body }, headers }));
  return { status: res.status, body: (await res.json()) as Created };
}

/** The agent sends the placeBid call it was given, from its own wallet. Returns the tx hash. */
let txN = 0;
function agentSends(placeBid: { data: Hex }, opts: { bidder?: string; reverted?: boolean } = {}) {
  const { args } = decodeFunctionData({ abi: escrowAbi, data: placeBid.data });
  const [creator, amount, messageHash] = args as [string, bigint, Hex];
  const bidder = opts.bidder ?? AGENT;
  const id = escrowBid({ bidder, creator, amount, messageHash, createdAt: BigInt(Math.floor(Date.now() / 1000) - 60) });
  const hash = `0x${(++txN).toString(16).padStart(64, "a")}`;
  world.receipts.set(hash, { status: opts.reverted ? "reverted" : "success", logs: [bidPlacedLog(ESCROW, BigInt(id), bidder, creator, amount)] });
  return { hash, onChainBidId: id };
}

const confirm = async (id: string, token: string, txHash: string) => {
  const res = await confirmRoute.POST(json(`/api/v1/bids/${id}/confirm`, { method: "POST", body: { txHash }, headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const read = async (id: string, token: string) => {
  const res = await readRoute.GET(json(`/api/v1/bids/${id}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const externalRows = async () => (await db.select().from(bids)).filter((b) => b.bidderUserId === null);

describe("external bid API", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearEscrowCache();
    clearSettingsCache();
    clearRegistryFeatureCache();
    await truncateAll();
    await db.delete(x402Payments);
    session.userId = ids.creator;
    await seedMarket({ creatorMinBid: "20000000" });
  });
  after(closeDb);

  test("full flow: pay to read, prepare, send from its own wallet, confirm: an escrowed bid in the creator's inbox", async () => {
    await payForProfile();
    const { status, body } = await createBid();
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.calls.length, 2);

    // Call 1: approve exactly this bid for the escrow. Call 2: placeBid with the fingerprint, never the text.
    const approve = decodeFunctionData({ abi: usdcAbi, data: body.calls[0]!.data });
    assert.equal(approve.functionName, "approve");
    assert.deepEqual([String(approve.args![0]).toLowerCase(), approve.args![1]], [ESCROW, BigInt(20_000_000)]);
    const place = decodeFunctionData({ abi: escrowAbi, data: body.calls[1]!.data });
    assert.equal(place.functionName, "placeBid");
    assert.equal(String(place.args![0]).toLowerCase(), addr.creatorMain);
    const intent = (await db.select().from(externalBidIntents))[0]!;
    assert.equal(place.args![2], fingerprint(intent.messageSalt as Hex, MESSAGE));
    assert.ok(!body.calls[1]!.data.includes(Buffer.from("Solidity").toString("hex")), "the message never goes on-chain");
    assert.equal((await externalRows()).length, 0, "nothing recorded before it's on-chain");

    const sent = agentSends(body.calls[1]!);
    const confirmed = await confirm(body.id, body.accessToken, sent.hash);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.status, "pending");

    const [row] = await externalRows();
    assert.ok(row);
    assert.equal(row.status, "pending");
    assert.equal(row.bidderAddress, AGENT);
    assert.equal(row.creatorUserId, ids.creator);
    assert.equal(row.message, MESSAGE, "the creator sees the message, kept off-chain");
    assert.equal(row.onChainBidId, sent.onChainBidId);
    assert.equal(row.onChainTxHash, sent.hash);
    assert.ok(Math.abs(row.createdAt.getTime() - (Date.now() - 60_000)) < 5_000, "the bid's age is the escrow's");
    assert.ok(world.events.some((e) => (e as { name: string }).name === "attnn/bid.placed"), "handed to the creator's agent");
    assert.equal(world.calls("placeBid").length + world.calls("approve").length, 0, "Attnn. sent nothing on-chain");

    const view = await read(body.id, body.accessToken);
    assert.equal(view.status, 200);
    assert.equal(view.body.status, "pending");
    assert.equal(view.body.reply, null);
    assert.ok(view.body.refundableAfter);
  });

  test("the escrow's BidPlaced webhook records it too, and confirm afterwards doesn't duplicate it", async () => {
    await payForProfile();
    const { body } = await createBid();
    const sent = agentSends(body.calls[1]!);
    const log = world.receipts.get(sent.hash)!.logs[0] as { topics: unknown[]; data: string };
    const res = await webhook.POST(
      new NextRequest("http://attnn.test/api/webhooks/circle-events", {
        method: "POST",
        body: JSON.stringify({
          notificationId: `n-${crypto.randomUUID()}`,
          notificationType: "contracts.eventLog",
          notification: { txHash: sent.hash, contractAddress: ESCROW, blockchain: "ARC-TESTNET", topics: log.topics, data: log.data },
        }),
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { external: number }).external, 1);
    assert.equal((await confirm(body.id, body.accessToken, sent.hash)).status, 200, "confirm after the webhook is fine");
    assert.equal((await externalRows()).length, 1);
  });

  test("confirm and webhook racing: one bid row, whatever the order", async () => {
    await payForProfile();
    const { body } = await createBid();
    const sent = agentSends(body.calls[1]!);
    const results = await Promise.all([recordExternalPlacement(sent.hash), recordExternalPlacement(sent.hash, body.id), recordExternalPlacement(sent.hash)]);
    assert.equal(results.reduce((n, r) => n + r.recorded.length, 0), 1);
    assert.equal((await externalRows()).length, 1);
  });

  test("not recorded unless the chain matches exactly", async () => {
    await payForProfile();
    const { body } = await createBid();

    // A placeBid with a different message fingerprint (not what Attnn. handed out).
    const other = { data: body.calls[1]!.data.replace(body.messageHash.slice(2), "f".repeat(64)) as Hex };
    const wrongHash = agentSends(other);
    assert.equal((await confirm(body.id, body.accessToken, wrongHash.hash)).status, 409);

    // The right call, but from another wallet.
    const otherWallet = agentSends(body.calls[1]!, { bidder: "0xbad0000000000000000000000000000000000bad" });
    assert.equal((await confirm(body.id, body.accessToken, otherWallet.hash)).status, 409);

    // Reverted on-chain.
    const reverted = agentSends(body.calls[1]!, { reverted: true });
    assert.equal((await confirm(body.id, body.accessToken, reverted.hash)).status, 409);

    // A hash Arc doesn't know.
    assert.equal((await confirm(body.id, body.accessToken, `0x${"e".repeat(64)}`)).status, 409);
    assert.equal((await externalRows()).length, 0);
  });

  test("the wallet must have paid for this creator's profile, from that wallet, within a day", async () => {
    assert.equal((await createBid()).status, 402, "no payment");
    await payForProfile("0x1110000000000000000000000000000000000111");
    assert.equal((await createBid()).status, 402, "someone else's payment");
    await payForProfile(AGENT, "amina", new Date(Date.now() - 25 * 3600 * 1000));
    assert.equal((await createBid()).status, 402, "more than a day old");
    await payForProfile(AGENT.toUpperCase().replace("0X", "0x"));
    assert.equal((await createBid()).status, 201, "a payment from that wallet today (address case doesn't matter)");
  });

  test("the same rules as any bid", async () => {
    await payForProfile();
    assert.equal((await createBid({ amount: "10000000" })).status, 400, "below the creator's floor");
    assert.equal((await createBid({ amount: "1000000001" })).status, 400, "above the escrow maximum");
    assert.equal((await createBid({ bidder: "not-an-address" })).status, 400);
    assert.equal((await createBid({ handle: "nobody" })).status, 404);
    assert.equal((await createBid({ message: "x".repeat(2001) })).status, 400);

    await payForProfile(addr.bidderAgent);
    assert.equal((await createBid({ bidder: addr.bidderAgent })).status, 400, "a wallet Attnn. holds bids through the app");
    await payForProfile(addr.creatorMain);
    assert.equal((await createBid({ bidder: addr.creatorMain })).status, 400, "can't bid on yourself");

    await db.update(profiles).set({ availabilityStatus: "not_accepting" }).where(eq(profiles.userId, ids.creator));
    assert.equal((await createBid()).status, 409, "creator not accepting");
    await db.update(profiles).set({ availabilityStatus: "available" }).where(eq(profiles.userId, ids.creator));

    await db.insert(appSettings).values({ key: "bids_paused", value: true });
    clearSettingsCache();
    assert.equal((await createBid()).status, 503, "the pause switch stops outside bids too");
    assert.equal((await db.select().from(externalBidIntents)).length, 0, "nothing recorded for refused bids");
  });

  test("Idempotency-Key: a retry returns the same bid and token", async () => {
    await payForProfile();
    const a = await createBid({}, { "idempotency-key": "k-1" });
    const b = await createBid({}, { "idempotency-key": "k-1" });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.id, a.body.id);
    assert.equal(b.body.accessToken, a.body.accessToken);
    assert.equal((await db.select().from(externalBidIntents)).length, 1);
  });

  test("status needs the access token; the reply shows only once the bid is paid", async () => {
    await payForProfile();
    const { body } = await createBid();
    assert.equal((await read(body.id, "wrong")).status, 404);
    assert.equal((await read(body.id, body.accessToken)).body.status, "waiting");
    const sent = agentSends(body.calls[1]!);
    await confirm(body.id, body.accessToken, sent.hash);
    const reply = "Thanks for reaching out. I've looked at your tooling and here are my honest thoughts on where it could improve.";
    const [row] = await externalRows();
    await db.update(bids).set({ status: "accepted", reply }).where(eq(bids.id, row!.id));
    const view = await read(body.id, body.accessToken);
    assert.equal(view.body.status, "accepted");
    assert.equal(view.body.reply, reply);
  });

  test("the creator accepts an outside agent's bid as usual (from the creator's wallet)", async () => {
    await payForProfile();
    const { body } = await createBid();
    await confirm(body.id, body.accessToken, agentSends(body.calls[1]!).hash);
    const [row] = await externalRows();
    const reply = "Thanks for reaching out. I've looked at your tooling and here are my honest thoughts on where it could improve.";
    await submitSettlement({ bidId: row!.id, action: "accept", actorUserId: ids.creator, reply });
    const sentTx = world.calls("acceptBid");
    assert.equal(sentTx.length, 1);
    assert.equal(sentTx[0]!.walletId, "w-creator-main");
  });

  test("Attnn. never refunds an outside agent's bid, while users' expired bids are claimed exactly as before", async () => {
    await payForProfile();
    const { body } = await createBid();
    await confirm(body.id, body.accessToken, agentSends(body.calls[1]!).hash);
    const [ext] = await externalRows();
    await db.update(bids).set({ createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000) }).where(eq(bids.id, ext!.id));
    const own = await seedEscrowedBid({ ageSeconds: 3 * 24 * 3600 + 3600 });

    const out = await handlerOf(functions.autoRefund)({ event: { data: {} }, step });
    assert.deepEqual({ submitted: out.submitted, skipped: out.skipped }, { submitted: 1, skipped: 0 }, "the outside agent's bid isn't even attempted");
    const claims = world.calls("claimRefund");
    assert.equal(claims.length, 1, "only the user's own bid");
    assert.equal(claims[0]!.walletId, "w-bidder-main");
    assert.equal((await db.query.bids.findFirst({ where: eq(bids.id, ext!.id) }))!.settlementTxHash, null);
    assert.ok(own);
    await assert.rejects(submitSettlement({ bidId: ext!.id, action: "refund", actorUserId: ids.bidder }), /Only the bidder/);
  });

  test("never countered: the counter button refuses, and the creator agent surfaces instead", async () => {
    await payForProfile();
    const { body } = await createBid();
    await confirm(body.id, body.accessToken, agentSends(body.calls[1]!).hash);
    const [ext] = await externalRows();

    const res = await counterRoute.POST(
      new NextRequest("http://localhost:3000/api/bid/counter", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
        body: JSON.stringify({ bidId: ext!.id, counterOfferAmount: "50000000" }),
      }),
    );
    assert.equal(res.status, 409);

    // A much higher bid is pending, so the rules would counter this one (AI is offline here: fallback score 5).
    await seedEscrowedBid({ amount: BigInt(100_000_000) });
    const out = await handlerOf(functions.creatorAgentTriage)({ event: { data: { bidId: ext!.id, creatorUserId: ids.creator } }, step });
    const after = await db.query.bids.findFirst({ where: eq(bids.id, ext!.id) });
    assert.equal(after!.status, "pending", "not countered");
    assert.equal(after!.counterOfferAmount, null);
    assert.ok(!world.events.some((e) => (e as { name: string }).name === "attnn/counter.received"));
    assert.ok(out);
  });

  test("GET /api/v1/creators lists live markets, free", async () => {
    const res = await creatorsRoute.GET(json("/api/v1/creators?tag=AI"));
    const { creators } = (await res.json()) as { creators: { handle: string; floor: string; profile: string }[] };
    assert.deepEqual(creators.map((c) => [c.handle, c.floor, c.profile]), [["amina", "20000000", "/api/c/amina"]]);
  });
});
