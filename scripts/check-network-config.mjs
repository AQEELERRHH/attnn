#!/usr/bin/env node
/**
 * Preflight for a network switch (e.g. Arc Testnet → Arc mainnet). READ-ONLY: it
 * reads env vars and calls view functions on Arc; it never sends a transaction and
 * never prints a secret (only whether each one is set).
 *
 *   node --env-file=.env.local scripts/check-network-config.mjs
 *   node --env-file=.env.mainnet scripts/check-network-config.mjs   (a file with the mainnet values)
 *
 * Exits 1 if anything would break bids, payouts or x402 on the chosen network.
 */
import { createPublicClient, http, getAddress, toFunctionSelector } from "viem";

const env = (k) => process.env[k]?.trim() ?? "";
const network = env("ARC_NETWORK").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
const expected = {
  mainnet: { chainId: 5042, rpc: "https://rpc.mainnet.arc.io", circle: "ARC" },
  testnet: { chainId: 5042002, rpc: "https://rpc.testnet.arc.network", circle: "ARC-TESTNET" },
}[network];
const USDC = "0x3600000000000000000000000000000000000000";

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const warn = (msg) => console.log(`  warn  ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);

console.log(`\nNetwork: ${network === "mainnet" ? "Arc MAINNET (real USDC)" : "Arc Testnet"}\n`);

// ── Env ──
console.log("Environment");
for (const k of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "DATABASE_URL", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]) {
  env(k) ? ok(`${k} is set`) : fail(`${k} is missing`);
}
env("AUTH_SECRET") || env("NEXTAUTH_SECRET") ? ok("Auth secret is set") : fail("AUTH_SECRET / NEXTAUTH_SECRET is missing");
env("CIRCLE_WALLET_SET_ID") ? ok("CIRCLE_WALLET_SET_ID is set") : warn("CIRCLE_WALLET_SET_ID empty: a new wallet set is created on first use");
if (network === "mainnet" && env("CIRCLE_API_KEY") && !env("CIRCLE_API_KEY").startsWith("LIVE_API_KEY:")) {
  fail("CIRCLE_API_KEY is not a LIVE key (mainnet needs a key starting LIVE_API_KEY:)");
} else if (network === "testnet" && env("CIRCLE_API_KEY").startsWith("LIVE_API_KEY:")) {
  fail("CIRCLE_API_KEY is a LIVE key but ARC_NETWORK is testnet");
}
const seller = env("SELLER_ADDRESS");
isAddr(seller) ? ok(`SELLER_ADDRESS ${seller}`) : env("X402_MOCK") === "1" ? warn("x402 in mock mode (X402_MOCK=1)") : fail("SELLER_ADDRESS missing or not an address: x402 returns 503");
if (network === "mainnet" && env("X402_MOCK") === "1") fail("X402_MOCK=1 on mainnet: profiles would be served without payment");

const legacy = env("ATTN_LEGACY_ESCROW_CONTRACTS").toLowerCase();
if (network === "mainnet" && legacy !== "none") {
  fail('ATTN_LEGACY_ESCROW_CONTRACTS must be "none" on mainnet (the testnet escrows don\'t exist there)');
} else ok(`ATTN_LEGACY_ESCROW_CONTRACTS=${legacy || "(network default)"}`);

const rpcUrl = env("ARC_RPC_URL") || expected.rpc;
const escrow = env("ATTN_ESCROW_CONTRACT");
const registry = env("ATTN_REGISTRY_CONTRACT");
if (!isAddr(escrow)) fail("ATTN_ESCROW_CONTRACT missing or not an address");
if (!isAddr(registry)) fail("ATTN_REGISTRY_CONTRACT missing or not an address");

// ── Chain ──
console.log("\nArc");
const client = createPublicClient({ transport: http(rpcUrl) });
let escrowOwner = null; // set below for a v2 escrow
try {
  const chainId = await client.getChainId();
  chainId === expected.chainId ? ok(`RPC ${rpcUrl} is chain ${chainId}`) : fail(`RPC ${rpcUrl} is chain ${chainId}, expected ${expected.chainId}`);
} catch (err) {
  fail(`RPC ${rpcUrl} unreachable: ${err.shortMessage ?? err.message}`);
}

const escrowAbi = [
  { type: "function", name: "MIN_BID", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "MAX_BID", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "REFUND_PERIOD", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "usdc", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "registry", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "getBidCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "pendingOwner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "paused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
];

if (isAddr(escrow) && isAddr(registry)) {
  try {
    const [code, regCode] = await Promise.all([client.getCode({ address: escrow }), client.getCode({ address: registry })]);
    if (!code || code === "0x") fail(`No contract at ATTN_ESCROW_CONTRACT ${escrow}`);
    if (!regCode || regCode === "0x") fail(`No contract at ATTN_REGISTRY_CONTRACT ${registry}`);
    if (code && code !== "0x" && regCode && regCode !== "0x") {
      const read = (functionName) => client.readContract({ address: escrow, abi: escrowAbi, functionName });
      const [minBid, maxBid, refund, usdc, reg, count] = await Promise.all(
        ["MIN_BID", "MAX_BID", "REFUND_PERIOD", "usdc", "registry", "getBidCount"].map(read),
      );
      getAddress(usdc) === getAddress(USDC) ? ok("Escrow holds Arc USDC") : fail(`Escrow USDC is ${usdc}, expected ${USDC}`);
      getAddress(reg) === getAddress(registry) ? ok("Escrow points at ATTN_REGISTRY_CONTRACT") : fail(`Escrow's registry is ${reg}, not ATTN_REGISTRY_CONTRACT ${registry}`);
      const appMin = env("NEXT_PUBLIC_ESCROW_MIN_BID_USDC") || "5000000";
      BigInt(appMin) === minBid
        ? ok(`Minimum bid $${Number(minBid) / 1e6} matches NEXT_PUBLIC_ESCROW_MIN_BID_USDC`)
        : fail(`Escrow MIN_BID is ${minBid} but NEXT_PUBLIC_ESCROW_MIN_BID_USDC is ${appMin}`);
      maxBid === BigInt(1_000_000_000) ? ok("Maximum bid $1,000") : fail(`Escrow MAX_BID is ${maxBid}; the app assumes $1,000`);
      refund === BigInt(3 * 24 * 3600) ? ok("Refund period 3 days") : fail(`Escrow REFUND_PERIOD is ${refund}s; the app and Spending policy say 3 days`);
      ok(`Escrow has ${count} bid(s)`);
      // v2: only fingerprints of messages/replies on-chain, and an admin that can pause new bids.
      const v2 = code.toLowerCase().includes(toFunctionSelector("acceptBid(uint256,bytes32)").slice(2).toLowerCase());
      if (!v2) {
        network === "mainnet"
          ? fail("Escrow is v1 (stores replies as public text, no pause): deploy the current contracts/src/AttnnEscrow.sol")
          : warn("Escrow is v1 (legacy testnet escrow: public reply text, no pause)");
      } else {
        ok("Escrow is v2 (fingerprints only, pause for new bids)");
        const [owner, pending, paused] = await Promise.all(["owner", "pendingOwner", "paused"].map(read));
        escrowOwner = owner;
        const admin = env("ATTN_ESCROW_ADMIN");
        if (!isAddr(admin)) {
          (network === "mainnet" ? fail : warn)(`ATTN_ESCROW_ADMIN not set (escrow owner is ${owner}); the health check can't watch it`);
        } else if (getAddress(admin) !== getAddress(owner)) {
          fail(`Escrow owner is ${owner}, but ATTN_ESCROW_ADMIN is ${admin}`);
        } else ok(`Escrow admin ${owner} matches ATTN_ESCROW_ADMIN`);
        /^0x0{40}$/i.test(pending) ? ok("No ownership handover open") : fail(`An ownership handover to ${pending} is open`);
        paused ? warn("Escrow is PAUSED: new bids are refused") : ok("Escrow is not paused");
      }
      const selector = toFunctionSelector("updateProfile(uint256,string[],string)").slice(2).toLowerCase();
      regCode.toLowerCase().includes(selector)
        ? ok("Registry supports updateProfile (tag/floor edits sync to Arc)")
        : network === "mainnet"
          ? fail("Registry has no updateProfile: deploy the current contracts/src/AttnnRegistry.sol")
          : warn("Registry has no updateProfile (original testnet registry): tag edits stay DB-only");
      const floorSelector = toFunctionSelector("minBidOf(address)").slice(2).toLowerCase();
      regCode.toLowerCase().includes(floorSelector)
        ? ok("Registry has minBidOf (the escrow enforces each creator's floor)")
        : network === "mainnet"
          ? fail("Registry has no minBidOf: the current escrow can't take bids against it. Deploy both current contracts together")
          : warn("Registry has no minBidOf (original testnet registry): only the global $ minimum is enforced on-chain");
    }
  } catch (err) {
    fail(`Could not read the contracts: ${err.shortMessage ?? err.message}`);
  }
}

// ── Database (read-only) ──
// Mainnet must start with a fresh database: a testnet wallet shown on mainnet would
// receive real USDC its key can't move. Bids from other escrows would never settle.
console.log("\nDatabase");
if (env("DATABASE_URL")) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env("DATABASE_URL"), { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const [w] = await sql`select count(*)::int as n from wallets where blockchain <> ${expected.circle}`;
    w.n === 0 ? ok(`No wallets from another network`) : fail(`${w.n} wallet(s) are not on ${expected.circle}. Use a fresh database for this network`);
    if (isAddr(escrow)) {
      const [b] = await sql`select count(*)::int as n from bids where escrow_address is null or lower(escrow_address) <> ${escrow.toLowerCase()}`;
      if (b.n === 0) ok("Every bid belongs to ATTN_ESCROW_CONTRACT");
      else if (network === "mainnet") fail(`${b.n} bid(s) belong to another escrow. Use a fresh database for mainnet`);
      else warn(`${b.n} bid(s) belong to other (legacy) escrows`);
    }
    // The escrow admin must not be a wallet Attnn. holds the keys to: then a server
    // breach could pause bids or hand the role away.
    if (escrowOwner) {
      const [own] = await sql`select count(*)::int as n from wallets where lower(address) = ${escrowOwner.toLowerCase()}`;
      own.n === 0 ? ok("The escrow admin is not an Attnn. (Circle) wallet") : fail(`The escrow admin ${escrowOwner} is an Attnn. Circle wallet: use a wallet you hold yourself`);
    }
    // Row Level Security (migration 0009) hides tables from Supabase's public REST API.
    // It doesn't restrict a table's OWNER, which is how the app connects, so every
    // table must be owned by this connection's user.
    const notOwned = await sql`select tablename from pg_tables where schemaname = 'public' and tableowner <> current_user`;
    notOwned.length === 0
      ? ok("The app's database user owns every table")
      : fail(`The app's database user doesn't own: ${notOwned.map((r) => r.tablename).join(", ")}. With RLS on, the app couldn't read them`);
    const noRls = await sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    if (noRls.length === 0) ok("Row Level Security is on for every table");
    else if (network === "mainnet") fail(`Row Level Security is off for: ${noRls.map((r) => r.relname).join(", ")} (run migration 0009)`);
    else warn(`Row Level Security is off for ${noRls.length} table(s) (run migration 0009)`);
  } catch (err) {
    fail(`Could not read the database: ${err.message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
} else {
  warn("Database not checked (DATABASE_URL missing, reported above)");
}

console.log(`\nCircle blockchain for new wallets: ${expected.circle}`);
console.log(failures ? `\n${failures} problem(s). Fix them before switching.\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);
