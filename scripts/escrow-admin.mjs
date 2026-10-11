#!/usr/bin/env node
/**
 * Escrow admin helper (v2 escrow). It NEVER takes a private key and never sends anything:
 * it reads the escrow's admin state and prints the exact transaction to sign from the
 * admin wallet (hardware wallet, multisig, or the block explorer's "Write contract" tab).
 *
 *   node --env-file=.env.local scripts/escrow-admin.mjs status
 *   node --env-file=.env.local scripts/escrow-admin.mjs pause
 *   node --env-file=.env.local scripts/escrow-admin.mjs unpause
 *   node --env-file=.env.local scripts/escrow-admin.mjs transfer 0xNewAdmin   (step 1 of a handover)
 *   node --env-file=.env.local scripts/escrow-admin.mjs accept                (step 2, from the NEW admin)
 *   node --env-file=.env.local scripts/escrow-admin.mjs cancel                (cancel an open handover)
 *
 * Needs ATTN_ESCROW_CONTRACT and (optionally) ARC_RPC_URL / ARC_NETWORK. See docs/RUNBOOK.md.
 */
import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, zeroAddress } from "viem";

const env = (k) => process.env[k]?.trim() ?? "";
const mainnet = env("ARC_NETWORK").toLowerCase() === "mainnet";
const rpc = env("ARC_RPC_URL") || (mainnet ? "https://rpc.mainnet.arc.io" : "https://rpc.testnet.arc.network");
const escrow = env("ATTN_ESCROW_CONTRACT");
if (!isAddress(escrow)) {
  console.error("Set ATTN_ESCROW_CONTRACT (e.g. node --env-file=.env.local …)");
  process.exit(1);
}

const abi = [
  { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "pendingOwner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "paused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "pause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "unpause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "transferOwnership", inputs: [{ name: "newOwner", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "acceptOwnership", inputs: [], outputs: [], stateMutability: "nonpayable" },
];

const client = createPublicClient({ transport: http(rpc) });
const read = (functionName) => client.readContract({ address: escrow, abi, functionName });

let state;
try {
  const [owner, pendingOwner, paused] = await Promise.all([read("owner"), read("pendingOwner"), read("paused")]);
  state = { owner, pendingOwner, paused };
} catch (err) {
  console.error(`Could not read the escrow's admin state (is it a v2 escrow?): ${err.shortMessage ?? err.message}`);
  process.exit(1);
}

console.log(`\nEscrow   ${escrow} (${mainnet ? "Arc MAINNET" : "Arc Testnet"})`);
console.log(`Admin    ${state.owner}`);
console.log(`Handover ${state.pendingOwner === zeroAddress ? "none open" : `open, to ${state.pendingOwner}`}`);
console.log(`New bids ${state.paused ? "PAUSED" : "open"}\n`);

const [cmd, arg] = process.argv.slice(2);
const tx = (functionName, args, from, note) => {
  console.log(`To ${functionName}: send this transaction FROM ${from}`);
  console.log(`  to:    ${escrow}`);
  console.log(`  value: 0`);
  console.log(`  data:  ${encodeFunctionData({ abi, functionName, args })}`);
  console.log(`  (explorer "Write contract": call ${functionName}(${args.join(", ")}))`);
  if (note) console.log(`\n${note}`);
  console.log("");
};

switch (cmd) {
  case undefined:
  case "status":
    break;
  case "pause":
    if (state.paused) console.log("Already paused.\n");
    else tx("pause", [], state.owner, "Then: new bids stop at once; replies, declines and refunds keep working. The hourly health check will email until you unpause.");
    break;
  case "unpause":
    if (!state.paused) console.log("Not paused.\n");
    else tx("unpause", [], state.owner);
    break;
  case "transfer":
    if (!isAddress(arg ?? "")) {
      console.error("Usage: escrow-admin.mjs transfer 0xNewAdminAddress\n");
      process.exit(1);
    }
    tx("transferOwnership", [getAddress(arg)], state.owner, `Then the NEW admin (${getAddress(arg)}) must run "accept". Until it does, nothing changes. Update ATTN_ESCROW_ADMIN in Vercel after.`);
    break;
  case "accept":
    if (state.pendingOwner === zeroAddress) console.log("No handover is open.\n");
    else tx("acceptOwnership", [], state.pendingOwner);
    break;
  case "cancel":
    if (state.pendingOwner === zeroAddress) console.log("No handover is open.\n");
    else tx("transferOwnership", [zeroAddress], state.owner, "This cancels the open handover.");
    break;
  default:
    console.error(`Unknown command "${cmd}". Use: status | pause | unpause | transfer <address> | accept | cancel\n`);
    process.exit(1);
}
