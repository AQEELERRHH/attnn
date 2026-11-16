/** Platform totals windows and the headline window choice (lib/market.ts): pure. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:9/none";

const { computePlatformTotals, settledHeadline } = await import("../../lib/market.ts");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 10, 16, 12, 0, 0);
let n = 0;

/** A bid settled `agoMs` before now. Cleared = accepted with an on-chain settlement hash. */
const bid = (status: "accepted" | "refunded" | "pending", amount: number, agoMs: number, opts: { hash?: boolean } = {}) => ({
  id: `b${++n}`,
  creatorUserId: "c1",
  bidderUserId: "u1",
  bidderAddress: "0xabc",
  amountUsdc: String(amount * 1_000_000),
  status,
  createdAt: new Date(now - agoMs - HOUR),
  settledAt: status === "pending" ? null : new Date(now - agoMs),
  settlementOnChainTxHash: status === "accepted" && opts.hash !== false ? `0x${n}` : null,
  settlementTxHash: null,
  replySource: null,
  replyRating: null,
});

describe("computePlatformTotals windows", () => {
  test("splits cleared bids and refunds into 24h, 7d and all time", () => {
    const t = computePlatformTotals(
      [
        bid("accepted", 5, 2 * HOUR),
        bid("accepted", 10, 3 * DAY),
        bid("accepted", 20, 30 * DAY),
        bid("accepted", 99, HOUR, { hash: false }), // marked accepted, never proven on-chain: not counted
        bid("refunded", 7, 5 * HOUR),
        bid("refunded", 7, 10 * DAY),
        bid("pending", 3, 0),
      ],
      now,
    );
    assert.equal(t.settled24hUsdc, "5000000");
    assert.equal(t.cleared24h, 1);
    assert.equal(t.refunded24h, 1);
    assert.equal(t.settled7dUsdc, "15000000");
    assert.equal(t.cleared7d, 2);
    assert.equal(t.refunded7d, 1);
    assert.equal(t.settledAllUsdc, "35000000");
    assert.equal(t.clearedAll, 3);
    assert.equal(t.refundedAll, 2);
    assert.equal(t.openEscrowUsdc, "3000000");
  });
});

describe("settledHeadline", () => {
  const totals = (bids: ReturnType<typeof bid>[]) => computePlatformTotals(bids, now);

  test("uses the last 24h when anything settled in it", () => {
    const h = settledHeadline(totals([bid("accepted", 5, 2 * HOUR), bid("accepted", 10, 3 * DAY)]));
    assert.deepEqual(h, { window: "24h", settledUsdc: "5000000", cleared: 1, refunded: 0 });
  });

  test("a quiet day widens to 7 days instead of showing zero", () => {
    const h = settledHeadline(totals([bid("accepted", 10, 3 * DAY), bid("refunded", 4, 2 * DAY)]));
    assert.deepEqual(h, { window: "7d", settledUsdc: "10000000", cleared: 1, refunded: 1 });
  });

  test("a quiet week widens to all time", () => {
    const h = settledHeadline(totals([bid("accepted", 20, 30 * DAY)]));
    assert.deepEqual(h, { window: "all", settledUsdc: "20000000", cleared: 1, refunded: 0 });
  });

  test("with nothing ever settled it stays on 24h and shows the zeros", () => {
    const h = settledHeadline(totals([bid("pending", 3, 0), bid("refunded", 4, 2 * HOUR)]));
    assert.deepEqual(h, { window: "24h", settledUsdc: "0", cleared: 0, refunded: 1 });
  });
});
