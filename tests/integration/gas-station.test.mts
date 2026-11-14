/**
 * Circle Gas Station: smart contract wallets (SCA) whose network fees Circle pays.
 * Against a real Postgres with Circle, Arc and Inngest faked at the edge.
 *
 * Proved here:
 *   - new MAIN wallets are smart wallets only while CIRCLE_GAS_STATION=1; agent wallets
 *     are always ordinary wallets (they sign x402 payments);
 *   - a verified creator with a sponsored smart wallet goes live with an empty wallet,
 *     from their own wallet, with no top-up; verification is still required; with Gas
 *     Station off, or for an ordinary wallet, the usual balance rules apply;
 *   - a settlement is recorded only when the escrow itself shows it (a smart wallet's
 *     call can revert inside a bundle transaction that succeeds); an escrow that can't
 *     be read means "check again later", never "settled";
 *   - a sponsored wallet can bid its whole balance; an ordinary one needs a little extra.
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installFakes, world, bidAcceptedLog } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();

process.env.X_CLIENT_ID = "x-client";
process.env.X_CLIENT_SECRET = "x-secret";

const session = { userId: ids.creator as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: {
    auth: async () => (session.userId ? { user: { id: session.userId, role: "creator", email: "t@test", name: "T" } } : null),
  },
});

const { NextRequest } = await import("next/server");
const { db } = await import("../../lib/db/client.ts");
const { bids, profiles, socialVerifications, wallets } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const provision = await import("../../app/api/wallet/provision/route.ts");
const activate = await import("../../app/api/profile/activate/route.ts");
const { ensureAgentWallet } = await import("../../lib/wallets.ts");
const { refreshRegistration } = await import("../../lib/registration.ts");
const { BidError, createBidIntent, finalizeSettlement, submitSettlement } = await import("../../lib/bids.ts");

const REPLY = "Thanks for your bid. Here is a considered answer to your question, with enough detail to be genuinely useful to you.";
const HOST = { host: "localhost:3000", origin: "http://localhost:3000" };
const post = async (route: { POST: (r: InstanceType<typeof NextRequest>) => Promise<Response> }, url: string) => {
  const res = await route.POST(new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: HOST }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const row = async (id: string) => (await db.query.bids.findFirst({ where: eq(bids.id, id) }))!;
const walletRow = async (circleWalletId: string) => (await db.query.wallets.findFirst({ where: eq(wallets.circleWalletId, circleWalletId) }))!;
const makeSmart = (circleWalletId: string) => db.update(wallets).set({ accountType: "SCA" }).where(eq(wallets.circleWalletId, circleWalletId));

after(closeDb);

describe("Circle Gas Station", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    await truncateAll();
    await seedMarket();
    delete process.env.CIRCLE_GAS_STATION;
    delete process.env.GAS_SPONSOR_WALLET_ID;
    delete process.env.GAS_SPONSOR_WALLET_ADDRESS;
    session.userId = ids.creator;
  });

  describe("creating wallets", () => {
    test("Gas Station off: a new main wallet is an ordinary wallet, as before", async () => {
      session.userId = ids.other;
      const res = await post(provision, "/api/wallet/provision");
      assert.equal(res.status, 200);
      assert.deepEqual(world.provisioned.map((w) => w.accountType), ["EOA"]);
      assert.equal((await walletRow("w-new-1")).accountType, "EOA");
    });

    test("Gas Station on: a new main wallet is a smart wallet, recorded as one", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      session.userId = ids.other;
      const res = await post(provision, "/api/wallet/provision");
      assert.equal(res.status, 200);
      assert.deepEqual(world.provisioned.map((w) => w.accountType), ["SCA"]);
      const w = await walletRow("w-new-1");
      assert.equal(w.accountType, "SCA");
      assert.equal(w.purpose, "main");
    });

    test("an agent wallet is always an ordinary wallet, even with Gas Station on", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      await ensureAgentWallet(ids.other);
      assert.deepEqual(world.provisioned.map((w) => w.accountType), ["EOA"]);
      assert.equal((await walletRow("w-new-1")).accountType, "EOA");
    });

    test("existing wallets keep their type when Gas Station is switched on", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      session.userId = ids.creator; // already has a main wallet
      const res = await post(provision, "/api/wallet/provision");
      assert.equal(res.body.alreadyExisted, true);
      assert.equal(world.provisioned.length, 0);
      assert.equal((await walletRow("w-creator-main")).accountType, "EOA");
    });
  });

  describe("going live", () => {
    beforeEach(async () => {
      await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, ids.creator));
      world.usdc.set(addr.creatorMain, BigInt(0));
      world.activeCreators.delete(addr.creatorMain);
      await db.insert(socialVerifications).values({ userId: ids.creator, provider: "x", providerAccountId: "x-1", handle: "amina" });
    });

    test("a sponsored smart wallet goes live with an empty wallet, from the creator's own wallet, with no top-up", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      process.env.GAS_SPONSOR_WALLET_ID = "w-sponsor"; // the top-up is set up too, and must not be used
      process.env.GAS_SPONSOR_WALLET_ADDRESS = "0x5900000000000000000000000000000000000005";
      await makeSmart("w-creator-main");
      const res = await post(activate, "/api/profile/activate");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { success: true, status: "registering", sponsored: true });
      const reg = world.calls("registerCreator");
      assert.equal(reg.length, 1);
      assert.equal(reg[0]!.walletId, "w-creator-main");
      assert.equal(world.calls("transfer").length, 0, "no top-up: Circle pays the fee");

      world.complete(reg[0]!.id);
      world.activeCreators.add(addr.creatorMain);
      assert.equal(await refreshRegistration(ids.creator), "active");
    });

    test("verification is still required for a smart wallet", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      await makeSmart("w-creator-main");
      await db.delete(socialVerifications);
      const res = await post(activate, "/api/profile/activate");
      assert.equal(res.body.code, "VERIFY_REQUIRED");
      assert.equal(world.txs.length, 0);
    });

    test("Gas Station switched off again: a smart wallet pays its own fee, so the balance rules apply", async () => {
      await makeSmart("w-creator-main");
      const res = await post(activate, "/api/profile/activate");
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "INSUFFICIENT_FUNDS");
      assert.equal(world.txs.length, 0);
    });

    test("an ordinary wallet still needs USDC with Gas Station on", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      const res = await post(activate, "/api/profile/activate");
      assert.equal(res.body.code, "INSUFFICIENT_FUNDS");
      assert.equal(world.txs.length, 0);
    });
  });

  describe("settlements are recorded only when the escrow shows them", () => {
    test("an accept that succeeded on Arc but changed nothing in the escrow is not recorded", async () => {
      const bid = await seedEscrowedBid();
      const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
      const tx = world.txs.find((t) => t.id === txId)!;
      world.completeWithoutEffect(txId, [bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, tx.args[1] as `0x${string}`)]);
      assert.equal(await finalizeSettlement(bid.id), "failed");
      const r = await row(bid.id);
      assert.equal(r.status, "pending", "no earnings for a reply that wasn't paid");
      assert.equal(r.settlementOnChainTxHash, null);
      assert.equal(r.settlementTxHash, null);
      assert.equal(r.settlementAttempt, 1, "a retry gets a new Circle key");
      assert.equal(r.reply, null);
      assert.match(r.failReason ?? "", /didn't take effect/);
    });

    test("the same for a refund claim", async () => {
      const bid = await seedEscrowedBid({ ageSeconds: 3 * 24 * 3600 + 5 });
      const { txId } = await submitSettlement({ bidId: bid.id, action: "refund", actorUserId: ids.bidder });
      world.completeWithoutEffect(txId);
      assert.equal(await finalizeSettlement(bid.id), "failed");
      assert.equal((await row(bid.id)).status, "pending");
    });

    test("an escrow that can't be read means check again later, never settled", async () => {
      const bid = await seedEscrowedBid();
      const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
      const tx = world.txs.find((t) => t.id === txId)!;
      world.complete(txId, [bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, tx.args[1] as `0x${string}`)]);
      world.failBidReads = true;
      assert.equal(await finalizeSettlement(bid.id), "in_flight");
      const r = await row(bid.id);
      assert.equal(r.status, "pending");
      assert.equal(r.settlementTxHash, txId, "the settlement stays in flight");
      world.failBidReads = false;
      assert.equal(await finalizeSettlement(bid.id), "settled");
      assert.equal((await row(bid.id)).status, "accepted");
    });

    test("if the escrow shows a different settlement, that is what's recorded", async () => {
      const bid = await seedEscrowedBid();
      const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
      world.escrowBids.get(bid.onChainBidId!)!.status = 3; // refunded by another transaction
      world.completeWithoutEffect(txId);
      assert.equal(await finalizeSettlement(bid.id), "settled");
      const r = await row(bid.id);
      assert.equal(r.status, "refunded");
      assert.equal(r.reply, null);
    });

    test("a settlement the escrow shows is recorded as before", async () => {
      const bid = await seedEscrowedBid();
      const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
      const tx = world.txs.find((t) => t.id === txId)!;
      world.complete(txId, [bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, tx.args[1] as `0x${string}`)]);
      assert.equal(await finalizeSettlement(bid.id), "settled");
      const r = await row(bid.id);
      assert.equal(r.status, "accepted");
      assert.equal(r.reply, REPLY);
    });
  });

  describe("bidding from a sponsored wallet", () => {
    const bidAll = () => createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });

    test("a sponsored smart wallet can bid its whole balance", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      await makeSmart("w-bidder-main");
      world.usdc.set(addr.bidderMain, BigInt(10_000_000));
      const bid = await bidAll();
      assert.equal(bid.status, "placing");
    });

    test("an ordinary wallet still needs a little extra for the fee", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      world.usdc.set(addr.bidderMain, BigInt(10_000_000));
      await assert.rejects(bidAll(), (e: unknown) => e instanceof BidError && /plus a little for network fees/.test(e.message));
    });

    test("a smart wallet with Gas Station off pays its own fee, so it needs the extra too", async () => {
      await makeSmart("w-bidder-main");
      world.usdc.set(addr.bidderMain, BigInt(10_000_000));
      await assert.rejects(bidAll(), /Not enough USDC/);
    });

    test("no wallet can bid more than it holds", async () => {
      process.env.CIRCLE_GAS_STATION = "1";
      await makeSmart("w-bidder-main");
      world.usdc.set(addr.bidderMain, BigInt(9_999_999));
      await assert.rejects(bidAll(), /Not enough USDC/);
    });
  });
});
