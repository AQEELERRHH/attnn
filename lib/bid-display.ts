/**
 * How a bid row is shown to people. One mapping, used by every screen, so a bid
 * never reads "accepted" in one place and "pending" in another.
 *
 * Mirrors the lifecycle in lib/bids.ts:
 *   placing → Confirming on Arc · pending → Escrowed (or Confirming if a
 *   settlement is in flight) · accepted/rejected/refunded → final · failed → Not placed
 */
import type { BidStatus } from "./db/schema";

export type StatusTone = "neutral" | "pending" | "success" | "danger" | "muted";

export interface BidDisplay {
  label: string;
  tone: StatusTone;
  /** One-line explanation for the user, or null. */
  note: string | null;
}

const SETTLING_LABEL: Record<string, string> = {
  accept: "Paying out",
  reject: "Refunding",
  refund: "Refunding",
};

export function bidDisplay(
  bid: {
    status: BidStatus;
    settlementTxHash?: string | null;
    settlementAction?: string | null;
    failReason?: string | null;
  },
  viewer: "bidder" | "creator" = "bidder",
): BidDisplay {
  switch (bid.status) {
    case "placing":
      return { label: "Confirming on Arc", tone: "pending", note: "Escrowing USDC. Not counted in balances yet." };
    case "pending":
    case "counter_offered":
      if (bid.settlementTxHash) {
        return {
          label: SETTLING_LABEL[bid.settlementAction ?? ""] ?? "Confirming",
          tone: "pending",
          note: "Waiting for the transaction to complete on Arc.",
        };
      }
      if (bid.status === "counter_offered") {
        return {
          label: "Countered",
          tone: "neutral",
          note: viewer === "creator" ? "You asked for more. USDC stays escrowed." : "The creator asked for more.",
        };
      }
      return {
        label: "Escrowed",
        tone: "neutral",
        note: bid.failReason ? `Last attempt failed: ${bid.failReason}` : null,
      };
    case "accepted":
      return { label: viewer === "creator" ? "Paid" : "Replied · paid", tone: "success", note: null };
    case "rejected":
      return { label: "Declined · refunded", tone: "muted", note: null };
    case "refunded":
      return { label: "Refunded", tone: "muted", note: null };
    case "failed":
      return { label: "Not placed", tone: "danger", note: bid.failReason ?? "No USDC moved." };
  }
}

/** True if this bid's USDC is (or is about to be) locked in escrow. */
export function isOpenBid(status: BidStatus): boolean {
  return status === "pending" || status === "counter_offered";
}
