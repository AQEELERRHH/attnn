#!/usr/bin/env node
/**
 * READ-ONLY bid reconciliation report. Compares the `bids` table with AttnnEscrow
 * on Arc and prints what doesn't match. It never writes to the database or the chain.
 *
 *   node --env-file=.env.local scripts/reconcile-bids.mjs            # table
 *   node --env-file=.env.local scripts/reconcile-bids.mjs --json out.json
 *
 * Needs DATABASE_URL and ATTN_ESCROW_CONTRACT. Optional ARC_RPC_URL.
 *
 * Categories:
 *   phantom           DB pending/placing, no on-chain id, and no unmatched on-chain bid
 *                     from that bidder→creator for that amount. No USDC moved.
 *   phantom-match     Same, but an on-chain bid with the same bidder, creator and amount
 *                     exists and no DB row claims it. Probably the real bid: link it.
 *   status-mismatch   DB status differs from the escrow's status for that bid id.
 *   unproven-accept   DB says accepted, escrow says otherwise. The "$35 vs $20" bug.
 *   not-in-escrow     The on-chain id doesn't exist in the CURRENT escrow (older contract).
 *   ok                Matches.
 */
import postgres from "postgres";
import { createPublicClient, http } from "viem";
import { writeFileSync } from "node:fs";

const ESCROW = process.env.ATTN_ESCROW_CONTRACT?.toLowerCase();
const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
if (!process.env.DATABASE_URL || !ESCROW) {
  console.error("Set DATABASE_URL and ATTN_ESCROW_CONTRACT (e.g. node --env-file=.env.local …)");
  process.exit(1);
}

const escrowAbi = [
  { type: "function", name: "getBid", stateMutability: "view", inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [
      { name: "bidder", type: "address" }, { name: "creator", type: "address" }, { name: "amount", type: "uint256" },
      { name: "message", type: "string" }, { name: "reply", type: "string" }, { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
    ] },
  { type: "function", name: "getBidderBids", stateMutability: "view", inputs: [{ name: "bidder", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }] },
];
const ONCHAIN = ["pending", "accepted", "rejected", "refunded"];
const ZERO = "0x0000000000000000000000000000000000000000";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
const client = createPublicClient({ transport: http(RPC) });

const usd = (atomic) => `$${(Number(atomic) / 1e6).toFixed(2)}`;

try {
  // Read-only transaction: Postgres itself rejects any write.
  const rows = await sql.begin("read only", (tx) => tx`
    SELECT id, status, on_chain_bid_id, bidder_address, creator_address, amount_usdc,
           created_at, settlement_on_chain_tx_hash
    FROM bids
    WHERE status IN ('pending', 'placing', 'counter_offered', 'accepted')
    ORDER BY created_at
  `);

  const claimedIds = new Set(
    (await sql.begin("read only", (tx) => tx`SELECT on_chain_bid_id FROM bids WHERE on_chain_bid_id IS NOT NULL`))
      .map((r) => r.on_chain_bid_id),
  );

  const bidderCache = new Map();
  async function onChainBidsOf(bidder) {
    if (!bidderCache.has(bidder)) {
      const ids = await client.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getBidderBids", args: [bidder] });
      const details = [];
      for (const id of ids) {
        const b = await client.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getBid", args: [id] });
        details.push({ id: id.toString(), creator: b[1].toLowerCase(), amount: b[2].toString(), status: ONCHAIN[b[5]] ?? `?${b[5]}` });
      }
      bidderCache.set(bidder, details);
    }
    return bidderCache.get(bidder);
  }

  const report = [];
  for (const r of rows) {
    const base = { id: r.id, dbStatus: r.status, amount: usd(r.amount_usdc), onChainBidId: r.on_chain_bid_id, created: r.created_at.toISOString() };

    if (!r.on_chain_bid_id) {
      const candidates = (await onChainBidsOf(r.bidder_address))
        .filter((b) => b.creator === r.creator_address.toLowerCase() && b.amount === r.amount_usdc && !claimedIds.has(b.id));
      report.push(candidates.length
        ? { ...base, category: "phantom-match", chain: candidates.map((c) => `#${c.id} ${c.status}`).join(", ") }
        : { ...base, category: "phantom", chain: "no matching escrow bid — no USDC moved" });
      continue;
    }

    const b = await client.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getBid", args: [BigInt(r.on_chain_bid_id)] });
    if (b[0].toLowerCase() === ZERO) {
      report.push({ ...base, category: "not-in-escrow", chain: "id not found in current escrow" });
      continue;
    }
    const chainStatus = ONCHAIN[b[5]] ?? `?${b[5]}`;
    const sameParties = b[0].toLowerCase() === r.bidder_address.toLowerCase() && b[1].toLowerCase() === r.creator_address.toLowerCase();
    const dbComparable = r.status === "counter_offered" ? "pending" : r.status;
    let category = "ok";
    if (!sameParties || b[2].toString() !== r.amount_usdc) category = "not-in-escrow";
    else if (r.status === "accepted" && chainStatus !== "accepted") category = "unproven-accept";
    else if (dbComparable !== chainStatus) category = "status-mismatch";
    report.push({ ...base, category, chain: `${chainStatus}${sameParties ? "" : " (different bidder/creator)"}` });
  }

  const counts = report.reduce((acc, r) => ((acc[r.category] = (acc[r.category] ?? 0) + 1), acc), {});
  const problems = report.filter((r) => r.category !== "ok");
  console.log(`Escrow ${ESCROW} via ${RPC}`);
  console.log(`Checked ${report.length} bids:`, counts);
  if (problems.length) console.table(problems.map(({ id, category, dbStatus, chain, amount, onChainBidId, created }) => ({ id, category, dbStatus, chain, amount, onChainBidId, created })));
  const unproven = report.filter((r) => r.category === "unproven-accept");
  if (unproven.length) {
    const total = unproven.reduce((s, r) => s + Number(r.amount.slice(1)), 0);
    console.log(`\nEarnings shown but never paid on-chain: $${total.toFixed(2)} across ${unproven.length} bids.`);
  }
  console.log("\nNothing was changed. Review the list before deciding on any cleanup.");

  const jsonIdx = process.argv.indexOf("--json");
  if (jsonIdx > -1 && process.argv[jsonIdx + 1]) {
    writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2));
    console.log(`Full report written to ${process.argv[jsonIdx + 1]}`);
  }
} finally {
  await sql.end();
}
