import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world, bidPlacedLog } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();
const { db } = await import("../../lib/db/client.ts");
const { bids, appSettings } = await import("../../lib/db/schema.ts");
const { BidError, createBidIntent, finalizePlacement, finalizeSettlement, submitSettlement } = await import("../../lib/bids.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
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
    assert.equal((await row(bid.id)).reply, sent[0]!.args[1]);
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

  test("a Circle outage releases the reservation and leaves no reply behind", async () => {
    const bid = await seedEscrowedBid();
    world.failNextSubmit = new Error("circle down");
    await assert.rejects(submitSettlement({ bidId: bid.id, action: "accept", actorUserId: ids.creator, reply: REPLY }), /circle down/);
    const r = await row(bid.id);
    assert.equal(r.settlementTxHash, null);
    assert.equal(r.settlementAction, null);
    assert.equal(r.reply, null);
    // ...and a retry goes through
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
    world.complete(txId);
    assert.equal(await finalizeSettlement(bid.id), "settled");
    const r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.ok(r.settlementOnChainTxHash, "earnings only count settlements with a chain hash");
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
});
