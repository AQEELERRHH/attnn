/**
 * The pure rules every money decision goes through. No database, no network.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
const { NextRequest } = await import("next/server");
const {
  ESCROW_MAX_BID,
  ESCROW_MIN_BID,
  parseAtomicUsdc,
  resolveAgentBidAmount,
  stableUuid,
  validateBidAmount,
  validateCreatorFloor,
} = await import("../../lib/bid-rules.ts");
const { REPLY_MIN_CHARS, manualReplySource, replyError, validateReplyTemplate } = await import("../../lib/reply-rules.ts");
const { AUTO_ACCEPT_OFF, autoAcceptCutoff, triageDecision, validateAutoAcceptSetting } = await import("../../lib/creator-agent-rules.ts");
const { normalizeTags, validateHandle, validateProfileFields } = await import("../../lib/profile-rules.ts");
const { computeChecklist, } = await import("../../lib/onboarding.ts");
const { sameOrigin } = await import("../../lib/http-guard.ts");
const { parseRequestId } = await import("../../lib/circle.ts");

type ChecklistInput = Parameters<typeof computeChecklist>[0];

describe("amounts", () => {
  test("atomic USDC parsing accepts whole non-negative units only", () => {
    assert.equal(parseAtomicUsdc("5000000"), BigInt(5_000_000));
    assert.equal(parseAtomicUsdc(" 7 "), BigInt(7));
    for (const bad of ["-1", "1.5", "1e6", "", "abc", -1, 1.5, Number.MAX_SAFE_INTEGER + 2, null, undefined, {}]) {
      assert.equal(parseAtomicUsdc(bad), null, String(bad));
    }
  });

  test("bids respect the creator's floor and the escrow limits", () => {
    assert.ok(validateBidAmount("10000000", "5000000").ok);
    assert.ok(!validateBidAmount("4999999", "5000000").ok);
    assert.ok(!validateBidAmount((ESCROW_MAX_BID + BigInt(1)).toString(), "5000000").ok);
    assert.ok(!validateBidAmount((ESCROW_MIN_BID - BigInt(1)).toString(), "0").ok);
    assert.ok(!validateCreatorFloor((ESCROW_MIN_BID - BigInt(1)).toString()).ok);
  });

  test("D3: the agent always bids the creator's floor, never more; above the cap it skips", () => {
    const r = (floor: string, cap = "20000000") => resolveAgentBidAmount({ creatorMinBid: floor, maxBidPerCreator: cap });
    assert.equal(r("5000000"), BigInt(5_000_000));
    assert.equal(r("20000000"), BigInt(20_000_000), "floor equal to the cap is allowed");
    assert.equal(r("30000000"), null, "floor above the bidder's cap → skip");
    assert.equal(r("5000000", "5000000000"), BigInt(5_000_000), "a cap above $1,000 doesn't raise anything");
  });

  test("operation keys map to stable, distinct UUIDs (Circle idempotency)", () => {
    assert.equal(stableUuid("settle:a:accept:0"), stableUuid("settle:a:accept:0"));
    assert.notEqual(stableUuid("settle:a:accept:0"), stableUuid("settle:a:accept:1"));
    assert.match(stableUuid("x"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("request ids must be UUIDs", () => {
    assert.ok(parseRequestId("6F1D2B8E-3C4A-4B5D-9E6F-7A8B9C0D1E2F"));
    for (const bad of ["", "abc", "6f1d2b8e3c4a4b5d9e6f7a8b9c0d1e2f", 5, null]) assert.equal(parseRequestId(bad), null);
  });
});

describe("replies", () => {
  test(`replies need at least ${REPLY_MIN_CHARS} characters`, () => {
    assert.ok(replyError("x".repeat(REPLY_MIN_CHARS - 1)));
    assert.equal(replyError("x".repeat(REPLY_MIN_CHARS)), null);
    assert.ok(!validateReplyTemplate("too short").ok);
    assert.equal(manualReplySource("same text", "same text"), "template");
    assert.equal(manualReplySource("my own words", "same text"), "creator");
  });
});

describe("creator agent: when it may accept for the creator", () => {
  test("existing creators keep the original cut-off of 8; 9, 10 and Off as set", () => {
    for (const v of [null, undefined, 0, 7, 8]) assert.equal(autoAcceptCutoff(v as number | null), 8);
    assert.equal(autoAcceptCutoff(10), 10);
    assert.equal(autoAcceptCutoff(AUTO_ACCEPT_OFF), null);
    for (const bad of [0, 7, 11, 8.5, "9"]) assert.ok(!validateAutoAcceptSetting(bad).ok);
  });

  test("decisions: accept only at or above the cut-off; strong bids below it are shown, never declined", () => {
    const counter = () => "7000000";
    const none = () => undefined;
    assert.equal(triageDecision(8, 8, none).decision, "accept");
    assert.equal(triageDecision(9, 10, counter).decision, "surface");
    assert.equal(triageDecision(10, null, counter).decision, "surface");
    assert.equal(triageDecision(6, 8, counter).decision, "counter_offer");
    assert.equal(triageDecision(6, 8, none).decision, "surface");
    assert.equal(triageDecision(4.9, 8, none).decision, "reject");
  });
});

describe("profiles", () => {
  test("tags are cleaned and capped at the registry's limit", () => {
    const ok = normalizeTags([" AI ", "ai", "Design", ""]);
    assert.deepEqual(ok.ok && ok.tags, ["ai", "design"]);
    assert.ok(!normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`)).ok);
    assert.ok(!normalizeTags(["x".repeat(33)]).ok);
    assert.ok(!normalizeTags("ai").ok);
  });

  test("handles are lower-cased and restricted", () => {
    const h = validateHandle(" @Amina_K ");
    assert.equal(h.ok && h.handle, "amina_k");
    for (const bad of ["a", "-start", "has space", "x".repeat(33), "emoji😀", 5]) assert.ok(!validateHandle(bad).ok, String(bad));
  });

  test("profile text is bounded; links must be https or ipfs", () => {
    assert.ok(!validateProfileFields({ bio: "x".repeat(501) }).ok);
    assert.ok(!validateProfileFields({ availabilityStatus: "sometimes" }).ok);
    assert.ok(!validateProfileFields({ profileURI: "javascript:alert(1)" }).ok);
    assert.ok(!validateProfileFields({ openTo: Array.from({ length: 11 }, (_, i) => `o${i}`) }).ok);
    assert.ok(validateProfileFields({ bio: "hi", openTo: ["Research"], availabilityStatus: "limited", profileURI: "https://a.b" }).ok);
  });
});

describe("onboarding checklist", () => {
  const base: ChecklistInput = {
    role: "bidder", hasWallet: true, walletUsdc: "0", agentWalletUsdc: null, minBid: BigInt(1_000_000), minBidLabel: "$1.00",
    placedStatuses: [], received: [], profile: null, hasAgent: false, isTestnet: true,
  };
  const open = (i: ChecklistInput) => computeChecklist(i).steps.filter((s) => !s.done).map((s) => s.id).join(",");

  test("steps tick themselves from real data", () => {
    assert.equal(open(base), "fund,first-bid");
    assert.equal(open({ ...base, walletUsdc: "1000000" }), "first-bid");
    assert.equal(open({ ...base, placedStatuses: ["failed"] }), "fund,first-bid", "a failed bid doesn't count");
    assert.ok(computeChecklist({ ...base, placedStatuses: ["accepted"] }).complete);
    const creator = computeChecklist({ ...base, role: "creator", profile: { registration: "active", avatarUrl: null }, received: [{ status: "accepted" }] });
    assert.ok(creator.complete, "the photo is optional");
  });
});

describe("request origin", () => {
  const req = (headers: Record<string, string>) =>
    new NextRequest("http://attnn.test/api/x", { method: "POST", headers: { host: "attnn.test", ...headers } });
  test("same-site and non-browser requests pass; other websites are blocked", () => {
    assert.equal(sameOrigin(req({ origin: "http://attnn.test", "sec-fetch-site": "same-origin" })), null);
    assert.equal(sameOrigin(req({})), null);
    assert.equal(sameOrigin(req({ origin: "https://evil.example" }))?.status, 403);
    assert.equal(sameOrigin(req({ "sec-fetch-site": "cross-site" }))?.status, 403);
    assert.equal(sameOrigin(req({ origin: "null" }))?.status, 403);
  });
});

describe("fingerprints (D1)", async () => {
  const { fingerprint, matchesFingerprint, newSalt, placeBidArgs, acceptBidArgs } = await import("../../lib/escrow.ts");
  const salt = `0x${"ab".repeat(32)}` as const;
  const text = "Naira ₦ reply, with unicode: café";

  test("match the contract byte for byte (same vector as contracts/test/AttnnEscrow.t.sol)", () => {
    assert.equal(fingerprint(salt, text), "0x353b97b4a5c624e72c31bbbe16cae6612611f3140c7e17e4635ec3734a7f6586");
  });

  test("check only the exact text with its salt; a malformed salt never matches", () => {
    const h = fingerprint(salt, text);
    assert.ok(matchesFingerprint(h, salt, text));
    assert.ok(!matchesFingerprint(h, salt, `${text} `));
    assert.ok(!matchesFingerprint(h, newSalt(), text));
    assert.ok(!matchesFingerprint(h, "0x1234", text));
    assert.ok(!matchesFingerprint(null, salt, text));
    assert.throws(() => fingerprint("0x12" as `0x${string}`, text), /32 bytes/);
  });

  test("salts are fresh 32-byte values", () => {
    const a = newSalt();
    assert.match(a, /^0x[0-9a-f]{64}$/);
    assert.notEqual(a, newSalt());
  });

  test("call arguments never carry text to a v2 escrow", () => {
    const placed = placeBidArgs(2, { creator: "0xc", amount: "5", message: "hello", messageSalt: salt });
    assert.deepEqual(placed, ["0xc", "5", fingerprint(salt, "hello")]);
    assert.deepEqual(placeBidArgs(2, { creator: "0xc", amount: "5", message: null, messageSalt: null })[2], `0x${"0".repeat(64)}`);
    assert.deepEqual(placeBidArgs(1, { creator: "0xc", amount: "5", message: "hello", messageSalt: salt }), ["0xc", "5", "", true]);
    assert.deepEqual(acceptBidArgs(2, "7", text, salt), ["7", fingerprint(salt, text)]);
    assert.deepEqual(acceptBidArgs(1, "7", text, salt), ["7", text]);
  });
});
