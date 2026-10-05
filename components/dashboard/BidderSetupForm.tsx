"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

interface BidderConfigData {
  id: string; goal: string | null; dailyBudget: string; maxBidPerCreator: string;
  minFitScore: number; searchTags: string[]; defaultMessage: string | null;
  isActive: boolean; agentName: string | null;
}

export function BidderSetupForm({
  userId: _userId,
  onComplete,
  existingConfig,
}: {
  userId: string;
  onComplete: () => void;
  existingConfig?: BidderConfigData | null;
}) {
  const [goal, setGoal] = useState(existingConfig?.goal ?? "");
  const [dailyBudget, setDailyBudget] = useState(existingConfig?.dailyBudget ? (Number(BigInt(existingConfig.dailyBudget)) / 1_000_000).toString() : "50");
  const [searchTags, setSearchTags] = useState(existingConfig?.searchTags?.join(", ") ?? "");
  const [minFitScore, setMinFitScore] = useState(existingConfig?.minFitScore != null ? existingConfig.minFitScore.toString() : "5");
  const [maxBidPerCreator, setMaxBidPerCreator] = useState(existingConfig?.maxBidPerCreator ? (Number(BigInt(existingConfig.maxBidPerCreator)) / 1_000_000).toString() : "20");
  const [agentName, setAgentName] = useState(existingConfig?.agentName ?? "");
  const [defaultMessage, setDefaultMessage] = useState(existingConfig?.defaultMessage ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/bidder-config/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal || null,
          dailyBudget: (parseFloat(dailyBudget) * 1_000_000).toString(),
          searchTags: searchTags.split(",").map(t => t.trim()).filter(Boolean),
          minFitScore: parseInt(minFitScore),
          maxBidPerCreator: (parseFloat(maxBidPerCreator) * 1_000_000).toString(),
          agentName: agentName || null,
          defaultMessage: defaultMessage || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Bidder agent configured!", variant: "success" });
        onComplete();
      } else {
        setError(data.error ?? "Failed to configure agent");
      }
    } catch {
      setError("Something went wrong");
    }
    setLoading(false);
  };

  return (
    <Card className="p-8">
      <h3 className="font-display font-bold text-lg mb-2">Configure Bidder Agent</h3>
      <p className="text-sm text-text-secondary mb-6">Set your budget and criteria for discovering creators.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Agent Name</label>
          <Input placeholder="e.g. Aqeelerh Scout" value={agentName} onChange={e => setAgentName(e.target.value)} />
          <p className="text-xs text-text-dim mt-1">How creators will identify your agent.</p>
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Goal</label>
          <Input placeholder="e.g. finding senior Solidity developers on Arc" value={goal} onChange={e => setGoal(e.target.value)} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-text-secondary mb-1 block">Daily Budget (USDC)</label>
            <Input type="number" step="0.01" min="5" placeholder="50" value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} required />
          </div>
          <div>
            <label className="text-sm text-text-secondary mb-1 block">Min Fit Score (0–10)</label>
            <Input type="number" min="0" max="10" step="1" placeholder="5" value={minFitScore} onChange={e => setMinFitScore(e.target.value)} required />
          </div>
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Max Bid Per Creator (USDC)</label>
          <Input type="number" step="0.01" min="5" placeholder="20" value={maxBidPerCreator} onChange={e => setMaxBidPerCreator(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Search Tags (comma-separated)</label>
          <Input placeholder="ai, crypto, defi" value={searchTags} onChange={e => setSearchTags(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Default Bid Message</label>
          <Input placeholder="Hi! I'd love your take on…" value={defaultMessage} onChange={e => setDefaultMessage(e.target.value)} />
        </div>
        {error && <p className="text-sm text-arc-coral">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Saving…" : "Save Configuration"}
        </Button>
      </form>
    </Card>
  );
}
