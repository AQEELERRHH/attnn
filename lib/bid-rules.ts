import { createHash } from "crypto";

/**
 * Bid rules that mirror contracts/src/AttnnEscrow.sol. If the contract constants
 * change, change them here too — the app checks them before sending a transaction
 * so users get a clear error instead of a reverted (and gas-burning) transaction.
 */
export const ESCROW_MIN_BID = BigInt(5_000_000); // $5.00
export const ESCROW_MAX_BID = BigInt(1_000_000_000); // $1,000.00
export const REFUND_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** On-chain BidStatus enum order in AttnnEscrow. */
export const ONCHAIN_STATUS = { Pending: 0, Accepted: 1, Rejected: 2, Refunded: 3 } as const;

/** Parses an atomic USDC amount (integer, 6 decimals). Rejects decimals, signs and junk. */
export function parseAtomicUsdc(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= BigInt(0) ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^\d{1,30}$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

/** $12.50 style formatting for atomic USDC. */
export function formatUsd(atomic: bigint): string {
  const negative = atomic < BigInt(0);
  const abs = negative ? -atomic : atomic;
  const cents = (abs + BigInt(5_000)) / BigInt(10_000); // round to cents
  const whole = cents / BigInt(100);
  const frac = (cents % BigInt(100)).toString().padStart(2, "0");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${wholeStr}.${frac}`;
}

/** The lowest bid a creator can receive: their floor, never below the escrow minimum. */
export function creatorFloor(creatorMinBid: string | null | undefined): bigint {
  const floor = parseAtomicUsdc(creatorMinBid ?? "0") ?? BigInt(0);
  return floor > ESCROW_MIN_BID ? floor : ESCROW_MIN_BID;
}

export type AmountCheck = { ok: true; amount: bigint } | { ok: false; error: string };

/** Validates a bid amount someone typed or sent to the API. */
export function validateBidAmount(rawAmount: unknown, creatorMinBid: string | null | undefined): AmountCheck {
  const amount = parseAtomicUsdc(rawAmount);
  if (amount === null) return { ok: false, error: "Bid amount must be a whole number of atomic USDC units" };
  const floor = creatorFloor(creatorMinBid);
  if (amount < floor) return { ok: false, error: `Bid is below this creator's floor of ${formatUsd(floor)}` };
  if (amount > ESCROW_MAX_BID) return { ok: false, error: `Bid is above the ${formatUsd(ESCROW_MAX_BID)} maximum` };
  return { ok: true, amount };
}

/**
 * Picks the amount a bidder agent should bid. The AI suggestion is only a hint:
 * it is clamped into [creator floor, min(bidder's per-creator cap, escrow max)].
 * Returns null when the creator's floor is above what the bidder allows.
 */
export function resolveAgentBidAmount(params: {
  suggested: unknown;
  creatorMinBid: string | null | undefined;
  maxBidPerCreator: string | null | undefined;
}): bigint | null {
  const floor = creatorFloor(params.creatorMinBid);
  const cap = parseAtomicUsdc(params.maxBidPerCreator ?? "") ?? ESCROW_MAX_BID;
  const ceiling = cap < ESCROW_MAX_BID ? cap : ESCROW_MAX_BID;
  if (floor > ceiling) return null;
  const suggested = parseAtomicUsdc(params.suggested);
  if (suggested === null) return floor;
  if (suggested < floor) return floor;
  if (suggested > ceiling) return ceiling;
  return suggested;
}

/**
 * Turns an operation label (e.g. "place:<bidId>") into a stable UUID v4-shaped
 * string. Used as Circle's idempotencyKey so a retried step re-sends the SAME
 * request instead of creating a second transaction.
 */
export function stableUuid(label: string): string {
  const h = createHash("sha256").update(label).digest("hex");
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Validates a creator's floor (minimum bid) from a profile form. */
export function validateCreatorFloor(raw: unknown): AmountCheck {
  const amount = parseAtomicUsdc(typeof raw === "string" ? raw.trim() : raw);
  if (amount === null) return { ok: false, error: "Minimum bid must be a whole number of atomic USDC units" };
  if (amount < ESCROW_MIN_BID) return { ok: false, error: `Minimum bid can't be below ${formatUsd(ESCROW_MIN_BID)}` };
  if (amount > ESCROW_MAX_BID) return { ok: false, error: `Minimum bid can't be above ${formatUsd(ESCROW_MAX_BID)}` };
  return { ok: true, amount };
}
