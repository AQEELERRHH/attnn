/**
 * The placeBid job itself (inngest/bid-lifecycle.ts): approve → placeBid → escrowed,
 * an approval used up by another bid (M5), and never failing a bid whose placeBid
 * was already sent (M4/N3).
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakes, world } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();
const { db } = await import("../../lib/db/client.ts");
const { bids } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { createBidIntent } = await import("../../lib/bids.ts");
const lifecycle = await import("../../inngest/bid-lifecycle.ts");

type Fn = { __fn: [{ onFailure?: (ctx: unknown) => Promise<unknown> }, unknown, (ctx: unknown) => Promise<unknown>] };
const job = lifecycle.placeBid as unknown as Fn;

/** A fake Inngest step runner; `before` hooks run just before a named step. */
function makeStep(before: Record<string, () => void> = {}) {
  const seen = new Set<string>();
  return {
    run: async (id: string, fn: () => unknown) => {
      if (before[id] && !seen.has(id)) {
        seen.add(id);
        before[id]();
      }
      return JSON.parse(JSON.stringify((await fn()) ?? null)); // Inngest serialises step results
    },
    sleep: async () => {},
    sendEvent: async () => {},
  };
}

const row = async (id: string) => (await db.query.bids.findFirst({ where: eq(bids.id, id) }))!;

describe("placeBid job", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    await truncateAll();
    await seedMarket();
    world.autoMine = true;
  });
  after(closeDb);

  test("approves exactly the bid amount, places it, and records the on-chain id", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    const out = (await job.__fn[2]({ event: { data: { bidId: bid.id } }, step: makeStep() })) as { escrowed?: boolean };
    assert.equal(out.escrowed, true);
    const r = await row(bid.id);
    assert.equal(r.status, "pending");
    assert.ok(r.onChainBidId);
    assert.deepEqual(world.calls("approve").map((t) => t.args[1]), ["10000000"], "approved exactly this bid");
    assert.equal(world.calls("placeBid").length, 1);
    assert.equal(world.usdc.get(ESCROW), BigInt(10_000_000));
  });

  test("D1: placeBid carries only the message's fingerprint (v2), and no message at all on a v1 escrow", async () => {
    const { fingerprint, clearEscrowCache } = await import("../../lib/escrow.ts");
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000", message: "Would love your take on our pitch" });
    await job.__fn[2]({ event: { data: { bidId: bid.id } }, step: makeStep() });
    const [placed] = world.calls("placeBid");
    assert.equal(placed!.args.length, 3);
    assert.equal(placed!.args[2], fingerprint(bid.messageSalt as `0x${string}`, "Would love your take on our pitch"));
    assert.ok(!JSON.stringify(placed!.args).includes("pitch"));
    assert.equal((await row(bid.id)).status, "pending");

    // Legacy escrow: the message stays off-chain there too (empty + private).
    world.reset();
    clearEscrowCache();
    world.escrowVersion = 1;
    await truncateAll();
    await seedMarket();
    world.autoMine = true;
    const legacy = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000", message: "secret plans" });
    await job.__fn[2]({ event: { data: { bidId: legacy.id } }, step: makeStep() });
    assert.deepEqual(world.calls("placeBid")[0]!.args.slice(2), ["", true]);
    clearEscrowCache();
  });

  test("D5: a queued bid isn't sent once the escrow is paused; one the chain refuses fails with no USDC moved", async () => {
    const { clearEscrowCache } = await import("../../lib/escrow.ts");
    // Paused while queued: the job sees it and never sends placeBid.
    const queued = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    const step = makeStep({ "check-paused": () => { world.escrowPaused = true; clearEscrowCache(); } });
    await job.__fn[2]({ event: { data: { bidId: queued.id } }, step });
    let r = await row(queued.id);
    assert.equal(r.status, "failed");
    assert.match(r.failReason ?? "", /paused.*No USDC moved/);
    assert.equal(world.calls("placeBid").length, 0);

    // Paused after the app's check (cached as open): the contract refuses it on-chain.
    world.escrowPaused = false;
    clearEscrowCache();
    const late = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    await job.__fn[2]({ event: { data: { bidId: late.id } }, step: makeStep({ "submit-place-bid": () => { world.escrowPaused = true; } }) });
    r = await row(late.id);
    assert.equal(r.status, "failed");
    assert.match(r.failReason ?? "", /No USDC moved/);
    assert.equal(world.usdc.get(ESCROW) ?? BigInt(0), BigInt(0));
    clearEscrowCache();
  });

  test("M5: if another bid uses the approval first, it re-approves and still places once", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    const step = makeStep({
      // Another bid from the same wallet spends the allowance while this run sleeps.
      "submit-place-bid": () => world.allowance.set(`${addr.bidderMain}:${ESCROW}`, BigInt(0)),
    });
    const out = (await job.__fn[2]({ event: { data: { bidId: bid.id } }, step })) as { escrowed?: boolean };
    assert.equal(out.escrowed, true);
    assert.equal(world.calls("approve").length, 2, "re-approved once");
    assert.equal(world.calls("placeBid").length, 1, "placed once");
    assert.equal((await row(bid.id)).status, "pending");
  });

  test("N3: a placeBid sent by an earlier attempt is picked up, never re-sent or failed", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    // An earlier attempt sent approve + placeBid, then crashed before saving the Circle id.
    const { executeContractCallOnce } = await import("../../lib/circle.ts");
    const { usdcAbi, escrowAbi, USDC_ADDRESS } = await import("../../lib/arc.ts");
    await executeContractCallOnce({ walletId: "w-bidder-main", contractAddress: USDC_ADDRESS, abi: usdcAbi, functionName: "approve", args: [ESCROW, "10000000"], opKey: `approve:${bid.id}` });
    await executeContractCallOnce({ walletId: "w-bidder-main", contractAddress: ESCROW, abi: escrowAbi, functionName: "placeBid", args: [addr.creatorMain, "10000000", "", false], opKey: `place:${bid.id}` });
    assert.equal((await row(bid.id)).bidTxHash, null);

    const out = (await job.__fn[2]({ event: { data: { bidId: bid.id } }, step: makeStep() })) as { escrowed?: boolean };
    assert.equal(out.escrowed, true);
    assert.equal(world.calls("placeBid").length, 1, "not sent a second time");
    assert.equal(world.calls("approve").length, 1, "its own spent approval isn't mistaken for theft (no re-approve)");
    assert.equal((await row(bid.id)).status, "pending");
  });

  test("a failed approval fails the bid with 'no USDC moved' only when placeBid was never sent", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    world.autoMine = false;
    const step = makeStep({
      "approve-status-0": () => {
        const approve = world.calls("approve")[0]!;
        world.fail(approve.id);
      },
    });
    const out = (await job.__fn[2]({ event: { data: { bidId: bid.id } }, step })) as { failed?: string };
    assert.equal(out.failed, "approve");
    const r = await row(bid.id);
    assert.equal(r.status, "failed");
    assert.match(r.failReason ?? "", /No USDC moved/);
    assert.equal(world.calls("placeBid").length, 0);
  });

  test("N1: a retried step whose placeBid already reached Circle is never failed by a pause", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    // An earlier run sent placeBid (Circle knows it), then the bids were paused.
    const { executeContractCallOnce } = await import("../../lib/circle.ts");
    const { escrowAbi } = await import("../../lib/arc.ts");
    world.allowance.set(`${addr.bidderMain}:${ESCROW}`, BigInt(10_000_000));
    await executeContractCallOnce({ walletId: "w-bidder-main", contractAddress: ESCROW, abi: escrowAbi, functionName: "placeBid", args: [addr.creatorMain, "10000000", `0x${"0".repeat(64)}`], opKey: `place:${bid.id}` });
    await db.insert((await import("../../lib/db/schema.ts")).appSettings).values({ key: "bids_paused", value: true });
    const { clearSettingsCache } = await import("../../lib/app-settings.ts");
    clearSettingsCache();
    const out = (await job.__fn[2]({ event: { data: { bidId: bid.id } }, step: makeStep() })) as { escrowed?: boolean };
    assert.equal(out.escrowed, true, "tracked to escrow, not failed");
    assert.equal(world.calls("placeBid").length, 1);
    assert.equal((await row(bid.id)).status, "pending");
    clearSettingsCache();
  });

  test("onFailure never fails a bid whose placeBid reached Circle", async () => {
    const bid = await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "10000000" });
    const { executeContractCallOnce } = await import("../../lib/circle.ts");
    const { escrowAbi } = await import("../../lib/arc.ts");
    world.allowance.set(`${addr.bidderMain}:${ESCROW}`, BigInt(10_000_000));
    const { txId } = await executeContractCallOnce({ walletId: "w-bidder-main", contractAddress: ESCROW, abi: escrowAbi, functionName: "placeBid", args: [addr.creatorMain, "10000000", "", false], opKey: `place:${bid.id}` });
    await job.__fn[0].onFailure!({ event: { data: { event: { data: { bidId: bid.id } } } }, error: new Error("step timed out") });
    const r = await row(bid.id);
    assert.equal(r.status, "placing", "left for the sweep, not failed");
    assert.equal(r.bidTxHash, txId);
  });
});
