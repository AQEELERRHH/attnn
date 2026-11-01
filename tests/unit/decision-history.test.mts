/** Decision History grouping and filters (lib/decision-history.ts), and sub-cent money: pure. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:9/none";

const { groupRuns, filterRuns, LEGACY_GAP_MS } = await import("../../lib/decision-history.ts");
const { formatMoney } = await import("../../lib/format.ts");

const t0 = Date.UTC(2026, 10, 1, 12, 0, 0);
let n = 0;
const row = (action: string, data: Record<string, unknown>, atMs: number) => ({ id: `r${++n}`, action, data, createdAt: new Date(atMs).toISOString() });
const scored = (creator: string, decision: string, extra: Record<string, unknown> = {}) => ({ creator, decision, reason: `${decision} because`, ...extra });

describe("groupRuns", () => {
  test("rows with the same runId are one run, newest run first", () => {
    const runs = groupRuns([
      row("creator_discovered", { runId: "a", count: 2, evaluated: 2, qualified: 1, attempted: 1, queued: 1 }, t0),
      row("creator_scored", { runId: "a", ...scored("amina", "BID_QUEUED", { score: 8, amount: "5000000" }) }, t0 + 100),
      row("creator_scored", { runId: "a", ...scored("bo", "SKIPPED", { score: 3 }) }, t0 + 200),
      row("creator_discovered", { runId: "b", count: 1, evaluated: 1, qualified: 0, attempted: 0, queued: 0 }, t0 + 60_000),
      row("creator_scored", { runId: "b", ...scored("cy", "SKIPPED", { score: 2 }) }, t0 + 60_100),
    ]);
    assert.deepEqual(runs.map((r) => r.id), ["b", "a"]);
    assert.deepEqual(runs[1]!.summary, { found: 2, evaluated: 2, qualified: 1, attempted: 1, queued: 1, unscored: 0, readSpend: null });
    assert.deepEqual(runs[1]!.decisions.map((d) => [d.creator, d.decision, d.score, d.amount]), [
      ["amina", "BID_QUEUED", 8, "5000000"],
      ["bo", "SKIPPED", 3, null],
    ]);
  });

  test("older rows without a runId are grouped by time (a long gap starts a new run)", () => {
    const runs = groupRuns([
      row("creator_discovered", { count: 1, scored: 1, bidsPlaced: 0 }, t0),
      row("creator_scored", { creator: "amina", score: 5 }, t0 + 1_000),
      row("creator_scored", { creator: "bo", score: 4 }, t0 + LEGACY_GAP_MS + 5_000),
    ]);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]!.decisions[0]!.creator, "amina");
    assert.equal(runs[1]!.decisions[0]!.decision, null, "no decision record on old rows: score only");
    assert.equal(runs[1]!.summary!.queued, 0);
    assert.equal(runs[0]!.decisions[0]!.creator, "bo");
  });

  test("a stopped run shows why; an error row without a runId isn't part of any run", () => {
    const runs = groupRuns([
      row("agent_stopped", { runId: "s", reason: "Daily budget reached" }, t0),
      row("error", { error: "creator agent: triage failed" }, t0 + 10),
      row("error", { runId: "e", error: "The run stopped on an unexpected error after queuing 1 bid: boom" }, t0 + 5_000),
      row("creator_discovered", { runId: "e", count: 2, queued: 1, stoppedEarly: true }, t0 + 5_001),
    ]);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]!.stopReason, "Daily budget reached");
    assert.equal(runs[0]!.stoppedEarly, true);
    assert.match(runs[0]!.error!, /after queuing 1 bid/);
  });

  test("Ask again goes on each creator's newest scored decision only", () => {
    const runs = groupRuns([
      row("creator_scored", { runId: "a", ...scored("amina", "SKIPPED", { score: 6, scoreKey: "k1" }) }, t0),
      row("creator_scored", { runId: "b", ...scored("AMINA", "SKIPPED", { score: 6, scoreKey: "k1", scoreSource: "cache" }) }, t0 + 60_000),
      row("creator_scored", { runId: "b", ...scored("bo", "SKIPPED", { reason: "Couldn't read the profile" }) }, t0 + 60_001),
      row("creator_scored", { runId: "b", ...scored("cy", "SKIPPED", { score: 2, scoreKey: "k2", rescoreRequestedAt: new Date(t0).toISOString() }) }, t0 + 60_002),
    ]);
    const [newest, older] = runs;
    const by = (r: typeof newest, c: string) => r!.decisions.find((d) => d.creator.toLowerCase() === c)!;
    assert.equal(by(newest, "amina").canAskAgain, true);
    assert.equal(by(older, "amina").canAskAgain, false, "older score of the same creator");
    assert.equal(by(newest, "bo").canAskAgain, false, "nothing was scored");
    assert.equal(by(newest, "cy").canAskAgain, false);
    assert.equal(by(newest, "cy").freshScoreRequested, true);
  });

  test("profile read cost and reused scores come through", () => {
    const [run] = groupRuns([
      row("creator_scored", { runId: "a", ...scored("amina", "SKIPPED", { score: 6, profile: "x402", x402: { amount: "1000", transaction: "t" } }) }, t0),
      row("creator_scored", { runId: "a", ...scored("bo", "SKIPPED", { score: 6, profile: "x402_earlier", scoreSource: "cache", scoredAt: "2026-10-30T00:00:00.000Z" }) }, t0 + 1),
    ]);
    assert.deepEqual(run!.decisions[0]!.read, { kind: "paid", amount: "1000" });
    assert.deepEqual(run!.decisions[1]!.read, { kind: "earlier" });
    assert.equal(run!.decisions[1]!.scoreSource, "cache");
    assert.equal(run!.decisions[1]!.scoredAt, "2026-10-30T00:00:00.000Z");
  });

  test("keeps at most maxRuns runs", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row("agent_stopped", { runId: `r-${i}`, reason: "x" }, t0 + i * 1000));
    assert.equal(groupRuns(rows, 3).length, 3);
  });
});

describe("filterRuns", () => {
  const runs = groupRuns([
    row("creator_scored", { runId: "a", ...scored("amina", "BID_QUEUED", { score: 8 }) }, t0),
    row("creator_scored", { runId: "a", ...scored("bo", "BLOCKED", { score: 7 }) }, t0 + 1),
    row("creator_scored", { runId: "b", ...scored("bo", "SKIPPED", { score: 3 }) }, t0 + 60_000),
  ]);

  test("by decision: only matching decisions, runs left empty are dropped", () => {
    const blocked = filterRuns(runs, { decision: "BLOCKED", creator: "" });
    assert.equal(blocked.length, 1);
    assert.deepEqual(blocked[0]!.decisions.map((d) => d.creator), ["bo"]);
  });

  test("by creator: case-insensitive, @ optional, across runs", () => {
    const bo = filterRuns(runs, { decision: "all", creator: "@BO" });
    assert.equal(bo.length, 2);
    assert.ok(bo.every((r) => r.decisions.every((d) => d.creator === "bo")));
  });

  test("no filter: unchanged", () => {
    assert.equal(filterRuns(runs, { decision: "all", creator: " " }), runs);
  });
});

describe("formatMoney under a cent", () => {
  test("shows the exact amount instead of $0.00", () => {
    assert.equal(formatMoney("1000"), "$0.001");
    assert.equal(formatMoney("50"), "$0.00005");
    assert.equal(formatMoney(BigInt(-1000)), "-$0.001");
  });
  test("a cent and up, and zero, are unchanged", () => {
    assert.equal(formatMoney("10000"), "$0.01");
    assert.equal(formatMoney("5000000"), "$5.00");
    assert.equal(formatMoney("0"), "$0.00");
  });
});
