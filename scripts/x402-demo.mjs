#!/usr/bin/env node
/**
 * x402 proof: an AI agent pays $0.001 USDC through Circle Gateway (gas-free,
 * batched "nanopayments") and receives a creator's Attnn. profile in return.
 *
 *   BUYER_PRIVATE_KEY=0x… node scripts/x402-demo.mjs <handle> [--deposit 0.10] [--base https://attnn.xyz] [--mainnet]
 *
 * BUYER_PRIVATE_KEY is a throwaway key for the agent (NOT a Circle wallet). On
 * testnet (the default), fund its address with testnet USDC from
 * https://faucet.circle.com (Arc Testnet). With --mainnet it pays real USDC on Arc
 * mainnet: use a fresh key holding only a few dollars, and only against a site
 * running ARC_NETWORK=mainnet. Run once with --deposit to move some USDC into the
 * agent's Gateway balance. Later runs pay from that balance.
 *
 * Prints: the agent's balances, the 402 price it was quoted, the profile it got
 * back and the Gateway settlement receipt. Never prints the key.
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";

const args = process.argv.slice(2);
const valueFlags = new Set(["--deposit", "--base"]);
const handle = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1] ?? ""));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? "https://attnn.xyz").replace(/\/$/, "");
const deposit = flag("deposit");
const key = process.env.BUYER_PRIVATE_KEY?.trim();
const mainnet = args.includes("--mainnet");

if (!handle || !key) {
  console.error("Usage: BUYER_PRIVATE_KEY=0x… node scripts/x402-demo.mjs <handle> [--deposit 0.10] [--base https://attnn.xyz] [--mainnet]");
  process.exit(1);
}

const client = new GatewayClient({ chain: mainnet ? "arc" : "arcTestnet", privateKey: key });
const url = `${base}/api/c/${encodeURIComponent(handle)}`;
const line = (label, value) => console.log(`${label.padEnd(18)} ${value}`);

line("Chain", mainnet ? "Arc mainnet (real USDC)" : "Arc Testnet");
line("Agent wallet", client.address);
const before = await client.getBalances();
line("Wallet USDC", before.wallet.formatted);
line("Gateway USDC", `${before.gateway.formattedAvailable} available`);

if (deposit) {
  console.log(`\nDepositing ${deposit} USDC into Gateway…`);
  const d = await client.deposit(deposit);
  line("Deposit tx", d.depositTxHash);
  console.log("Deposits can take a little while to show as available on Gateway. Re-run without --deposit if the payment fails.");
}

// What does the endpoint ask for? (plain request, no payment)
const quote = await fetch(url);
if (quote.status === 402) {
  const req = JSON.parse(Buffer.from(quote.headers.get("PAYMENT-REQUIRED"), "base64").toString("utf8"));
  const a = req.accepts?.[0] ?? {};
  console.log("\n402 Payment Required");
  line("Price (atomic)", `${a.amount} (= $${Number(a.amount) / 1e6})`);
  line("Network", a.network);
  line("Pay to", a.payTo);
  line("Scheme", `${a.scheme} / ${a.extra?.name}`);
} else {
  console.log(`\nEndpoint answered ${quote.status} without asking for payment.`);
}

console.log("\nPaying and fetching…");
const t0 = Date.now();
const result = await client.pay(url);
const ms = Date.now() - t0;

console.log("\n✓ Profile delivered");
console.log(JSON.stringify(result.data.profile, null, 2));
console.log("\n✓ Payment receipt (from PAYMENT-RESPONSE)");
line("Paid", `$${result.formattedAmount} USDC`);
line("Settlement", result.transaction || "(none returned)");
line("Body receipt", JSON.stringify(result.data.payment ?? null));
line("Round trip", `${ms} ms, zero gas paid by the agent`);

const after = await client.getBalances();
line("Gateway after", `${after.gateway.formattedAvailable} available`);
console.log(`\nPublic receipts: ${base}/api/x402/receipts`);
