"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Search, DollarSign, CheckCircle, XCircle, RotateCcw,
  Play, Pause, Wifi, AlertTriangle, Activity,
} from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface LogData { id: string; action: string; data: any; txHash: string | null; createdAt: string; }
interface BidData {
  id: string; bidderUserId: string; creatorUserId: string; bidderAddress: string; creatorAddress: string;
  amountUsdc: string; status: string; reply: string | null; createdAt: string; settledAt: string | null;
}

function formatAmount(amount: string) {
  const n = Number(BigInt(amount || "0")) / 1_000_000;
  return "$" + n.toFixed(2);
}

const ACTION_ICON: Record<string, React.ElementType> = {
  creator_discovered: Search,
  bid_placed: DollarSign,
  bid_accepted: CheckCircle,
  auto_accept: CheckCircle,
  bid_rejected: XCircle,
  refund_claimed: RotateCcw,
  agent_started: Play,
  agent_stopped: Pause,
  webhook_received: Wifi,
  error: AlertTriangle,
};

const ACTION_COLOR: Record<string, string> = {
  creator_discovered: "text-arc-purple",
  bid_placed: "text-arc-gold",
  bid_accepted: "text-green",
  auto_accept: "text-green",
  bid_rejected: "text-arc-coral",
  refund_claimed: "text-arc-lavender",
  agent_started: "text-green",
  agent_stopped: "text-text-secondary",
  webhook_received: "text-arc-purple",
  error: "text-arc-coral",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMessage(action: string, data: any): string {
  const agentName = data?.agentName ?? "Your agent";
  switch (action) {
    case "creator_discovered":
      return `${agentName} discovered ${data?.count ?? 0} creator${data?.count !== 1 ? "s" : ""}${data?.scored ? `, scored ${data.scored}` : ""}${data?.bidsPlaced ? `, placed ${data.bidsPlaced} bid${data.bidsPlaced !== 1 ? "s" : ""}` : ""}.`;
    case "bid_placed":
      return `${agentName} placed ${data?.amount ? formatAmount(data.amount) : ""} bid${data?.creator ? ` on @${data.creator}` : ""}${data?.score !== undefined ? ` · fit score ${data.score}/10` : ""}.`;
    case "bid_accepted":
      return `Bid accepted${data?.creator ? ` by @${data.creator}` : ""}${data?.amount ? ` · ${formatAmount(data.amount)}` : ""}.`;
    case "auto_accept":
      return `Auto-accepted bid${data?.amount ? ` of ${formatAmount(data.amount)}` : ""}${data?.bidder ? ` from ${data.bidder}` : ""}.`;
    case "bid_rejected":
      return `Bid rejected${data?.creator ? ` by @${data.creator}` : ""}.`;
    case "agent_stopped":
      return `${agentName} stopped · ${data?.reason ?? "unknown reason"}.`;
    case "agent_started":
      return `${agentName} started.`;
    case "refund_claimed":
      return `Refund processed for bid ${data?.bidId ? data.bidId.slice(0, 8) + "…" : ""}.`;
    case "webhook_received":
      return `On-chain event received · bid ID ${data?.bidId ?? "unknown"}.`;
    case "error":
      return `Error: ${data?.error ?? "unknown"}.`;
    default:
      return Object.entries(data ?? {}).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ") || action;
  }
}

const FILTERS = ["all", "creators", "bids", "accepted"] as const;
type Filter = typeof FILTERS[number];

export function ActivityPanel({
  logs, bids, userId, bidderConfig,
}: {
  logs: LogData[];
  bids: BidData[];
  userId: string;
  bidderConfig?: { isActive: boolean; agentName?: string | null } | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  // Summary stats
  const creatorsFound = Math.max(...logs.filter(l => l.action === "creator_discovered").map(l => l.data?.count ?? 0), 0);
  const agentBids = logs.filter(l => l.action === "bid_placed").length;
  const accepted = bids.filter(b => (b.bidderUserId === userId || b.creatorUserId === userId) && b.status === "accepted").length;
  const totalBidValue = bids.filter(b => b.bidderUserId === userId).reduce((sum, b) => sum + Number(BigInt(b.amountUsdc || "0")) / 1_000_000, 0);

  const filteredItems = filter === "accepted"
    ? bids.filter(b => (b.bidderUserId === userId || b.creatorUserId === userId) && b.status === "accepted")
        .map(b => ({
          id: b.id, action: "bid_accepted" as const,
          data: { creator: b.creatorAddress.slice(0, 6) + "…" + b.creatorAddress.slice(-4), amount: b.amountUsdc, reply: b.reply },
          txHash: null, createdAt: b.settledAt ?? b.createdAt,
        }))
    : logs.filter(log => {
        if (filter === "creators") return log.action === "creator_discovered";
        if (filter === "bids") return log.action === "bid_placed";
        return true;
      });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-lg">Agent Activity</h2>
          <p className="text-xs text-text-secondary mt-0.5">Real-time updates from agent discovery and bidding.</p>
        </div>
        {bidderConfig?.isActive && (
          <div className="flex items-center gap-1.5 text-xs text-green">
            <Activity className="w-3.5 h-3.5" />
            <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
            {bidderConfig.agentName ?? "Agent"} Live
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Creators Found", value: creatorsFound, color: "text-arc-purple" },
          { label: "Agent Bids", value: agentBids, color: "text-arc-gold" },
          { label: "Accepted", value: accepted, color: "text-green" },
          { label: "Total Bid Value", value: `$${totalBidValue.toFixed(2)}`, color: "text-arc-coral" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4 text-center">
            <div className={`text-xl font-display font-bold tabular-nums ${color}`}>{value}</div>
            <div className="text-xs text-text-secondary mt-1">{label}</div>
          </Card>
        ))}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f ? "bg-arc-gold text-arc-bg-0" : "border border-border text-text-secondary hover:text-text-primary"}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Feed */}
      {filteredItems.length === 0 ? (
        <Card className="p-10 text-center text-text-dim text-sm">
          No activity yet. Run your agent to get started.
        </Card>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden bg-arc-bg-1/40">
          {filteredItems.map((log) => {
            const Icon = ACTION_ICON[log.action] ?? Activity;
            const color = ACTION_COLOR[log.action] ?? "text-text-secondary";
            return (
              <div key={log.id} className="flex gap-3 px-4 py-3 items-start hover:bg-arc-bg-2/30 transition-colors">
                <Icon className={`w-4 h-4 ${color} shrink-0 mt-0.5`} />
                <p className="flex-1 text-sm text-text-primary leading-relaxed">{buildMessage(log.action, log.data)}</p>
                <span className="text-xs text-text-dim shrink-0 tabular-nums mt-0.5">
                  {new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })}
          {logs.length > 0 && filter === "all" && (
            <div className="px-4 py-2 text-xs text-text-dim text-center bg-arc-bg-2/20">
              Showing last {Math.min(filteredItems.length, 50)} entries
            </div>
          )}
        </div>
      )}
    </div>
  );
}
