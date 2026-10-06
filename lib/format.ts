/**
 * Display formatting for market screens. Pure functions, safe on server and client.
 * Money is always atomic USDC (6 decimals) in, "$1,234.56" out — never floats.
 */
import { REFUND_PERIOD_MS, formatUsd, parseAtomicUsdc } from "./bid-rules";

export const EMPTY = "—";

/** "$35.00" from atomic USDC; "—" for null/invalid (e.g. a market with no fills yet). */
export function formatMoney(atomic: string | bigint | null | undefined): string {
  if (atomic === null || atomic === undefined) return EMPTY;
  const v = typeof atomic === "bigint" ? atomic : parseAtomicUsdc(atomic);
  return v === null ? EMPTY : formatUsd(v);
}

/** Converts a "35.5" style dollar input to atomic USDC, or null if invalid. */
export function dollarsToAtomic(input: string): bigint | null {
  const m = input.trim().replace(/^\$/, "").match(/^(\d{1,9})(?:\.(\d{0,6}))?$/);
  if (!m) return null;
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? "").padEnd(6, "0");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(frac || "0");
}

/** atomic → "35.00" (no $), for prefilling inputs. */
export function atomicToDollarInput(atomic: bigint): string {
  return formatUsd(atomic).replace(/^\$/, "").replace(/,/g, "");
}

/** "+16.7%" / "-6.7%" / "0.0%"; "—" when there's no baseline. */
export function formatChange(current: bigint | null, previous: bigint | null): string {
  if (current === null || previous === null || previous === BigInt(0)) return EMPTY;
  const bps = Number(((current - previous) * BigInt(10_000)) / previous); // basis points
  const pct = bps / 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Percent of a whole, e.g. reply rate: formatPercent(23, 25) → "92%". */
export function formatPercent(part: number, whole: number): string {
  if (!whole) return EMPTY;
  return `${Math.round((part / whole) * 100)}%`;
}

/** Compact duration: "2d 20h", "4h 56m", "12m", "<1m". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EMPTY;
  if (ms < 60_000) return "<1m";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

/** "5h ago", "just now". */
export function timeAgo(date: Date | string | number, now: number = Date.now()): string {
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return EMPTY;
  const diff = now - t;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Time left before an escrowed bid becomes refundable. Uses the DB createdAt,
 * which trails the on-chain timestamp by seconds, so it's a close estimate.
 */
export function refundCountdown(createdAt: Date | string, now: number = Date.now()): { label: string; due: boolean } {
  const left = new Date(createdAt).getTime() + REFUND_PERIOD_MS - now;
  if (left <= 0) return { label: "now", due: true };
  return { label: `in ${formatDuration(left)}`, due: false };
}

/** "0x3f…9a2c" */
export function shortAddress(addr: string | null | undefined, lead = 4, tail = 4): string {
  if (!addr) return EMPTY;
  return addr.length <= lead + tail + 2 ? addr : `${addr.slice(0, lead + 2)}…${addr.slice(-tail)}`;
}
