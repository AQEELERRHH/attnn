import { defineChain, type Chain } from "viem";

/**
 * Single source of truth for which Arc network the app talks to.
 *
 * Set ARC_NETWORK=mainnet to switch. Everything that differs between networks
 * (chain id, Circle blockchain name, x402 network id, Gateway wallet, RPC, explorer)
 * comes from here, so a mainnet move is config plus new contract addresses.
 *
 * Arc uses USDC as its native gas token. The native balance has 18 decimals; the
 * ERC-20 interface at 0x3600…0000 exposes the same balance with 6 decimals. All app
 * amounts use the ERC-20 (6-decimal) view.
 */
export type ArcNetwork = "testnet" | "mainnet";

interface ArcNetworkConfig {
  network: ArcNetwork;
  chain: Chain;
  /** Blockchain identifier used by Circle's Wallets and Contracts APIs. */
  circleBlockchain: "ARC-TESTNET" | "ARC";
  /** CAIP-2 id used in x402 payment requirements. */
  caip2: `eip155:${number}`;
  usdcAddress: `0x${string}`;
  gatewayWallet: `0x${string}`;
  rpcUrl: string;
  explorerUrl: string;
}

const USDC = "0x3600000000000000000000000000000000000000" as const;

function buildChain(params: {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  testnet: boolean;
}): Chain {
  return defineChain({
    id: params.id,
    name: params.name,
    nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
    rpcUrls: { default: { http: [params.rpcUrl] } },
    blockExplorers: { default: { name: "Arc Explorer", url: params.explorerUrl } },
    contracts: { usdc: { address: USDC } },
    testnet: params.testnet,
  });
}

function resolveNetwork(): ArcNetwork {
  const raw = (process.env.ARC_NETWORK ?? "testnet").trim().toLowerCase();
  if (raw === "mainnet") return "mainnet";
  if (raw !== "testnet") {
    console.warn(`ARC_NETWORK="${raw}" is not "testnet" or "mainnet"; using testnet`);
  }
  return "testnet";
}

function load(): ArcNetworkConfig {
  const network = resolveNetwork();
  if (network === "mainnet") {
    const rpcUrl = process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
    const explorerUrl = process.env.ARC_EXPLORER_URL || "https://explorer.arc.io";
    return {
      network,
      chain: buildChain({ id: 5042, name: "Arc", rpcUrl, explorerUrl, testnet: false }),
      circleBlockchain: "ARC",
      caip2: "eip155:5042",
      usdcAddress: USDC,
      gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
      rpcUrl,
      explorerUrl,
    };
  }
  const rpcUrl = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const explorerUrl = process.env.ARC_EXPLORER_URL || "https://testnet.arcscan.app";
  return {
    network,
    chain: buildChain({ id: 5042002, name: "Arc Testnet", rpcUrl, explorerUrl, testnet: true }),
    circleBlockchain: "ARC-TESTNET",
    caip2: "eip155:5042002",
    usdcAddress: USDC,
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    rpcUrl,
    explorerUrl,
  };
}

export const arc: ArcNetworkConfig = load();

/** Escrow address from env, lower-cased, or null when not configured. */
export function escrowAddress(): `0x${string}` | null {
  const addr = process.env.ATTN_ESCROW_CONTRACT?.trim();
  return addr ? (addr.toLowerCase() as `0x${string}`) : null;
}

/**
 * Earlier AttnnEscrow deployments that may still hold USDC for old bids. Bids in
 * them can still be accepted, declined and refunded (same ABI), but new bids only
 * ever go to escrowAddress(). Comma-separated ATTN_LEGACY_ESCROW_CONTRACTS
 * overrides the default ("none" disables it); on testnet the default is the
 * original 14-day escrow.
 */
const TESTNET_LEGACY_ESCROWS = ["0x3066138a56f75206aedd1a6e7d11c8244e278ab3"] as const;

export function legacyEscrowAddresses(): `0x${string}`[] {
  // Empty/unset = the network default; "none" turns legacy escrows off.
  const raw = process.env.ATTN_LEGACY_ESCROW_CONTRACTS?.trim();
  const list =
    raw
      ? raw.toLowerCase() === "none" ? [] : raw.split(",").map((a) => a.trim()).filter(Boolean)
      : arc.network === "testnet"
        ? [...TESTNET_LEGACY_ESCROWS]
        : [];
  const current = escrowAddress();
  return [...new Set(list.map((a) => a.toLowerCase() as `0x${string}`))].filter((a) => a !== current);
}

/** Every escrow the app may settle bids in: the current one first, then legacy ones. */
export function knownEscrowAddresses(): `0x${string}`[] {
  const current = escrowAddress();
  return [...(current ? [current] : []), ...legacyEscrowAddresses()];
}

export function txUrl(hash: string): string {
  return `${arc.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}
