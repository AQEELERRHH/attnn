/**
 * The money health check after the Inngest usage change:
 *   - a quick check that throws fails the run (so Inngest retries it), and when retries
 *     run out onFailure emails an alert;
 *   - the daily full check runs whenever the run was SCHEDULED at 06:xx UTC, even if a
 *     retry or resume happens after 07:00;
 *   - an alert is sent once, however many times the run resumes.
 * lib/health and lib/alerts are replaced with controllable stand-ins.
 */
import "../helpers/env.mts";
import { after, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installFakes } from "../helpers/fakes.mts";
import { closeDb } from "../helpers/db.mts";
import { runLikeInngest } from "../helpers/inngest-replay.mts";

await installFakes();

const state = {
  quickThrows: null as Error | null,
  quick: { problems: [] as string[], notes: [] as string[] },
  fullCalls: [] as string[],
  alerts: [] as string[],
};
mock.module(pathToFileURL(path.resolve("lib/health.ts")).href, {
  namedExports: {
    BIDS_PER_STEP: 25,
    quickHealthCheck: async () => {
      if (state.quickThrows) throw state.quickThrows;
      return state.quick;
    },
    pruneRateLimits: async () => (state.fullCalls.push("prune"), 0),
    snapshotBlock: async () => (state.fullCalls.push("snapshot"), { blockNumber: "1", blockTime: 0 }),
    escrowBidCounts: async () => (state.fullCalls.push("counts"), [{ escrow: "0xe5c0000000000000000000000000000000000001", count: 30 }]),
    readEscrowBids: async (_e: string, from: number) => (state.fullCalls.push(`read-${from}`), []),
    evaluateFullHealth: async () => (state.fullCalls.push("evaluate"), { problems: [], notes: [] }),
  },
});
mock.module(pathToFileURL(path.resolve("lib/alerts.ts")).href, {
  namedExports: { sendAlert: async (subject: string) => (state.alerts.push(subject), "logged") },
});

const functions = await import("../../inngest/functions.ts");
const fn = (functions.moneyHealthCheck as unknown as { __fn: unknown[] }).__fn;
const config = fn[0] as { retries: number; onFailure: (ctx: { error: Error }) => Promise<void> };
const handler = fn[2] as Parameters<typeof runLikeInngest>[0];

const at = (hourUtc: number) => ({ name: "inngest/scheduled.timer", ts: Date.UTC(2026, 9, 31, hourUtc, 40), data: {} });

describe("money health check", () => {
  beforeEach(() => {
    state.quickThrows = null;
    state.quick = { problems: [], notes: [] };
    state.fullCalls.length = 0;
    state.alerts.length = 0;
  });
  after(closeDb);

  test("a transient failure fails the run so Inngest retries it, and the final failure emails an alert", async () => {
    assert.ok(config.retries >= 1, "retries are on");
    state.quickThrows = new Error("database timeout");
    await assert.rejects(runLikeInngest(handler, at(11)), /database timeout/);
    assert.deepEqual(state.alerts, [], "no 'all clear' and no partial alert");

    await config.onFailure({ error: new Error("database timeout") });
    assert.deepEqual(state.alerts, ["Money health check failed to run"]);
  });

  test("the retry after a transient failure completes normally", async () => {
    state.quickThrows = new Error("database timeout");
    await assert.rejects(runLikeInngest(handler, at(11)));
    state.quickThrows = null;
    const { output, executed } = await runLikeInngest(handler, at(11));
    assert.deepEqual(executed, [], "a clean hour: no steps, one execution");
    assert.deepEqual((output as { problems: string[] }).problems, []);
  });

  test("the 06:40 run is always the full check, even when it resumes after 07:00", async () => {
    // Whatever the wall clock says while it runs, the scheduled time decides.
    const { output, executed } = await runLikeInngest(handler, at(6));
    assert.equal((output as { full: boolean }).full, true);
    assert.deepEqual(executed, ["prune-rate-limits", "snapshot", "bid-counts", "read-e5c00000-1", "read-e5c00000-26", "evaluate"]);
    assert.deepEqual(state.fullCalls, ["prune", "snapshot", "counts", "read-1", "read-26", "evaluate"]);
  });

  test("other hours never run the full check; a manual { full: true } always does", async () => {
    assert.equal(((await runLikeInngest(handler, at(7))).output as { full: boolean }).full, false);
    assert.deepEqual(state.fullCalls, []);
    const manual = await runLikeInngest(handler, { name: "attnn/admin.health-check", ts: Date.UTC(2026, 9, 31, 15, 0), data: { full: true } });
    assert.equal((manual.output as { full: boolean }).full, true);
    assert.ok(manual.executed.includes("evaluate") && manual.executed.includes("all-clear"));
  });

  test("an hourly problem is alerted at once, exactly once", async () => {
    state.quick = { problems: ["1 bid stuck placing"], notes: [] };
    const { executed, invocations } = await runLikeInngest(handler, at(11));
    assert.deepEqual(executed, ["alert"]);
    assert.deepEqual(state.alerts, ["1 money problem(s) need attention"]);
    assert.equal(invocations, 2, "the alert step, then the resume that finishes");
  });

  test("a full run never alerts twice, however many times it resumes", async () => {
    state.quick = { problems: ["1 bid stuck placing"], notes: [] };
    const { executed } = await runLikeInngest(handler, at(6));
    assert.equal(executed.filter((s) => s === "alert").length, 1);
    assert.equal(state.alerts.length, 1);
  });
});
