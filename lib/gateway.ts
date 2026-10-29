/**
 * The bidder agent as an x402 buyer: it pays $0.001 per creator profile it reads, from
 * a small "read balance" the user adds to Circle Gateway from the agent wallet.
 *
 * How the money moves:
 *   - Adding a read balance (user action, Agent tab): the agent wallet approves the
 *     Gateway wallet contract for exactly that amount and deposits it (two Circle
 *     transactions, inngest `fundAgentReads`). The balance belongs to the agent wallet.
 *   - Each read: the agent wallet signs an EIP-3009 TransferWithAuthorization for the
 *     price, addressed to the Gateway wallet contract (Circle signs it; nothing goes
 *     on-chain from us). Gateway verifies, settles in batches, gas-free.
 *
 * The agent only ever pays Attnn.'s own profile endpoint (agentReadsBaseUrl), and
 * checkPaymentOption() refuses any 402 that asks for more than PROFILE_READ_PRICE, on
 * another network, in another asset or through another contract.
 */
import { getAddress, type Abi, type Address, type Hex } from "viem";
import { arc } from "./chain";
import { signTypedDataWithCircle } from "./circle";

/** $0.001 in atomic USDC: what /api/c/[handle] charges, and the most the agent will pay per read. */
export const PROFILE_READ_PRICE = BigInt(1_000);

/** Read balance amounts a user can add from the Agent tab: $0.10, $0.50, $1.00. */
export const READ_FUNDING_OPTIONS = [BigInt(100_000), BigInt(500_000), BigInt(1_000_000)] as const;

/** The most a read balance may hold ($2.00 = 2,000 reads), so little USDC sits outside the wallets. */
export const READ_BALANCE_MAX = BigInt(2_000_000);

/** A creator's profile is bought at most once per bidder in this window (re-reads use the copy). */
export const PROFILE_READ_TTL_MS = 24 * 60 * 60 * 1000;

/** Circle Gateway's domain id for Arc (testnet and mainnet). */
export const ARC_GATEWAY_DOMAIN = 26;

export const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/** The agent pays for profiles only when the paywall is set up, unless switched off (AGENT_X402=0). */
export function agentReadsEnabled(): boolean {
  if (process.env.AGENT_X402?.trim() === "0") return false;
  return !!(process.env.SELLER_ADDRESS?.trim() || process.env.X402_MOCK === "1");
}

/** Where the agent buys profiles: this deployment's own public origin. */
export function agentReadsBaseUrl(): string {
  const raw = process.env.AUTH_URL || process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!raw) throw new Error("AUTH_URL is not set, so the agent can't reach the profile endpoint");
  return new URL(raw).origin;
}

/**
 * The agent wallet's available Gateway balance, in atomic USDC (Gateway's own API, which
 * already subtracts reads that are signed but not yet settled on-chain).
 */
export async function gatewayBalance(depositor: string): Promise<bigint> {
  const res = await fetch(`${arc.gatewayApiUrl}/v1/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ depositor, domain: ARC_GATEWAY_DOMAIN }] }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as { balances?: { balance?: string }[]; message?: string } | null;
  if (!res.ok) throw new Error(`Gateway balance lookup failed (${res.status})${data?.message ? `: ${data.message}` : ""}`);
  return parseUsdcDecimal(data?.balances?.[0]?.balance ?? "0");
}

/** "0.123456" → 123456n. Gateway reports balances as decimal strings. */
export function parseUsdcDecimal(v: string): bigint {
  const m = /^(\d+)(?:\.(\d{0,6})\d*)?$/.exec(v.trim());
  if (!m) throw new Error(`Unexpected Gateway balance "${v}"`);
  return BigInt(m[1]!) * BigInt(1_000_000) + BigInt((m[2] ?? "").padEnd(6, "0"));
}

// ─── Signing ─────────────────────────────────────────────────────────────────

interface TypedDataParams {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * The eth_signTypedData_v4 JSON Circle's signing API expects: the EIP712Domain type
 * spelled out, and every bigint as a decimal string (JSON has no bigints).
 */
export function eip712Json(p: TypedDataParams): string {
  const domainFields = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ];
  const message = Object.fromEntries(Object.entries(p.message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
  return JSON.stringify({
    types: { EIP712Domain: domainFields, ...p.types },
    domain: p.domain,
    primaryType: p.primaryType,
    message,
  });
}

/** A BatchEvmSigner backed by the agent's Circle wallet. */
export function circleSigner(walletId: string, address: string) {
  return {
    address: getAddress(address),
    signTypedData: (p: TypedDataParams): Promise<Hex> =>
      signTypedDataWithCircle(walletId, eip712Json(p), "Attnn. agent: pay for a creator profile (x402)"),
  };
}

// ─── Buying a profile ────────────────────────────────────────────────────────

export interface PaymentOption {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

const sameAddress = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Why the agent won't sign this payment option, or null if it's the one it expects: Gateway
 * batching on this Arc network, in USDC, through the Gateway wallet, for at most `maxAmount`.
 */
export function checkPaymentOption(opt: PaymentOption | undefined, maxAmount = PROFILE_READ_PRICE): string | null {
  if (!opt) return "no payment option offered";
  if (opt.scheme !== "exact") return `unsupported scheme ${opt.scheme}`;
  if (opt.network !== arc.caip2) return `wrong network ${opt.network}`;
  if (!sameAddress(opt.asset, arc.usdcAddress)) return "not USDC";
  if (opt.extra?.name !== "GatewayWalletBatched" || opt.extra?.version !== "1") return "not a Circle Gateway payment";
  if (!sameAddress(opt.extra?.verifyingContract, arc.gatewayWallet)) return "unexpected Gateway contract";
  if (typeof opt.payTo !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(opt.payTo)) return "missing seller address";
  let amount: bigint;
  try {
    amount = BigInt(opt.amount);
  } catch {
    return "unreadable price";
  }
  if (amount <= BigInt(0) || amount > maxAmount) return `price ${opt.amount} is above the ${maxAmount} limit`;
  return null;
}

export interface BoughtProfile {
  profile: {
    handle: string;
    bio: string | null;
    tags: string[];
    minBid: string;
    availabilityStatus: string;
    isActive: boolean;
  };
  /** Gateway's settlement reference; "" if the server sent no receipt. */
  transaction: string;
  amount: bigint;
}

export class ProfileReadError extends Error {}

type Signer = ReturnType<typeof circleSigner>;

/**
 * GET {baseUrl}/api/c/{handle}, paying the 402 with `signer`. One signed payment per call;
 * a server that answers anything but 402 then 200 is an error (nothing else is signed).
 */
export async function buyProfile(params: { baseUrl: string; handle: string; signer: Signer; maxAmount?: bigint }): Promise<BoughtProfile> {
  const url = `${params.baseUrl}/api/c/${encodeURIComponent(params.handle)}`;
  const first = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (first.status !== 402) throw new ProfileReadError(`expected a 402 payment request, got ${first.status}`);

  let required: { x402Version?: number; resource?: unknown; accepts?: PaymentOption[] };
  try {
    required = JSON.parse(Buffer.from(first.headers.get("PAYMENT-REQUIRED") ?? "", "base64").toString("utf-8"));
  } catch {
    throw new ProfileReadError("unreadable PAYMENT-REQUIRED header");
  }
  const option = required.accepts?.find((o) => o.extra?.name === "GatewayWalletBatched") ?? required.accepts?.[0];
  const refused = checkPaymentOption(option, params.maxAmount ?? PROFILE_READ_PRICE);
  if (refused || !option) throw new ProfileReadError(`won't pay: ${refused}`);

  const { BatchEvmScheme } = await import("@circle-fin/x402-batching/client");
  const scheme = new BatchEvmScheme(params.signer);
  const x402Version = required.x402Version ?? 2;
  const payment = await scheme.createPaymentPayload(x402Version, option);
  const header = Buffer.from(JSON.stringify({ ...payment, resource: required.resource, accepted: option })).toString("base64");

  const paid = await fetch(url, {
    headers: { Accept: "application/json", "Payment-Signature": header },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await paid.json().catch(() => null)) as { profile?: BoughtProfile["profile"]; payment?: { transaction?: string }; error?: string; reason?: string } | null;
  if (!paid.ok || !body?.profile) {
    throw new ProfileReadError(`payment refused (${paid.status})${body?.reason ? `: ${body.reason}` : body?.error ? `: ${body.error}` : ""}`);
  }
  return { profile: body.profile, transaction: body.payment?.transaction ?? "", amount: BigInt(option.amount) };
}
