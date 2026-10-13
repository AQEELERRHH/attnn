/**
 * The Circle contract-event webhook on a v2 escrow: a BidAccepted log carries only the
 * reply's fingerprint, so the row keeps the saved reply (or an earlier attempt's) that
 * matches it, and shows none when nothing matches. Signature checking is covered by
 * lib/circle-webhook.ts; here it is stubbed to "valid".
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installFakes, world, bidAcceptedLog } from "../helpers/fakes.mts";
import { addr, closeDb, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedEscrowedBid, seedMarket } from "../helpers/seed.mts";
import { ESCROW } from "../helpers/env.mts";

await installFakes();
mock.module(pathToFileURL(path.resolve("lib/circle-webhook.ts")).href, {
  namedExports: { verifyCircleSignature: async () => true },
});
const { NextRequest } = await import("next/server");
const { db } = await import("../../lib/db/client.ts");
const { bids } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { fingerprint, clearEscrowCache } = await import("../../lib/escrow.ts");
const { POST } = await import("../../app/api/webhooks/circle-events/route.ts");

const REPLY = "Thanks for your bid. Here is a considered answer to your question, with enough detail to be genuinely useful to you.";
const SALT = `0x${"12".repeat(32)}` as const;
const row = async (id: string) => (await db.query.bids.findFirst({ where: eq(bids.id, id) }))!;

let n = 0;
function eventLog(log: { topics: readonly unknown[]; data: string }) {
  const body = {
    notificationId: `n-${++n}`,
    notificationType: "contracts.eventLog",
    notification: { txHash: `0x${"9".repeat(64)}`, contractAddress: ESCROW, blockchain: "ARC-TESTNET", topics: log.topics, data: log.data },
  };
  return POST(new NextRequest("http://attnn.test/api/webhooks/circle-events", { method: "POST", body: JSON.stringify(body) }));
}

describe("circle-events webhook on a v2 escrow", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearEscrowCache();
    await truncateAll();
    await seedMarket();
  });
  after(closeDb);

  test("BidAccepted with the fingerprint of an earlier attempt's reply: accepted, that reply shown", async () => {
    const bid = await seedEscrowedBid();
    await db
      .update(bids)
      .set({ replyCandidates: [{ reply: REPLY, salt: SALT, source: "creator" }] })
      .where(eq(bids.id, bid.id));
    const res = await eventLog(bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, fingerprint(SALT, REPLY)));
    assert.equal(res.status, 200);
    const r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.equal(r.reply, REPLY);
    assert.equal(r.replySalt, SALT);
    assert.equal(r.settlementOnChainTxHash, `0x${"9".repeat(64)}`);
  });

  test("BidAccepted with a fingerprint we don't have: accepted, no reply shown", async () => {
    const bid = await seedEscrowedBid();
    await eventLog(bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, `0x${"34".repeat(32)}`));
    const r = await row(bid.id);
    assert.equal(r.status, "accepted");
    assert.equal(r.reply, null);
  });

  test("a log from another contract is ignored", async () => {
    const bid = await seedEscrowedBid();
    const log = bidAcceptedLog("0x000000000000000000000000000000000000dead", BigInt(bid.onChainBidId!), addr.creatorMain, fingerprint(SALT, REPLY));
    const body = {
      notificationId: "other",
      notificationType: "contracts.eventLog",
      notification: { contractAddress: "0x000000000000000000000000000000000000dead", blockchain: "ARC-TESTNET", topics: log.topics, data: log.data },
    };
    const res = await POST(new NextRequest("http://attnn.test/api/webhooks/circle-events", { method: "POST", body: JSON.stringify(body) }));
    assert.match(JSON.stringify(await res.json()), /not the current escrow/);
    assert.equal((await row(bid.id)).status, "pending");
  });

  test("N2: the log arrives while our stale reservation is released: the bid is still recorded accepted", async () => {
    const bid = await seedEscrowedBid();
    // Our accept was reserved 6 minutes ago and Circle's list doesn't show it.
    await db
      .update(bids)
      .set({
        settlementTxHash: `reserved:${Date.now() - 6 * 60_000}`,
        settlementAction: "accept",
        reply: REPLY,
        replySalt: SALT,
        replyCandidates: [{ reply: REPLY, salt: SALT, source: "creator" }],
      })
      .where(eq(bids.id, bid.id));
    await eventLog(bidAcceptedLog(ESCROW, BigInt(bid.onChainBidId!), addr.creatorMain, fingerprint(SALT, REPLY)));
    const r = await row(bid.id);
    assert.equal(r.status, "accepted", "the on-chain log wins over our released reservation");
    assert.equal(r.reply, REPLY);
  });
});
