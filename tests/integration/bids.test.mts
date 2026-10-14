import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world, bidPlacedLog, bidAcceptedLog } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();
const { db } = await import("../../lib/db/client.ts");
const { bids, appSettings } = await import("../../lib/db/schema.ts");
const { BidError, createBidIntent, finalizePlacement, finalizeSettlement, submitSettlement } = await import("../../lib/bids.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const { fingerprint } = await import("../../lib/escrow.ts");
const { eq } = await import("drizzle-orm");

const REPLY = "Thanks for your bid. Here is a considered answer to your question, with enough detail to be genuinely useful to you.";
const row = async (id: string) => (await db.query.bids.findFirst({ where: eq(bids.id, id) }))!;

describe("bids: placement, settlement and the races around them", () => {
  before(async () => {
    await resetDatabase();
  });
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    await truncateAll();
    await seedMarket();
  });
  after(closeDb);

  // ── Placement ──
  test("a valid bid is recorded as placing and queued; nothing is sent to Circle yet", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000", message: "hi" });
    assert.equal(bid.status, "placing");
    assert.equal(bid.escrowAddress, ESCROW);
    assert.equal(bid.bidderAddress, addr.bidderMain);
    assert.equal(world.txs.length, 0);
    assert.deepEqual(world.events.map((e) => e.name), ["attnn/bid.requested"]);
  });

  test("bids are refused: below the creator's floor, on yourself, without enough USDC, while paused", async () => {
    await assert.rejects(
      createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "4999999" }),
      (e: unknown) => e instanceof BidError,
    );
    await assert.rejects(createBidIntent({ bidderUserId: ids.creator, creatorUserId: ids.creator, amountUsdc: "10000000" }), /yourself/);
    world.usdc.set(addr.bidderMain, BigInt(10_000_000)); // not more than the bid: gas needs a little extra
    await assert.rejects(createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" }), /Not enough USDC/);
    world.usdc.set(addr.bidderMain, BigInt(100_000_000));
    await db.insert(appSettings).values({ key: "bids_paused", value: true });
    clearSettingsCache();
    await assert.rejects(createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" }), /paused/);
    assert.equal((await db.select().from(bids)).length, 0, "no bid row was written for any refusal");
  });

  test("finalizePlacement reads the bid id from the BidPlaced log, and only one caller wins", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    const { executeContractCallOnce } = await import("../../lib/circle.ts");
    const { escrowAbi } = await import("../../lib/arc.ts");
    const { txId } = await executeContractCallOnce({
      walletId: "w-bidder-main",
      contractAddress: ESCROW,
      abi: escrowAbi,
      functionName: "placeBid",
      args: [],
      opKey: `place:${bid.id}`,
    });
    await db.update(bids).set({ bidTxHash: txId }).where(eq(bids.id, bid.id));
    assert.equal(await finalizePlacement(bid.id), "in_flight");
    world.complete(txId, [bidPlacedLog(ESCROW, BigInt(7), addr.bidderMain, addr.creatorMain, BigInt(10_000_000))]);
    const outcomes = await Promise.all([finalizePlacement(bid.id), finalizePlacement(bid.id), finalizePlacement(bid.id)]);
    assert.equal(outcomes.filter((o) => o === "escrowed").length, 1);
    const r = await row(bid.id);
    assert.equal(r.status, "pending");
    assert.equal(r.onChainBidId, "7");
  });

  test("a placement whose receipt has no matching BidPlaced log fails without claiming funds moved", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    const { executeContractCallOnce } = await import("../../lib/circle.ts");
    const { escrowAbi } = await import("../../lib/arc.ts");
    const { txId } = await executeContractCallOnce({ walletId: "w-bidder-main", contractAddress: ESCROW, abi: escrowAbi, functionName: "placeBid", args: [], opKey: `place:${bid.id}` });
    await db.update(bids).set({ bidTxHash: txId }).where(eq(bids.id, bid.id));
    // A log for a different creator must not be taken as this bid.
    world.complete(txId, [bidPlacedLog(ESCROW, BigInt(9), addr.bidderMain, "0x0000000000000000000000000000000000000abc", BigInt(10_000_000))]);
    assert.equal(await finalizePlacement(bid.id), "failed");
    assert.equal((await row(bid.id)).status, "failed");
  });

  // ── Settlement ──
  test("only the creator can accept or decline, only the bidder can refund", async () => {
    const bid = await seedEscrowedBid();
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.bidder, reply: REPLY }), /Only the creator/);
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "reject", actorUserId: ids.other }), /Only the creator/);
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "refund", actorUserId: ids.creator }), /Only the bidder/);
    assert.equal(world.txs.length, 0);
  });

  test("a too-short reply is refused before anything is sent", async () => {
    const bid = await seedEscrowedBid();
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: "ok thanks" }), /100/);
    assert.equal(world.txs.length, 0);
  });

  test("accept: one Circle call even when clicked five times at once; reply saved with the reservation", async () => {
    const bid = await seedEscrowedBid();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY })),
    );
    assert.ok(results.some((r) => r.status === "fulfilled"));
    assert.equal(world.calls("acceptBid").length, 1, "exactly one acceptBid reached Circle");
    const r = await row(bid.id);
    assert.equal(r.reply, REPLY);
    assert.equal(r.settlementAction, "accept");
    assert.equal(r.status, "pending", "still pending until Arc confirms");
  });

  test("L2: two accepts racing with different replies: the saved reply is the one sent on-chain", async () => {
    const bid = await seedEscrowedBid();
    const other = REPLY.replace("considered", "careful");
    await Promise.allSettled([
      submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY }),
      submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: other }),
    ]);
    const sent = world.calls("acceptBid");
    assert.equal(sent.length, 1);
    const r = await row(bid.id);
    // v2 sends the fingerprint of exactly the saved reply.
    assert.equal(sent[0]!.args[1], fingerprint(r.replySalt as `0x${string}`, r.reply!));
  });

  test("accept and decline racing: only one settlement ever reaches Circle", async () => {
    const bid = await seedEscrowedBid();
    await Promise.allSettled([
      submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY }),
      submitSettlement({ bidId: bid.id, action: "reject", actorUserId: ids.creator }),
      submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY }),
      submitSettlement({ bidId: bid.id, action: "reject", actorUserId: ids.creator }),
    ]);
    assert.equal(world.calls("acceptBid").length + world.calls("rejectBid").length, 1);
  });

  test("a Circle outage keeps the reservation until the 5-minute check proves nothing was sent", async () => {
    const bid = await seedEscrowedBid();
    world.failNextSubmit = new Error("circle down");
    await assert.rejects(
      submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY }),
      (e: unknown) => e instanceof BidError && e.status === 503 && /Couldn't confirm/.test(e.message),
    );
    let r = await row(bid.id);
    assert.match(r.settlementTxHash ?? "", /^reserved:/, "kept: the request may have reached Circle");
    // Nothing else can settle it meanwhile.
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "reject", actorUserId: ids.creator }), /already confirming/);
    // 5 minutes later Circle has no transaction for it: released, with no reply left behind.
    await db.update(bids).set({ settlementTxHash: `reserved:${Date.now() - 6 * 60_000}` }).where(eq(bids.id, bid.id));
    assert.equal(await finalizeSettlement(bid.id), "failed");
    r = await row(bid.id);
    assert.equal(r.settlementTxHash, null);
    assert.equal(r.settlementAction, null);
    assert.equal(r.reply, null);
    // ...and a retry goes through
    await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    assert.equal(world.calls("acceptBid").length, 1);
  });

  test("a request Circle refused outright (4xx) is released at once", async () => {
    const bid = await seedEscrowedBid();
    world.failNextSubmit = Object.assign(new Error("invalid request"), { status: 400 });
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY }), /invalid request/);
    const r = await row(bid.id);
    assert.equal(r.settlementTxHash, null);
    assert.equal(r.reply, null);
    await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    assert.equal(world.calls("acceptBid").length, 1);
  });

  test("finalizeSettlement: never final without a chain hash; COMPLETE with hash → accepted and verified", async () => {
    const bid = await seedEscrowedBid();
    const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    const tx = world.txs.find((t) => t.id === txId)!;
    tx.state = "COMPLETE"; // COMPLETE but Circle hasn't reported the hash yet
    assert.equal(await finalizeSettlement(bid.id), "in_flight");
    assert.equal((await row(bid.id)).status, "pending");
    world.complete(txId, [bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, tx.args[1] as `0x${string}`)]);
    assert.equal(await finalizeSettlement(bid.id), "settled");
    const r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.ok(r.settlementOnChainTxHash, "earnings only count settlements with a chain hash");
    assert.equal(r.reply, REPLY, "the reply matching the on-chain fingerprint is kept");
  });

  test("a failed settlement goes back to pending with a reason, a new attempt number and no reply", async () => {
    const bid = await seedEscrowedBid();
    const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    world.fail(txId);
    assert.equal(await finalizeSettlement(bid.id), "failed");
    const r = await row(bid.id);
    assert.equal(r.status, "pending");
    assert.equal(r.settlementAttempt, 1);
    assert.equal(r.reply, null);
    assert.equal(r.replySalt, null);
    assert.match(r.failReason ?? "", /accept failed/);
  });

  test("refund only after the window; accept only inside it", async () => {
    const fresh = await seedEscrowedBid();
    await assert.rejects(submitSettlement({ bidId: fresh.id, action: "refund", actorUserId: ids.bidder }), /hasn't passed/);
    const old = await seedEscrowedBid({ ageSeconds: 3 * 24 * 3600 + 5 });
    await assert.rejects(submitSettlement({ bidId: old.id, action: "accept", actorUserId: ids.creator, reply: REPLY }), /window has passed/);
    await submitSettlement({ bidId: old.id, action: "refund", actorUserId: ids.bidder });
    assert.equal(world.calls("claimRefund").length, 1);
  });

  test("an agent bid is refunded from (and to) the agent wallet", async () => {
    const bid = await seedEscrowedBid({ fromAgent: true, ageSeconds: 3 * 24 * 3600 + 5 });
    await submitSettlement({ bidId: bid.id, action: "refund", actorUserId: ids.bidder });
    assert.equal(world.calls("claimRefund")[0]!.walletId, "w-bidder-agent");
  });

  // ── M3: original vs re-bid ──
  test("M3: accepting a countered bid and placing its re-bid can never both succeed", async () => {
    for (let round = 0; round < 15; round++) {
      world.reset();
      await truncateAll();
      await seedMarket();
      const original = await seedEscrowedBid({ status: "counter_offered", fromAgent: true });
      const [accept, rebid] = await Promise.allSettled([
        submitSettlement({ bidId: original.id, action: "accept", actorUserId: ids.creator, reply: REPLY }),
        createBidIntent({
          bidderUserId: ids.bidder,
          creatorUserId: ids.creator,
          amountUsdc: "20000000",
          replacesBidId: original.id,
          fromAgentWallet: true,
        }),
      ]);
      const accepted = accept.status === "fulfilled";
      const rebidPlaced = rebid.status === "fulfilled";
      assert.ok(!(accepted && rebidPlaced), `round ${round}: the bidder would pay twice`);
      assert.ok(accepted || rebidPlaced, `round ${round}: one of them should win`);
    }
  });

  test("a re-bid for an original that is already being settled is refused", async () => {
    const original = await seedEscrowedBid({ status: "counter_offered", fromAgent: true });
    await submitSettlement({ bidId: original.id, action: "reject", actorUserId: ids.creator });
    await assert.rejects(
      createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "20000000", replacesBidId: original.id, fromAgentWallet: true }),
      /already settled/,
    );
  });

  // ── D1: replies and messages go on-chain only as fingerprints ──
  test("D1: acceptBid carries only the reply's fingerprint; text and salt stay in the database", async () => {
    const bid = await seedEscrowedBid();
    await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    const [sent] = world.calls("acceptBid");
    const r = await row(bid.id);
    assert.match(r.replySalt ?? "", /^0x[0-9a-f]{64}$/, "a 32-byte salt was saved");
    assert.match(String(sent!.args[1]), /^0x[0-9a-f]{64}$/);
    assert.equal(sent!.args[1], fingerprint(r.replySalt as `0x${string}`, REPLY));
    assert.ok(!JSON.stringify(sent!.args).includes("considered"), "no reply text reaches the chain");
  });

  test("D1: each reply gets its own salt, so equal replies get different fingerprints", async () => {
    const a = await seedEscrowedBid();
    const b = await seedEscrowedBid();
    await submitSettlement({ bidId: a.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    await submitSettlement({ bidId: b.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    const [x, y] = world.calls("acceptBid");
    assert.notEqual(x!.args[1], y!.args[1]);
  });

  test("D1: retrying our own reservation sends the saved reply and salt, never the new text", async () => {
    const bid = await seedEscrowedBid();
    const salt = `0x${"ab".repeat(32)}` as const;
    await db
      .update(bids)
      .set({ settlementTxHash: `reserved:${Date.now()}`, settlementAction: "accept", reply: REPLY, replySalt: salt, replySource: "creator" })
      .where(eq(bids.id, bid.id));
    await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY.replace("considered", "different") });
    assert.equal(world.calls("acceptBid")[0]!.args[1], fingerprint(salt, REPLY));
    assert.equal((await row(bid.id)).reply, REPLY);
  });

  test("D1: our accept reported failed but the escrow shows it accepted with our fingerprint: reply restored", async () => {
    const bid = await seedEscrowedBid();
    const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    const before = await row(bid.id);
    const onChain = world.escrowBids.get(bid.onChainBidId!)!;
    onChain.status = 1;
    onChain.replyHash = fingerprint(before.replySalt as `0x${string}`, REPLY);
    world.fail(txId);
    assert.equal(await finalizeSettlement(bid.id), "settled");
    const r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.equal(r.reply, REPLY);
    assert.equal(r.replySalt, before.replySalt);
  });

  test("D1: accepted on-chain with a fingerprint we don't have: no reply is shown", async () => {
    const bid = await seedEscrowedBid();
    const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    const onChain = world.escrowBids.get(bid.onChainBidId!)!;
    onChain.status = 1;
    onChain.replyHash = `0x${"cd".repeat(32)}`;
    world.fail(txId);
    assert.equal(await finalizeSettlement(bid.id), "settled");
    const r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.equal(r.reply, null, "never show a reply that isn't the one paid for");
  });

  test("D1: every bid gets its own salt, with or without a message (CertiK finding 2)", async () => {
    const withMsg = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000", message: "hello there" });
    const without = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    assert.match(withMsg.messageSalt ?? "", /^0x[0-9a-f]{64}$/);
    assert.match(without.messageSalt ?? "", /^0x[0-9a-f]{64}$/);
    assert.notEqual(withMsg.messageSalt, without.messageSalt);
  });

  // ── D5: the escrow's own pause ──
  test("D5: while the escrow is paused on-chain, new bids are refused but declines and refunds go through", async () => {
    const open = await seedEscrowedBid();
    const old = await seedEscrowedBid({ ageSeconds: 3 * 24 * 3600 + 5 });
    world.escrowPaused = true;
    clearSettingsCache();
    await assert.rejects(
      createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" }),
      (e: unknown) => e instanceof BidError && /paused/.test(e.message) && e.status === 503,
    );
    await submitSettlement({ bidId: open.id, action: "reject", actorUserId: ids.creator });
    await submitSettlement({ bidId: old.id, action: "refund", actorUserId: ids.bidder });
    assert.equal(world.calls("rejectBid").length, 1);
    assert.equal(world.calls("claimRefund").length, 1);
  });

  // ── Legacy v1 escrows (testnet) keep working ──
  test("a v1 escrow still gets the reply text (it has no fingerprint function)", async () => {
    world.escrowVersion = 1;
    clearSettingsCache();
    const bid = await seedEscrowedBid();
    await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    assert.equal(world.calls("acceptBid")[0]!.args[1], REPLY);
  });

  // ── Review fixes: the fingerprint always leads back to the right text ──
  test("H1: a timed-out accept that landed anyway, then a retry with new text: the reply paid for is shown", async () => {
    const bid = await seedEscrowedBid();
    // 1st accept reaches Circle, but the call times out and Circle's list doesn't show it yet.
    world.timeoutNextSubmit = true;
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY }), /Couldn't confirm/);
    assert.match((await row(bid.id)).settlementTxHash ?? "", /^reserved:/, "kept while unknown");
    // 5 minutes on, Circle's list STILL doesn't show it (worst case): the stale path releases it.
    await db.update(bids).set({ settlementTxHash: `reserved:${Date.now() - 6 * 60_000}` }).where(eq(bids.id, bid.id));
    assert.equal(await finalizeSettlement(bid.id), "failed");
    let r = await row(bid.id);
    assert.equal(r.settlementTxHash, null, "released: Circle had no record of it");
    assert.equal(r.reply, null, "a pending bid shows no reply");
    assert.equal(r.settlementAttempt, 1, "the next try gets a new op key");
    assert.equal(r.replyCandidates?.length, 1, "the attempt's reply + salt are kept until the bid settles");
    // The creator, seeing nothing happen, retries with different text: a NEW op key, so
    // Circle sends a second transaction instead of handing back the first.
    const [first] = world.calls("acceptBid");
    const other = REPLY.replace("considered", "rewritten");
    const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: other });
    const second = world.calls("acceptBid")[1]!;
    assert.notEqual(second.refId, first!.refId, "never the old transaction back with a different reply");
    // Then the 1st lands on-chain (its fingerprint) and the contract refuses the 2nd.
    const onChain = world.escrowBids.get(bid.onChainBidId!)!;
    onChain.status = 1;
    onChain.replyHash = first!.args[1] as `0x${string}`;
    world.fail(txId);
    assert.equal(await finalizeSettlement(bid.id), "settled");
    r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.equal(r.reply, REPLY, "the text whose fingerprint is on-chain, not the retry's");
    assert.equal(r.replyCandidates, null, "cleared once settled");
  });

  test("a confirmed accept whose log fingerprint matches nothing we saved shows no reply", async () => {
    const bid = await seedEscrowedBid();
    const { txId } = await submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
    world.complete(txId, [bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, `0x${"ef".repeat(32)}`)]);
    assert.equal(await finalizeSettlement(bid.id), "settled");
    const r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.equal(r.reply, null);
  });

  test("a legacy v1 escrow and the current v2 escrow side by side each get their own arguments", async () => {
    const LEGACY = "0x1e9a000000000000000000000000000000000003";
    process.env.ATTN_LEGACY_ESCROW_CONTRACTS = LEGACY;
    try {
      world.escrowVersions.set(LEGACY, 1);
      clearSettingsCache();
      const legacy = await seedEscrowedBid({ escrow: LEGACY });
      const current = await seedEscrowedBid({ amount: BigInt(7_000_000) });
      await submitSettlement({ bidId: legacy.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
      await submitSettlement({ bidId: current.id, action: "accept", actorUserId: ids.creator, reply: REPLY });
      const [toLegacy, toCurrent] = world.calls("acceptBid");
      assert.equal(toLegacy!.contractAddress, LEGACY);
      assert.equal(toLegacy!.args[1], REPLY, "v1 gets the text");
      assert.equal(toCurrent!.contractAddress, ESCROW);
      assert.match(String(toCurrent!.args[1]), /^0x[0-9a-f]{64}$/, "v2 gets only a fingerprint");
    } finally {
      process.env.ATTN_LEGACY_ESCROW_CONTRACTS = "none";
      clearSettingsCache();
    }
  });
});
