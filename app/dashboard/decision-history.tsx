"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money, Num, Panel, StatusChip } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { filterRuns, type DecisionKind, type DecisionView, type RunView } from "@/lib/decision-history";

const DECISION: Record<DecisionKind, { label: string; tone: "pending" | "muted" | "danger" }> = {
  BID_QUEUED: { label: "Bid queued", tone: "pending" },
  SKIPPED: { label: "Skipped", tone: "muted" },
  BLOCKED: { label: "Blocked", tone: "danger" },
  FAILED: { label: "Failed", tone: "danger" },
  NOT_REACHED: { label: "Not reached", tone: "muted" },
};

const FILTERS: { id: DecisionKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "BID_QUEUED", label: "Bid queued" },
  { id: "SKIPPED", label: "Skipped" },
  { id: "BLOCKED", label: "Blocked" },
  { id: "FAILED", label: "Failed" },
  { id: "NOT_REACHED", label: "Not reached" },
];

function RunHeadline({ run }: { run: RunView }) {
  const s = run.summary;
  if (!s) return <span>{run.stopReason ? `Stopped: ${run.stopReason}` : run.error ? "Stopped on an error" : "Run"}</span>;
  const parts = [`${s.found} found`];
  if (s.evaluated !== null) parts.push(`${s.evaluated} evaluated`, `${s.qualified ?? 0} qualified`, `${s.attempted ?? 0} attempted`);
  parts.push(`${s.queued} queued`);
  return <span className="num">{parts.join(" · ")}</span>;
}

function DecisionRow({ d, now }: { d: DecisionView; now: number }) {
  const router = useRouter();
  const [asking, setAsking] = React.useState(false);
  const chip = d.decision ? DECISION[d.decision] : null;

  async function askAgain() {
    setAsking(true);
    try {
      const res = await fetch("/api/agent/rescore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator: d.creator }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        toast({ title: `Fresh score next run for @${d.creator}`, description: "Your agent will ask the AI again. Your rules still decide whether it bids.", variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Couldn't ask again", description: data.error ?? "Try again", variant: "destructive" });
      }
    } catch {
      toast({ title: "Couldn't ask again", variant: "destructive" });
    } finally {
      setAsking(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 border-b border-border px-5 py-3 text-[13px] last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/c/${encodeURIComponent(d.creator)}`} className="font-medium text-arc-lavender hover:underline">
          @{d.creator}
        </a>
        {chip ? (
          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        ) : (
          <StatusChip tone="muted">Scored</StatusChip>
        )}
        {d.score !== null && (
          <Num className="text-text-primary">
            {d.score}/10
          </Num>
        )}
        {d.flagged && <StatusChip tone="danger">AI red flag</StatusChip>}
        {d.amount && d.decision === "BID_QUEUED" && <Money atomic={d.amount} tone="gold" />}
      </div>
      {d.reason && <p className="text-text-primary">{d.reason}</p>}
      {d.aiReason && <p className="text-text-secondary">AI: &ldquo;{d.aiReason}&rdquo;</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
        {d.scoreSource === "cache" && (
          <span>
            Same score as an earlier run{d.scoredAt ? <> (<Num>{timeAgo(d.scoredAt, now)}</Num>)</> : null}: nothing changed
          </span>
        )}
        {d.read?.kind === "paid" && (
          <span>
            Profile read <Money atomic={d.read.amount} className="text-xs" />
          </span>
        )}
        {d.read?.kind === "earlier" && <span>Profile read earlier today (no charge)</span>}
        {d.freshScoreRequested && <span className="text-arc-gold">Fresh score requested: the next run asks the AI again</span>}
        {d.canAskAgain && (
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={askAgain} disabled={asking}>
            <RotateCcw aria-hidden className="mr-1 h-3 w-3" />
            {asking ? "Asking…" : "Ask again"}
          </Button>
        )}
      </div>
    </li>
  );
}

export function DecisionHistory({ runs, now }: { runs: RunView[]; now: number }) {
  const [decision, setDecision] = React.useState<DecisionKind | "all">("all");
  const [creator, setCreator] = React.useState("");
  const shown = filterRuns(runs, { decision, creator });
  const filtering = decision !== "all" || creator.trim() !== "";

  return (
    <Panel
      padded={false}
      title="Decision history"
      description="Every creator your bidder agent looked at in the last 14 days, what it decided and why. A queued bid is escrowed later; it shows as confirming until then."
    >
      <div className="flex flex-col gap-3 border-t border-border px-5 py-3">
        <div role="group" aria-label="Filter by decision" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={decision === f.id}
              onClick={() => setDecision(f.id)}
              className={cn(
                "focus-ring h-8 rounded-full border px-3 text-xs",
                decision === f.id ? "border-arc-gold bg-arc-bg-3 text-text-primary" : "border-border-bright text-text-secondary hover:text-text-primary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">Find a creator</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
          <input
            type="search"
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
            placeholder="Find a creator, e.g. @amina"
            className="focus-ring h-8 w-full rounded-md border border-border-bright bg-arc-bg-2 pl-8 pr-2 text-[13px] text-text-primary placeholder:text-text-dim"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="border-t border-border px-5 py-10 text-center text-sm text-text-secondary">
          {runs.length === 0
            ? "No runs in the last 14 days. Resume your agent or press Run now."
            : creator.trim()
              ? "Your agent hasn't looked at a creator by that name in the last 14 days."
              : "No decisions of this kind in the last 14 days."}
        </p>
      ) : (
        <ol className="max-h-[640px] overflow-y-auto border-t border-border">
          {shown.map((run, i) => (
            <li key={run.id} className="border-b border-border last:border-b-0">
              {/* Newest run open; all matches open while filtering. */}
              <details open={filtering || i === 0} className="group">
                <summary className="focus-ring flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-arc-bg-2 px-5 py-2.5 text-[13px] text-text-primary">
                  <span className="flex min-w-0 items-start gap-2">
                    <span aria-hidden className="text-text-secondary transition-transform group-open:rotate-90">›</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <RunHeadline run={run} />
                      {(run.stoppedEarly || run.error) && <StatusChip tone="danger">Stopped early</StatusChip>}
                      {run.summary?.readSpend && run.summary.readSpend !== "0" && (
                        <span className="text-xs text-text-secondary">
                          reads <Money atomic={run.summary.readSpend} className="text-xs" />
                        </span>
                      )}
                    </span>
                  </span>
                  <Num className="text-xs text-text-secondary">{timeAgo(run.at, now)}</Num>
                </summary>
                {(run.stopReason || run.error) && (
                  <p className={cn("border-t border-border px-5 py-2 text-[13px]", run.error ? "text-arc-coral" : "text-text-secondary")}>
                    {run.error ?? `Stopped: ${run.stopReason}`}
                  </p>
                )}
                {run.decisions.length > 0 && (
                  <ul className="border-t border-border">
                    {run.decisions.map((d) => (
                      <DecisionRow key={d.id} d={d} now={now} />
                    ))}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
