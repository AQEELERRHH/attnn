/**
 * Fixes from the CertiK AI scan of the contracts (Oct 2026), on the app side:
 *   Finding 4: the escrow enforces each creator's own minimum (registry.minBidOf).
 *              The app refuses a bid below it up front, and a placement the chain
 *              refuses fails with no USDC moved.
 *   Finding 2: every bid gets its own message fingerprint, so a wrong or stale id
 *              can never settle another bid with the same bidder, creator and amount.
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world, escrowBid } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();
const { db } = await import("../../lib/db/client.ts");
const { bids } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { BidError, createBidIntent, submitSettlement } = await import("../../lib/bids.ts");
const { clearRegistryFeatureCache } = await import("../../lib/registration.ts");
const { fingerprint, newSalt } = await import("../../lib/escrow.ts");
const { classifyOpenRows, findOrphans } = await import("../../lib/reconcile.ts");
const lifecycle = await import("../../inngest/bid-lifecycle.ts");

type Fn = { __fn: [unknown, unknown, (ctx: unknown) => Promise<unknown>] };
const placeJob = lifecycle.placeBid as unknown as Fn;
const step = {
  run: async (_id: string, fn: () => unknown) => JSON.parse(JSON.stringify((await fn()) ?? null)),
  sleep: async () => {},
  sendEvent: async () => {},
};
const row = async (id: string) => (await db.query.bids.findFirst({ where: eq(bids.id, id) }))!;
const REPLY = "Thanks for your bid. Here is a considered answer to your question, with enough detail to be genuinely useful to you.";
type Hex = `0x${string}`;

describe("CertiK scan fixes (app side)", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearRegistryFeatureCache();
    await truncateAll();
    await seedMarket(); // the database floor is $5
  });
  after(async () => {
    clearRegistryFeatureCache();
    await closeDb();
  });

  // ── Finding 4: the creator's own minimum ──
  test("a bid below the creator's minimum on Arc is refused before anything is written or sent", async () => {
    world.registryFloors.set(addr.creatorMain, BigInt(10_000_000)); // Arc still has $10 (a lower floor not synced yet)
    await assert.rejects(
      createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "5000000" }),
      (e: unknown) => e instanceof BidError && /minimum on Arc is still \$10\.00/.test(e.message),
    );
    assert.equal((await db.select().from(bids)).length, 0);
    assert.equal(world.txs.length, 0);
    const ok = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    assert.equal(ok.status, "placing");
  });

  test("a registry without minBidOf (original testnet) keeps today's behaviour", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "5000000" });
    assert.equal(bid.status, "placing");
  });

  test("if the chain refuses a below-minimum bid anyway, it fails with no USDC moved", async () => {
    world.autoMine = true;
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "5000000" });
    world.registryFloors.set(addr.creatorMain, BigInt(10_000_000)); // raised on Arc after the check
    await placeJob.__fn[2]({ event: { data: { bidId: bid.id } }, step });
    const r = await row(bid.id);
    assert.equal(r.status, "failed");
    assert.match(r.failReason ?? "", /No USDC moved/i);
    assert.equal(world.usdc.get(ESCROW) ?? BigInt(0), BigInt(0));
    assert.equal(world.escrowBids.size, 0);
  });

  // ── Finding 2: one fingerprint per bid ──
  test("every bid gets a salt; with no message, its fingerprint is of the empty text, never zero", async () => {
    world.autoMine = true;
    const a = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    const b = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    assert.ok(a.messageSalt && b.messageSalt && a.messageSalt !== b.messageSalt);
    for (const bid of [a, b]) await placeJob.__fn[2]({ event: { data: { bidId: bid.id } }, step });
    const [pa, pb] = world.calls("placeBid");
    assert.equal(pa!.args[2], fingerprint(a.messageSalt as Hex, ""));
    assert.equal(pb!.args[2], fingerprint(b.messageSalt as Hex, ""));
    assert.notEqual(pa!.args[2], pb!.args[2], "identical bids are still told apart on-chain");
  });

  test("a wrong id that points at an identical bid is refused; the right one settles", async () => {
    // Two escrowed bids with the same bidder, creator and amount.
    const saltA = newSalt();
    const saltB = newSalt();
    const base = { bidder: addr.bidderMain, creator: addr.creatorMain, amount: BigInt(10_000_000) };
    const idA = escrowBid({ ...base, messageHash: fingerprint(saltA, "") });
    const idB = escrowBid({ ...base, messageHash: fingerprint(saltB, "") });
    const values = {
      bidderUserId: ids.bidder,
      creatorUserId: ids.creator,
      bidderAddress: addr.bidderMain,
      creatorAddress: addr.creatorMain,
      amountUsdc: "10000000",
      status: "pending" as const,
      escrowAddress: ESCROW,
      onChainTxHash: `0x${"a".repeat(64)}`,
    };
    // Row A wrongly holds B's id (a recovery mix-up).
    const [rowA] = await db.insert(bids).values({ ...values, messageSalt: saltA, onChainBidId: idB }).returning();
    await assert.rejects(
      submitSettlement({ bidId: rowA!.id, action: "accept", actorUserId: ids.creator, reply: REPLY }),
      (e: unknown) => e instanceof BidError && /doesn't match/.test(e.message),
    );
    assert.equal(world.calls("acceptBid").length, 0, "the other bid was never touched");

    await db.update(bids).set({ onChainBidId: idA }).where(eq(bids.id, rowA!.id));
    await submitSettlement({ bidId: rowA!.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    const [accepted] = world.calls("acceptBid");
    assert.equal(String(accepted!.args[0]), idA);
  });

  test("repair tools link identical bids by fingerprint, not by which row is older", () => {
    const hA = fingerprint(newSalt(), "");
    const hB = fingerprint(newSalt(), "");
    const base = { creator: addr.creatorMain, amount: "10000000", status: 0, escrow: ESCROW };
    // On-chain order: B's bid got id 1, A's got id 2.
    const index = { [addr.bidderMain]: [{ ...base, id: "1", messageHash: hB }, { ...base, id: "2", messageHash: hA }] };
    const rowBase = { bidderAddress: addr.bidderMain, creatorAddress: addr.creatorMain, amountUsdc: "10000000", escrowAddress: null, onChainBidId: null };
    const rows = [
      { ...rowBase, id: "row-a", createdAt: "2026-10-01T00:00:00.000Z", messageHash: hA },
      { ...rowBase, id: "row-b", createdAt: "2026-10-02T00:00:00.000Z", messageHash: hB },
    ];
    const v = classifyOpenRows(rows, index);
    assert.deepEqual(v.get("row-a"), { kind: "linked", escrow: ESCROW, onChainBidId: "2" });
    assert.deepEqual(v.get("row-b"), { kind: "linked", escrow: ESCROW, onChainBidId: "1" });

    // Orphans: a closed row is reopened only against its own bid.
    const closed = [{ ...rowBase, id: "row-a", status: "refunded", createdAt: "2026-10-01T00:00:00.000Z", messageHash: hA }];
    const report = findOrphans(index, new Set(), closed);
    assert.deepEqual(report.reopen.map((r) => r.onChainBidId), ["2"]);
    assert.deepEqual(report.unmatched.map((u) => u.onChainBidId), ["1"]);
  });
});
