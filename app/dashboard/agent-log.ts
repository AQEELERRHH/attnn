import { formatMoney } from "@/lib/format";
import type { LogPayload } from "./types";

export type LogKind = "discovery" | "bid" | "settled" | "stop" | "error" | "other";

/** Which filter a log line belongs to, and its tone in the run log. */
export function logKind(action: string): LogKind {
  switch (action) {
    case "creator_discovered":
    case "creator_scored":
      return "discovery";
    case "bid_placed":
      return "bid";
    case "bid_accepted":
    case "bid_rejected":
    case "auto_accept":
    case "refund_claimed":
      return "settled";
    case "agent_started":
    case "agent_stopped":
      return "stop";
    case "error":
      return "error";
    default:
      return "other";
  }
}

const money = (v: unknown) => (typeof v === "string" || typeof v === "bigint" ? formatMoney(v) : "");
const short = (v: unknown) => (typeof v === "string" && v.length > 10 ? `${v.slice(0, 8)}…` : String(v ?? ""));

/** One readable sentence for an agent_logs row. The data shape varies by action. */
export function logMessage(action: string, data: LogPayload): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const agent = typeof d.agentName === "string" && d.agentName ? d.agentName : "Your agent";
  const plural = (n: unknown, word: string) => `${n ?? 0} ${word}${n === 1 ? "" : "s"}`;
  switch (action) {
    case "creator_discovered":
      return [
        `${agent} found ${plural(d.count, "creator")}`,
        d.scored !== undefined ? `scored ${d.scored}` : null,
        d.bidsPlaced !== undefined ? `queued ${plural(d.bidsPlaced, "bid")}` : null,
        typeof d.unscored === "number" && d.unscored > 0 ? `skipped ${d.unscored} (AI unavailable)` : null,
        typeof d.reason === "string" ? d.reason.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(", ") + ".";
    case "creator_scored":
      return `${agent} scored ${d.creator ? `@${d.creator}` : "a creator"}${d.score !== undefined ? ` ${d.score}/10` : ""}.`;
    case "bid_placed":
      return `${agent} bid ${money(d.amount)}${d.creator ? ` on @${d.creator}` : ""}${d.score !== undefined ? ` · fit ${d.score}/10` : ""}.`;
    case "bid_accepted":
      return `Bid accepted${d.creator ? ` by @${d.creator}` : ""}${d.amount ? ` · ${money(d.amount)}` : ""}.`;
    case "bid_rejected":
      return `Bid declined${d.creator ? ` by @${d.creator}` : ""}.`;
    case "auto_accept":
      return `Auto-accepted ${d.amount ? money(d.amount) : "a bid"}${d.bidder ? ` from ${short(d.bidder)}` : ""}.`;
    case "agent_started":
      return `${agent} started.`;
    case "agent_stopped":
      return `${agent} stopped: ${typeof d.reason === "string" ? d.reason : "no reason given"}.`;
    case "refund_claimed":
      return `Refund claimed${d.bidId ? ` for bid ${short(d.bidId)}` : ""}.`;
    case "webhook_received":
      return `On-chain event received${d.bidId ? ` · bid ${short(d.bidId)}` : ""}.`;
    case "error":
      return `Error: ${typeof d.error === "string" ? d.error : "unknown"}`;
    default: {
      const parts = Object.entries(d)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
      return parts.length ? `${action.replace(/_/g, " ")} · ${parts.join(" · ")}` : action.replace(/_/g, " ");
    }
  }
}
