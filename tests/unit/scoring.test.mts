/** The bidder agent's score cache key (lib/ai.ts scoreCacheKey): pure, no network. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:9/none";

const { scoreCacheKey } = await import("../../lib/ai.ts");

const amina = { handle: "amina", bio: "I build Solidity tooling", tags: ["web3", "ai"] };

describe("score cache key", () => {
  test("the same profile and goal always give the same key", () => {
    assert.equal(scoreCacheKey(amina, "find developers"), scoreCacheKey({ ...amina }, "find developers"));
  });

  test("the floor price is not part of it: a price change never changes the score", () => {
    const withFloor = { ...amina, minBid: "5000000" } as typeof amina;
    const otherFloor = { ...amina, minBid: "20000000" } as typeof amina;
    assert.equal(scoreCacheKey(withFloor, "find developers"), scoreCacheKey(otherFloor, "find developers"));
  });

  test("tag order, tag case and spacing in the goal don't matter", () => {
    assert.equal(
      scoreCacheKey({ ...amina, tags: ["AI", "web3"] }, "  find   developers "),
      scoreCacheKey(amina, "find developers"),
    );
  });

  test("a new goal, bio or tag set is a new key (so a fresh score)", () => {
    const base = scoreCacheKey(amina, "find developers");
    assert.notEqual(scoreCacheKey(amina, "find designers"), base);
    assert.notEqual(scoreCacheKey({ ...amina, bio: "I paint" }, "find developers"), base);
    assert.notEqual(scoreCacheKey({ ...amina, tags: ["web3"] }, "find developers"), base);
    assert.notEqual(scoreCacheKey({ ...amina, handle: "other" }, "find developers"), base);
  });

  test("an empty bio and a missing bio are the same input", () => {
    assert.equal(scoreCacheKey({ ...amina, bio: null }, "g"), scoreCacheKey({ ...amina, bio: "" }, "g"));
  });
});
