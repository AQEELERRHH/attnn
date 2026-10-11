/** Seeds a bidder (main + agent wallet) and an active creator. */
import { addr, ids } from "./db.mts";
import { world } from "./fakes.mts";

export async function seedMarket(opts: { creatorMinBid?: string; bidderUsdc?: bigint; agentUsdc?: bigint } = {}) {
  const { db } = await import("../../lib/db/client.ts");
  const { users, wallets, profiles, bidderConfigs } = await import("../../lib/db/schema.ts");
  await db.insert(users).values([
    { id: ids.bidder, email: "bidder@test", role: "bidder" },
    { id: ids.creator, email: "creator@test", role: "creator" },
    { id: ids.other, email: "other@test", role: "bidder" },
  ]);
  await db.insert(wallets).values([
    { userId: ids.bidder, circleWalletId: "w-bidder-main", address: addr.bidderMain, blockchain: "ARC-TESTNET", state: "active", purpose: "main" },
    { userId: ids.bidder, circleWalletId: "w-bidder-agent", address: addr.bidderAgent, blockchain: "ARC-TESTNET", state: "active", purpose: "agent" },
    { userId: ids.creator, circleWalletId: "w-creator-main", address: addr.creatorMain, blockchain: "ARC-TESTNET", state: "active", purpose: "main" },
  ]);
  await db.insert(profiles).values({
    userId: ids.creator,
    handle: "amina",
    minBid: opts.creatorMinBid ?? "5000000",
    tags: ["ai"],
    isActive: true,
  });
  await db.insert(bidderConfigs).values({
    userId: ids.bidder,
    dailyBudget: "50000000",
    maxBidPerCreator: "20000000",
    searchTags: ["ai"],
    isActive: true,
  });
  world.usdc.set(addr.bidderMain, opts.bidderUsdc ?? BigInt(100_000_000));
  world.usdc.set(addr.bidderAgent, opts.agentUsdc ?? BigInt(100_000_000));
  world.usdc.set(addr.creatorMain, BigInt(10_000_000));
  world.activeCreators.add(addr.creatorMain);
  world.walletAddress.set("w-bidder-main", addr.bidderMain);
  world.walletAddress.set("w-bidder-agent", addr.bidderAgent);
  world.walletAddress.set("w-creator-main", addr.creatorMain);
}

/** Inserts a bid that is already escrowed (pending) both in the DB and the fake escrow. */
export async function seedEscrowedBid(opts: {
  amount?: bigint;
  fromAgent?: boolean;
  status?: "pending" | "counter_offered";
  ageSeconds?: number;
  replacesBidId?: string;
} = {}) {
  const { db } = await import("../../lib/db/client.ts");
  const { bids } = await import("../../lib/db/schema.ts");
  const { escrowBid } = await import("./fakes.mts");
  const { ESCROW } = await import("./env.mts");
  const amount = opts.amount ?? BigInt(10_000_000);
  const bidder = opts.fromAgent ? addr.bidderAgent : addr.bidderMain;
  const onChainBidId = escrowBid({
    bidder,
    creator: addr.creatorMain,
    amount,
    createdAt: BigInt(Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0)),
  });
  const [row] = await db
    .insert(bids)
    .values({
      bidderUserId: ids.bidder,
      creatorUserId: ids.creator,
      bidderAddress: bidder,
      creatorAddress: addr.creatorMain,
      amountUsdc: amount.toString(),
      message: "hello",
      status: opts.status ?? "pending",
      escrowAddress: ESCROW,
      onChainBidId,
      onChainTxHash: `0x${"a".repeat(64)}`,
      replacesBidId: opts.replacesBidId ?? null,
      counterOfferAmount: opts.status === "counter_offered" ? (amount * BigInt(2)).toString() : null,
      createdAt: new Date(Date.now() - (opts.ageSeconds ?? 0) * 1000),
    })
    .returning();
  return row!;
}
