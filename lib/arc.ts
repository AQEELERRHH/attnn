import { defineChain } from "viem";
import { http, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const arcTestnet = /*#__PURE__*/ defineChain({
  id: 504_2002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 6,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
    deploy: {
      http: ["https://arc-testnet.drpc.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
    },
  },
  contracts: {
    usdc: {
      address: "0x3600000000000000000000000000000000000000",
    },
  },
  testnet: true,
});

// USDC ERC-20 ABI (minimal)
export const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

// Common ABI for AttnnRegistry and AttnnEscrow
export const registryAbi = [
  {
    type: "function",
    name: "registerCreator",
    inputs: [
      { name: "handle", type: "string" },
      { name: "minBid", type: "uint256" },
      { name: "tags", type: "string[]" },
      { name: "profileURI", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getCreatorProfile",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "minBid", type: "uint256" },
      { name: "tags", type: "string[]" },
      { name: "profileURI", type: "string" },
      { name: "isActive", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCreatorsByTag",
    inputs: [{ name: "tag", type: "string" }],
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "creatorExists",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isActiveCreator",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "CreatorRegistered",
    inputs: [
      { name: "creator", type: "address", indexed: true },
      { name: "handle", type: "string", indexed: false },
      { name: "minBid", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CreatorDeactivated",
    inputs: [
      { name: "creator", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "CreatorActivated",
    inputs: [
      { name: "creator", type: "address", indexed: true },
    ],
  },
] as const;

export const escrowAbi = [
  {
    type: "function",
    name: "placeBid",
    inputs: [
      { name: "creator", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "message", type: "string" },
      { name: "isPrivate", type: "bool" },
    ],
    outputs: [{ name: "bidId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "acceptBid",
    inputs: [
      { name: "bidId", type: "uint256" },
      { name: "reply", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rejectBid",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimRefund",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getBid",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [
      { name: "bidder", type: "address" },
      { name: "creator", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "message", type: "string" },
      { name: "reply", type: "string" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCreatorBids",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBidderBids",
    inputs: [{ name: "bidder", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBidCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "BidPlaced",
    inputs: [
      { name: "bidId", type: "uint256", indexed: true },
      { name: "bidder", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BidAccepted",
    inputs: [
      { name: "bidId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "reply", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BidRejected",
    inputs: [
      { name: "bidId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "BidRefunded",
    inputs: [
      { name: "bidId", type: "uint256", indexed: true },
      { name: "bidder", type: "address", indexed: true },
    ],
  },
] as const;

// Public client for reads
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://rpc.testnet.arc.network"),
});

// Wallet client for deployer
export const getWalletClient = (privateKey: `0x${string}`) => {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: http("https://arc-testnet.drpc.org"),
  });
};

// ─── USDC Constants ──────────────────────────────────────────────────────────

export const USDC_DECIMALS = 6;
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

export const parseUsdc = (amount: string): bigint => {
  const [whole = "0", fraction = ""] = amount.split(".");
  const paddedFraction = (fraction.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS)) || "0";
  const fracBigInt = BigInt(paddedFraction);
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + fracBigInt;
};

export const formatUsdc = (amount: bigint): string => {
  const str = amount.toString().padStart(USDC_DECIMALS + 1, "0");
  const whole = str.slice(0, -USDC_DECIMALS) || "0";
  const fraction = str.slice(-USDC_DECIMALS);
  return `${whole}.${fraction}`;
};
