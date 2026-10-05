"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BidderSetupForm } from "./BidderSetupForm";
import { toast } from "@/hooks/use-toast";
import { Play, Square, Zap, Bot, DollarSign, Target, TrendingUp, Shield } from "lucide-react";

interface BidderConfigData {
  id: string; goal: string | null; dailyBudget: string; maxBidPerCreator: string;
  minFitScore: number; searchTags: string[]; defaultMessage: string | null;
  isActive: boolean; agentName: string | null;
}
interface BidData { id: string; bidderUserId: string; status: string; amountUsdc: string; createdAt: string; }

function formatAmount(amount: string) {
  const n = Number(BigInt(amount || "0")) / 1_000_000;
  return "$" + n.toFixed(2);
}

export function AgentPanel({
  bidderConfig, bids, userId,
}: {
  bidderConfig: BidderConfigData | null;
  bids: BidData[];
  userId: string;
}) {
  const router = useRouter();
  const [editingBidder, setEditingBidder] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  const dailySpend = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return bids
      .filter(b => b.bidderUserId === userId && new Date(b.createdAt) >= today)
      .reduce((sum, b) => {
        const raw = b.amountUsdc || "0";
        const amount = typeof raw === "string" && raw.includes(".") ? parseFloat(raw) * 1_000_000 : Number(raw);
        return sum + (amount / 1_000_000);
      }, 0);
  }, [bids, userId]);

  const dailyBudgetUsd = bidderConfig ? Number(BigInt(bidderConfig.dailyBudget || "0")) / 1_000_000 : 0;
  const spendPct = dailyBudgetUsd > 0 ? Math.min((dailySpend / dailyBudgetUsd) * 100, 100) : 0;
  const remaining = Math.max(dailyBudgetUsd - dailySpend, 0);
  const totalBids = bids.filter(b => b.bidderUserId === userId).length;
  const acceptedBids = bids.filter(b => b.bidderUserId === userId && b.status === "accepted").length;

  const handleRunAgent = async () => {
    setAgentRunning(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Agent run complete", description: `${data.result?.bidsPlaced ?? 0} bids placed`, variant: "success" });
      } else {
        toast({ title: "Agent error", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to run agent", variant: "destructive" });
    }
    setAgentRunning(false);
    router.refresh();
  };

  const handleToggleActive = async () => {
    if (!bidderConfig) return;
    setTogglingActive(true);
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, bidderActive: !bidderConfig.isActive }),
    });
    setTogglingActive(false);
    router.refresh();
  };

  if (!bidderConfig || editingBidder) {
    return (
      <BidderSetupForm
        userId={userId}
        existingConfig={bidderConfig}
        onComplete={() => { setEditingBidder(false); router.refresh(); }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Agent header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1 flex-wrap">
            <Bot className="w-5 h-5 text-arc-purple" />
            <h2 className="font-display font-bold text-xl">{bidderConfig.agentName ?? "Bidder Agent"}</h2>
            <Badge variant={bidderConfig.isActive ? "success" : "default"} className="text-xs">
              {bidderConfig.isActive ? "Active" : "Paused"}
            </Badge>
          </div>
          {bidderConfig.goal && (
            <p className="text-sm text-text-secondary mt-0.5 max-w-xl">{bidderConfig.goal}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap sm:shrink-0">
          <Button
            variant={bidderConfig.isActive ? "destructive" : "default"} size="sm"
            onClick={handleToggleActive} disabled={togglingActive}
            className="min-h-[44px] flex-1 sm:flex-none"
          >
            {bidderConfig.isActive
              ? <><Square className="w-3.5 h-3.5 mr-1.5" /> Pause</>
              : <><Play className="w-3.5 h-3.5 mr-1.5" /> Activate</>
            }
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditingBidder(true)} className="min-h-[44px] flex-1 sm:flex-none">Edit</Button>
          <Button variant="outline" size="sm" onClick={handleRunAgent} disabled={agentRunning} className="min-h-[44px] flex-1 sm:flex-none">
            <Zap className="w-3.5 h-3.5 mr-1.5" /> {agentRunning ? "Running…" : "Run Now"}
          </Button>
        </div>
      </div>

      {/* Budget card — the key "human sets boundaries" surface */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-arc-gold" />
          <h3 className="font-display font-bold text-sm uppercase tracking-wider text-text-secondary">Agent Budget</h3>
          <span className="ml-auto text-xs text-text-secondary">Human-set limit · Agent executes within</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <div className="text-xs text-text-dim mb-1">Daily Limit</div>
            <div className="text-xl font-display font-bold tabular-nums">${dailyBudgetUsd.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-dim mb-1">Today&apos;s Spend</div>
            <div className="text-xl font-display font-bold tabular-nums text-arc-gold">${dailySpend.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-dim mb-1">Remaining</div>
            <div className={`text-xl font-display font-bold tabular-nums ${remaining <= 0 ? "text-arc-coral" : "text-green"}`}>${remaining.toFixed(2)}</div>
          </div>
        </div>
        {/* Budget bar */}
        <div className="h-1.5 rounded-full bg-arc-bg-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${spendPct >= 90 ? "bg-arc-coral" : spendPct >= 60 ? "bg-arc-gold" : "bg-green"}`}
            style={{ width: `${spendPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-text-dim mt-1">
          <span>{spendPct.toFixed(0)}% used</span>
          <span>Resets daily 00:00 UTC</span>
        </div>
        {remaining <= 0 && (
          <div className="text-xs text-arc-coral mt-2 font-medium">Daily limit reached — agent paused until reset</div>
        )}
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: DollarSign, label: "Total Bids", value: totalBids, color: "text-arc-gold" },
          { icon: TrendingUp, label: "Accepted", value: acceptedBids, color: "text-green" },
          { icon: Target, label: "Min Fit Score", value: bidderConfig.minFitScore + "/10", color: "text-arc-lavender" },
          { icon: DollarSign, label: "Max / Creator", value: formatAmount(bidderConfig.maxBidPerCreator), color: "text-arc-purple" },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <span className="text-xs text-text-secondary">{label}</span>
            </div>
            <div className={`text-xl font-display font-bold tabular-nums ${color}`}>{value}</div>
          </Card>
        ))}
      </div>

      {/* Config summary */}
      <Card className="p-5">
        <h3 className="font-display font-bold text-sm mb-3">Configuration</h3>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-secondary">Search tags</span>
            <span className="text-text-primary">{bidderConfig.searchTags.length > 0 ? bidderConfig.searchTags.join(", ") : "Any"}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-secondary">Default message</span>
            <span className="text-text-primary truncate max-w-xs">{bidderConfig.defaultMessage ? bidderConfig.defaultMessage.slice(0, 30) + "…" : "—"}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
