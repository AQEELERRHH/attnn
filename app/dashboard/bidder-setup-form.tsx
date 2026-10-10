"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Panel } from "@/components/market";
import { glossary } from "@/lib/glossary";
import { toast } from "@/hooks/use-toast";
import { ESCROW_MAX_BID, ESCROW_MIN_BID, formatUsd } from "@/lib/bid-rules";
import { atomicToDollarInput, dollarsToAtomic } from "@/lib/format";
import { fieldClass, labelClass } from "./creator-setup-form";
import type { BidderConfigData } from "./types";

/** Create or edit the bidder agent's strategy (POST /api/bidder-config/create upserts). */
export function BidderSetupForm({
  existingConfig,
  onComplete,
  onCancel,
}: {
  existingConfig: BidderConfigData | null;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const [agentName, setAgentName] = React.useState(existingConfig?.agentName ?? "");
  const [goal, setGoal] = React.useState(existingConfig?.goal ?? "");
  const [dailyBudget, setDailyBudget] = React.useState(
    existingConfig ? atomicToDollarInput(BigInt(existingConfig.dailyBudget)) : "50.00",
  );
  const [maxBid, setMaxBid] = React.useState(
    existingConfig ? atomicToDollarInput(BigInt(existingConfig.maxBidPerCreator)) : "20.00",
  );
  const [minFitScore, setMinFitScore] = React.useState(String(existingConfig?.minFitScore ?? 5));
  const [searchTags, setSearchTags] = React.useState(existingConfig?.searchTags?.join(", ") ?? "");
  const [defaultMessage, setDefaultMessage] = React.useState(existingConfig?.defaultMessage ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const budget = dollarsToAtomic(dailyBudget);
  const cap = dollarsToAtomic(maxBid);
  const score = Number(minFitScore);
  const budgetError = budget === null ? "Enter an amount like 50." : budget < ESCROW_MIN_BID ? `At least ${formatUsd(ESCROW_MIN_BID)}.` : null;
  const capError =
    cap === null ? "Enter an amount like 20." : cap < ESCROW_MIN_BID || cap > ESCROW_MAX_BID ? `Between ${formatUsd(ESCROW_MIN_BID)} and $1,000.00.` : null;
  const scoreError = !Number.isInteger(score) || score < 0 || score > 10 ? "A whole number from 0 to 10." : null;
  const invalid = !!(budgetError || capError || scoreError);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || budget === null || cap === null) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/bidder-config/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal || null,
          dailyBudget: budget.toString(),
          searchTags: searchTags.split(",").map((t) => t.trim()).filter(Boolean),
          minFitScore: score,
          maxBidPerCreator: cap.toString(),
          agentName: agentName || null,
          defaultMessage: defaultMessage || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast({ title: existingConfig ? "Strategy saved" : "Bidder agent created", variant: "success" });
        onComplete();
      } else {
        setError(data.error ?? "Failed to save the agent");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      raised
      title={existingConfig ? "Edit strategy" : "Deploy a bidder agent"}
      description="Your agent finds creators by tag, scores them against your goal and escrows bids within your limits."
    >
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bs-name" className={labelClass}>
            Agent name
          </label>
          <input id="bs-name" className={fieldClass} placeholder="e.g. Aqeelerh Scout" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
          <p className="mt-1 text-xs text-text-secondary">How creators see your agent in their order book.</p>
        </div>
        <div>
          <label htmlFor="bs-tags" className={labelClass}>
            Search tags (comma-separated)
          </label>
          <input
            id="bs-tags"
            className={fieldClass}
            placeholder="ai, crypto, defi"
            value={searchTags}
            onChange={(e) => setSearchTags(e.target.value)}
            aria-describedby="bs-tags-hint"
          />
          <FieldHint id="bs-tags-hint" more={glossary.searchTags}>
            Topics your agent looks for.
          </FieldHint>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="bs-goal" className={labelClass}>
            Goal
          </label>
          <input
            id="bs-goal"
            className={fieldClass}
            placeholder="e.g. feedback from crypto founders on our wallet UX"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="bs-budget" className={labelClass}>
            Daily budget (USDC)
          </label>
          <input
            id="bs-budget"
            inputMode="decimal"
            className={`${fieldClass} num`}
            value={dailyBudget}
            onChange={(e) => setDailyBudget(e.target.value)}
            aria-invalid={!!budgetError}
            aria-describedby="bs-budget-hint"
          />
          {budgetError ? (
            <p id="bs-budget-hint" className="mt-1 text-xs text-arc-coral">
              {budgetError}
            </p>
          ) : (
            <FieldHint id="bs-budget-hint" more={glossary.dailyBudget}>
              The most your agent spends in a day. Resets at 00:00 UTC.
            </FieldHint>
          )}
        </div>
        <div>
          <label htmlFor="bs-cap" className={labelClass}>
            Max bid per creator (USDC)
          </label>
          <input
            id="bs-cap"
            inputMode="decimal"
            className={`${fieldClass} num`}
            value={maxBid}
            onChange={(e) => setMaxBid(e.target.value)}
            aria-invalid={!!capError}
            aria-describedby="bs-cap-hint"
          />
          {capError ? (
            <p id="bs-cap-hint" className="mt-1 text-xs text-arc-coral">
              {capError}
            </p>
          ) : (
            <FieldHint id="bs-cap-hint" more={glossary.maxBidPerCreator}>
              The most it offers any one creator.
            </FieldHint>
          )}
        </div>
        <div>
          <label htmlFor="bs-score" className={labelClass}>
            Min fit score (0–10)
          </label>
          <input
            id="bs-score"
            type="number"
            min={0}
            max={10}
            step={1}
            className={`${fieldClass} num`}
            value={minFitScore}
            onChange={(e) => setMinFitScore(e.target.value)}
            aria-invalid={!!scoreError}
            aria-describedby="bs-score-hint"
          />
          {scoreError ? (
            <p id="bs-score-hint" className="mt-1 text-xs text-arc-coral">
              {scoreError}
            </p>
          ) : (
            <FieldHint id="bs-score-hint" more={glossary.fitScore}>
              Higher means pickier. 5 is a good start.
            </FieldHint>
          )}
        </div>
        <div>
          <label htmlFor="bs-msg" className={labelClass}>
            Default bid message
          </label>
          <input
            id="bs-msg"
            className={fieldClass}
            placeholder="Hi! I'd love your take on…"
            value={defaultMessage}
            onChange={(e) => setDefaultMessage(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-arc-coral sm:col-span-2">
            {error}
          </p>
        )}
        <div className="flex gap-3 sm:col-span-2">
          {onCancel && (
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={loading || invalid}>
            {loading ? "Saving…" : existingConfig ? "Save strategy" : "Create agent"}
          </Button>
        </div>
        {!existingConfig && (
          <p className="text-xs text-text-secondary sm:col-span-2">The agent starts paused. Resume it from the console when you&apos;re ready.</p>
        )}
      </form>
    </Panel>
  );
}
