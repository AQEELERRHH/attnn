import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world, escrowBid } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();
const { db } = await import("../../lib/db/client.ts");
const { bids, appSettings } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { quickHealthCheck, fullHealthCheck } = await import("../../lib/health.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");

describe("money health check", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    await truncateAll();
    await seedMarket();
  });
  after(closeDb);

  test("all clear when the escrow holds exactly what its open bids are owed", async () => {
    await seedEscrowedBid({ amount: BigInt(10_000_000) });
    await seedEscrowedBid({ amount: BigInt(5_000_000) });
    world.usdc.set(ESCROW, BigInt(15_000_000));
    assert.deepEqual((await fullHealthCheck()).problems, []);
    assert.deepEqual((await quickHealthCheck()).problems, []);
  });

  test("flags an escrow that holds less than it owes", async () => {
    await seedEscrowedBid({ amount: BigInt(10_000_000) });
    world.usdc.set(ESCROW, BigInt(9_000_000));
    const r = await fullHealthCheck();
    assert.match(r.problems.join("\n"), /ESCROW SHORTFALL/);
  });

  test("flags USDC escrowed on-chain with no open row (nobody could reply or refund it)", async () => {
    escrowBid({ bidder: addr.bidderMain, creator: addr.creatorMain, amount: BigInt(7_000_000) });
    world.usdc.set(ESCROW, BigInt(7_000_000));
    const r = await fullHealthCheck();
    assert.match(r.problems.join("\n"), /Pending on-chain with no open row/);
  });

  test("flags an open row with no bid on-chain", async () => {
    const b = await seedEscrowedBid({ amount: BigInt(10_000_000) });
    world.escrowBids.clear();
    world.usdc.set(ESCROW, BigInt(0));
    const r = await fullHealthCheck();
    assert.match(r.problems.join("\n"), new RegExp(b.id));
  });

  test("flags stuck placements and stuck settlements; notes the pause switch", async () => {
    const stuck = await seedEscrowedBid();
    await db
      .update(bids)
      .set({ settlementTxHash: "tx-old", settlementAction: "accept", settlementSubmittedAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(bids.id, stuck.id));
    await db.insert(bids).values({
      bidderUserId: ids.bidder,
      creatorUserId: ids.creator,
      bidderAddress: addr.bidderMain,
      creatorAddress: addr.creatorMain,
      amountUsdc: "5000000",
      status: "placing",
      escrowAddress: ESCROW,
      createdAt: new Date(Date.now() - 2 * 3600_000),
    });
    await db.insert(appSettings).values({ key: "bids_paused", value: true });
    clearSettingsCache();
    const r = await quickHealthCheck();
    const text = r.problems.join("\n");
    assert.match(text, /still "placing"/);
    assert.match(text, /in flight for over an hour/);
    assert.match(r.notes.join("\n"), /PAUSED/);
  });

  test("a bid settled while the check ran isn't reported as an orphan", async () => {
    const b = await seedEscrowedBid({ amount: BigInt(8_000_000) });
    world.usdc.set(ESCROW, BigInt(8_000_000));
    world.blockTimeMs = Date.now() - 60_000; // the snapshot block is a minute old...
    // ...and since then the bid was accepted in the database (still Pending at the block).
    await db.update(bids).set({ status: "accepted", settledAt: new Date(), settlementOnChainTxHash: "0xabc" }).where(eq(bids.id, b.id));
    assert.deepEqual((await fullHealthCheck()).problems, []);
  });

  test("failed settlements are reported by the daily check, not the hourly one", async () => {
    const failed = await seedEscrowedBid();
    world.usdc.set(ESCROW, BigInt(10_000_000));
    await db.update(bids).set({ failReason: "accept failed: FAILED" }).where(eq(bids.id, failed.id));
    assert.equal((await quickHealthCheck()).problems.length, 0);
    assert.match((await fullHealthCheck()).problems.join("\n"), /failed settlement/);
  });

  // ── D5: the escrow's admin is watched ──
  test("D5: alerts when the escrow is paused on-chain, owned by someone unexpected, or a handover is open", async () => {
    process.env.ATTN_ESCROW_ADMIN = world.escrowOwner;
    try {
      assert.deepEqual((await quickHealthCheck()).problems, [], "expected owner, not paused: quiet");

      world.escrowPaused = true;
      assert.match((await quickHealthCheck()).problems.join("\n"), /PAUSED on-chain/);
      world.escrowPaused = false;

      world.escrowOwner = "0x00000000000000000000000000000000000000ee";
      assert.match((await quickHealthCheck()).problems.join("\n"), /not ATTN_ESCROW_ADMIN/);
      world.escrowOwner = process.env.ATTN_ESCROW_ADMIN!;

      world.escrowPendingOwner = "0x00000000000000000000000000000000000000ee";
      assert.match((await quickHealthCheck()).problems.join("\n"), /handover/);
    } finally {
      delete process.env.ATTN_ESCROW_ADMIN;
    }
  });

  test("D5: without ATTN_ESCROW_ADMIN the owner isn't checked, and the report says so", async () => {
    delete process.env.ATTN_ESCROW_ADMIN;
    const r = await quickHealthCheck();
    assert.deepEqual(r.problems, []);
    assert.match(r.notes.join("\n"), /ATTN_ESCROW_ADMIN is not set/);
  });
});
