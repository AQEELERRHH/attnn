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

  test("flags stuck placements, stuck and failed settlements; notes the pause switch", async () => {
    const stuck = await seedEscrowedBid();
    await db
      .update(bids)
      .set({ settlementTxHash: "tx-old", settlementAction: "accept", settlementSubmittedAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(bids.id, stuck.id));
    const failed = await seedEscrowedBid();
    await db.update(bids).set({ failReason: "accept failed: FAILED" }).where(eq(bids.id, failed.id));
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
    assert.match(text, /failed settlement/);
    assert.match(r.notes.join("\n"), /PAUSED/);
  });
});
