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
import { runLikeInngest } from "../helpers/inngest-replay.mts";

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
    const hour = (h: number) => Date.UTC(2026, 9, 31, h, 40);
    const quiet = recordingStep();
    const out = await health({ event: { data: {}, ts: hour(11) }, step: quiet.step } as never);
    assert.deepEqual(out.problems, []);
    assert.deepEqual(quiet.ids, []);

    const full = recordingStep();
    await health({ event: { data: {}, ts: hour(6) }, step: full.step } as never);
    assert.ok(full.ids.includes("prune-rate-limits") && full.ids.includes("snapshot") && full.ids.includes("evaluate"));
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
    const out = await health({ event: { data: {}, ts: Date.UTC(2026, 9, 31, 11, 40) }, step: s.step } as never);
    assert.ok((out.problems as string[]).length > 0);
    assert.deepEqual(s.ids, ["alert"]);
  });

  // ── Resumes: Inngest re-runs the function from the top after every step, so the
  //    read-only checks run again. A resumed run must never skip pending work. ──

  test("sweep resumed after every step still handles every pending row", async () => {
    const stuck = async () =>
      (
        await db
          .insert(bids)
          .values({
            bidderUserId: "00000000-0000-0000-0000-00000000000b",
            creatorUserId: "00000000-0000-0000-0000-00000000000c",
            bidderAddress: "0xb100000000000000000000000000000000000001",
            creatorAddress: "0xc100000000000000000000000000000000000001",
            amountUsdc: "5000000",
            status: "placing",
            createdAt: new Date(Date.now() - 45 * 60 * 1000),
          })
          .returning()
      )[0]!;
    const a = await stuck();
    const b = await stuck();
    const { executed } = await runLikeInngest(sweep, { data: {} });
    assert.deepEqual(executed.sort(), ["load-work", `placing-${a.id}`, `placing-${b.id}`].sort());
    const rows = await db.select({ status: bids.status }).from(bids);
    assert.ok(rows.every((r) => r.status === "failed"), "both stuck placements handled (never sent: failed, no USDC moved)");
  });

  test("refunds resumed after every claim: every expired bid claimed exactly once", async () => {
    const old = 3 * 24 * 3600 + 3600;
    const expired = [await seedEscrowedBid({ ageSeconds: old }), await seedEscrowedBid({ ageSeconds: old }), await seedEscrowedBid({ ageSeconds: old })];
    const { executed } = await runLikeInngest(refunds, { data: {} });
    for (const b of expired) assert.equal(executed.filter((s) => s === `refund-${b.id}-0`).length, 1);
    assert.equal(world.calls("claimRefund").length, 3);
  });

  test("a claim that fails mid-run doesn't stop the others, and isn't retried in a loop", async () => {
    const old = 3 * 24 * 3600 + 3600;
    const expired = [await seedEscrowedBid({ ageSeconds: old }), await seedEscrowedBid({ ageSeconds: old }), await seedEscrowedBid({ ageSeconds: old })];
    world.failNextSubmit = Object.assign(new Error("circle down"), { status: 503 });
    const { executed } = await runLikeInngest(refunds, { data: {} });
    assert.equal(executed.filter((s) => s.startsWith("refund-")).length, 3, "one attempt per bid this hour");
    assert.equal(world.calls("claimRefund").length, 2, "the other two were claimed");
    for (const b of expired) assert.ok(executed.includes(`refund-${b.id}-0`));
  });

  test("a bid settled elsewhere while the run waits is skipped; the rest still run", async () => {
    const old = 3 * 24 * 3600 + 3600;
    const [first, second] = [await seedEscrowedBid({ ageSeconds: old }), await seedEscrowedBid({ ageSeconds: old })];
    const { executed } = await runLikeInngest(refunds, { data: {} }, {
      between: async (last) => {
        // After the load step, the creator declines the second bid (it refunds by itself).
        if (last === "fetch-refundable-bids") await db.update(bids).set({ status: "rejected" }).where(eq(bids.id, second!.id));
      },
    });
    assert.ok(executed.includes(`refund-${first!.id}-0`), "the still-pending bid was claimed");
    assert.equal(world.calls("claimRefund").length >= 1, true);
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
