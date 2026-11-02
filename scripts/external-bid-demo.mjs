#!/usr/bin/env node
/**
 * External bid proof: an outside AI agent bids on an Attnn. creator from its OWN wallet.
 * Attnn. never holds this key or this USDC (docs/AGENT-API.md, "Bid from your own wallet").
 *
 *   AGENT_PRIVATE_KEY=0x… node scripts/external-bid-demo.mjs <handle> [--amount 5] [--message "…"]
 *                        [--base https://attnn.xyz] [--mainnet] [--deposit 0.10]
 *
 *   1. pays $0.001 over x402 to read the creator's profile (proves the wallet is ours)
 *   2. POST /api/v1/bids           → the approve + placeBid calls to send
 *   3. sends both from this wallet → USDC escrowed on Arc
 *   4. POST /api/v1/bids/<id>/confirm, then GET /api/v1/bids/<id>
 *
 * Testnet by default: fund the key's address at https://faucet.circle.com (Arc Testnet),
 * and run once with --deposit 0.10 to put a little USDC in Circle Gateway for profile reads.
 * --mainnet spends real USDC: use a fresh key holding only a few dollars, against a site
 * running ARC_NETWORK=mainnet. --amount defaults to the creator's floor. Never prints the key.
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
const valueFlags = new Set(["--amount", "--message", "--base", "--deposit"]);
const handle = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1] ?? ""));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const key = process.env.AGENT_PRIVATE_KEY?.trim();
const mainnet = args.includes("--mainnet");
const base = (flag("base") ?? "https://attnn.xyz").replace(/\/$/, "");
if (!handle || !key) {
  console.error('Usage: AGENT_PRIVATE_KEY=0x… node scripts/external-bid-demo.mjs <handle> [--amount 5] [--message "…"] [--base URL] [--mainnet] [--deposit 0.10]');
  process.exit(1);
}

const arc = mainnet
  ? defineChain({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io"] } } })
  : defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network"] } } });
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: arc, transport: http() });
const chain = createPublicClient({ chain: arc, transport: http() });
const line = (label, value) => console.log(`${label.padEnd(18)} ${value}`);
const usd = (atomic) => `$${(Number(atomic) / 1e6).toFixed(atomic.length > 4 ? 2 : 6)}`;

line("Chain", mainnet ? "Arc mainnet (real USDC)" : "Arc Testnet");
line("Agent wallet", account.address);

// 1. Read the profile over x402, paying from this wallet.
const gateway = new GatewayClient({ chain: mainnet ? "arc" : "arcTestnet", privateKey: key });
if (flag("deposit")) {
  console.log(`\nDepositing ${flag("deposit")} USDC into Gateway for profile reads…`);
  line("Deposit tx", (await gateway.deposit(flag("deposit"))).depositTxHash);
}
const read = await gateway.pay(`${base}/api/c/${encodeURIComponent(handle)}`);
const profile = read.data.profile;
console.log("\n1. Profile read (x402)");
line("Paid", `$${read.formattedAmount} USDC`);
line("Creator", `@${profile.handle}: floor ${usd(profile.minBid)}, ${profile.availabilityStatus}`);

// 2. Prepare the bid.
const amount = flag("amount") ? String(Math.round(Number(flag("amount")) * 1e6)) : profile.minBid;
const prepared = await fetch(`${base}/api/v1/bids`, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": `demo-${account.address}-${handle}-${amount}-${Date.now()}` },
  body: JSON.stringify({ handle, amount, bidder: account.address, message: flag("message") ?? "Hello from an outside agent (Attnn. bid API demo)." }),
});
const bid = await prepared.json();
if (!prepared.ok) {
  console.error(`\nPOST /api/v1/bids ${prepared.status}: ${bid.error}`);
  process.exit(1);
}
console.log("\n2. Bid prepared");
line("Bid id", bid.id);
line("Amount", usd(bid.amount));
line("Message hash", bid.messageHash);

// 3. Send approve, then placeBid, from this wallet.
console.log("\n3. Sending from the agent's own wallet");
let placeHash;
for (const call of bid.calls) {
  const hash = await wallet.sendTransaction({ to: call.to, data: call.data, value: 0n });
  const receipt = await chain.waitForTransactionReceipt({ hash });
  line(call.description.split("(")[0], `${hash} (${receipt.status})`);
  if (receipt.status !== "success") process.exit(1);
  placeHash = hash;
}

// 4. Confirm, then read the status.
const auth = { authorization: `Bearer ${bid.accessToken}`, "content-type": "application/json" };
const confirmed = await fetch(`${base}/api/v1/bids/${bid.id}/confirm`, { method: "POST", headers: auth, body: JSON.stringify({ txHash: placeHash }) });
const status = await confirmed.json();
console.log("\n4. Confirmed with Attnn.");
line("Status", confirmed.ok ? status.status : `${confirmed.status}: ${status.error}`);
if (confirmed.ok) {
  line("On-chain bid", `#${status.onChainBidId} in ${status.escrow}`);
  line("Refundable after", status.refundableAfter);
}
// The access token is this bid's own read key (yours, not a wallet key): keep it to read the reply later.
console.log(`\nCheck later (the reply appears once the creator answers):`);
console.log(`  curl -H "authorization: Bearer ${bid.accessToken}" ${base}/api/v1/bids/${bid.id}`);
