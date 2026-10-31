/**
 * Inngest bills every step. The timed jobs (sweep every 10 min, refunds hourly, health
 * check hourly, agents every 30 min) mostly find nothing to do, so an idle run must end
 * before its first step, while real work still runs step by step exactly as before.
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world } from "../helpers/fakes.mts";
import { closeDb, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";

await installFakes();

const { db } = await import("../../lib/db/client.ts");
const { bids, bidderConfigs } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const functions = await import("../../inngest/functions.ts");
const lifecycle = await import("../../inngest/bid-lifecycle.ts");

type Handler = (ctx: { event: { data: unknown }; step: unknown }) => Promise<Record<string, unknown>>;
const handler = (fn: unknown) => (fn as { __fn: unknown[] }).__fn[2] as Handler;
const sweep = handler(lifecycle.sweepInFlightBids);
const refunds = handler(functions.autoRefund);
const health = handler(functions.moneyHealthCheck);
const agents = handler(functions.runActiveBidders);

/** A fake Inngest step that records every step it runs. */
function recordingStep() {
  const ids: string[] = [];
  return {
    ids,
    step: {
      run: async (id: string, fn: () => unknown) => {
        ids.push(id);
        return fn();
      },
      sleep: async () => {},
      sendEvent: async () => {},
    },
  };
}

describe("timed jobs: idle runs cost one execution", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    await truncateAll();
    await seedMarket();
    // The seeded agent is off unless a test switches it on.
    await db.update(bidderConfigs).set({ isActive: false });
  });
  after(closeDb);

  test("sweep with nothing in flight: no steps", async () => {
    const s = recordingStep();
    assert.deepEqual(await sweep({ event: { data: {} }, step: s.step }), { idle: true });
    assert.deepEqual(s.ids, []);
  });

  test("sweep with a stuck placement: one load step, then that bid, as before", async () => {
    const [row] = await db
      .insert(bids)
      .values({
        bidderUserId: "00000000-0000-0000-0000-00000000000b",
        creatorUserId: "00000000-0000-0000-0000-00000000000c",
        bidderAddress: "0xb100000000000000000000000000000000000001",
        creatorAddress: "0xc100000000000000000000000000000000000001",
        amountUsdc: "5000000",
        status: "placing",
        createdAt: new Date(Date.now() - 45 * 60 * 1000), // no Circle id after 30 min
      })
      .returning();
    const s = recordingStep();
    const out = await sweep({ event: { data: {} }, step: s.step });
    assert.deepEqual(s.ids, ["load-work", `placing-${row!.id}`]);
    assert.equal(out.failed, 1, "never sent to Circle: failed, no USDC moved");
  });

  test("refunds with nothing expired: no steps", async () => {
    await seedEscrowedBid({ ageSeconds: 60 }); // escrowed a minute ago: not refundable
    const s = recordingStep();
    const out = await refunds({ event: { data: {} }, step: s.step });
    assert.equal(out.idle, true);
    assert.deepEqual(s.ids, []);
  });

  test("refunds with an expired bid: claimed from the bidder's wallet, as before", async () => {
    const bid = await seedEscrowedBid({ ageSeconds: 3 * 24 * 3600 + 3600 });
    const s = recordingStep();
    const out = await refunds({ event: { data: {} }, step: s.step });
    assert.deepEqual(s.ids, ["fetch-refundable-bids", `refund-${bid.id}-0`]);
    assert.equal(out.submitted, 1);
    assert.equal(world.calls("claimRefund").length, 1);
  });

  test("hourly health check with nothing wrong: no steps; the daily full check still runs", async () => {
    const quiet = recordingStep();
    const out = await health({ event: { data: {} }, step: quiet.step });
    assert.deepEqual(out.problems, []);
    assert.deepEqual(quiet.ids, []);

    const full = recordingStep();
    await health({ event: { data: { full: true } }, step: full.step });
    assert.ok(full.ids.includes("quick") && full.ids.includes("prune-rate-limits") && full.ids.includes("evaluate"));
  });

  test("hourly health check with a problem: checked in a step and alerted", async () => {
    await db.insert(bids).values({
      bidderUserId: "00000000-0000-0000-0000-00000000000b",
      creatorUserId: "00000000-0000-0000-0000-00000000000c",
      bidderAddress: "0xb100000000000000000000000000000000000001",
      creatorAddress: "0xc100000000000000000000000000000000000001",
      amountUsdc: "5000000",
      status: "placing",
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });
    const s = recordingStep();
    const out = await health({ event: { data: {} }, step: s.step });
    assert.ok((out.problems as string[]).length > 0);
    assert.deepEqual(s.ids, ["quick", "alert"]);
  });

  test("agents with none switched on: no steps", async () => {
    const s = recordingStep();
    const out = await agents({ event: { data: {} }, step: s.step });
    assert.equal(out.message, "No active bidders");
    assert.deepEqual(s.ids, []);
  });

  test("agents switched on: each still runs in its own step", async () => {
    await db.update(bidderConfigs).set({ isActive: true }).where(eq(bidderConfigs.userId, "00000000-0000-0000-0000-00000000000b"));
    const s = recordingStep();
    await agents({ event: { data: {} }, step: s.step });
    assert.deepEqual(s.ids, ["fetch-active-bidders", "run-bidder-00000000-0000-0000-0000-00000000000b"]);
  });
});
