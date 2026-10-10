"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money, Num, Panel, StatStrip, StatusChip, Tag } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { logKind, logMessage, type LogKind } from "./agent-log";
import { AgentPolicy } from "./agent-policy";
import { BidderSetupForm } from "./bidder-setup-form";
import type { AgentPolicyInfo, BidData, BidderConfigData, LogData, PortfolioSummary } from "./types";

const FILTERS: { id: "all" | LogKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "discovery", label: "Discovery" },
  { id: "bid", label: "Bids" },
  { id: "settled", label: "Settled" },
  { id: "error", label: "Errors" },
];

const KIND_DOT: Record<LogKind, string> = {
  discovery: "bg-arc-lavender",
  bid: "bg-arc-gold",
  settled: "bg-green",
  stop: "bg-text-secondary",
  error: "bg-arc-coral",
  other: "bg-border-bright",
};

export function AgentConsole({
  config,
  bids,
  logs,
  summary,
  now,
  policy,
}: {
  config: BidderConfigData | null;
  /** Only bids this user placed. */
  bids: BidData[];
  logs: LogData[];
  summary: PortfolioSummary;
  now: number;
  policy: AgentPolicyInfo;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | LogKind>("all");

  if (!config || editing) {
    return (
      <BidderSetupForm
        existingConfig={config}
        onComplete={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={config ? () => setEditing(false) : undefined}
      />
    );
  }

  const budget = BigInt(config.dailyBudget);
  const spent = BigInt(summary.bidder.spentTodayUsdc);
  const pct = budget > BigInt(0) ? Math.min(100, Number((spent * BigInt(100)) / budget)) : 0;
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const bidsToday = bids.filter((b) => b.status !== "failed" && new Date(b.createdAt).getTime() >= startOfDay.getTime()).length;
  const lastDiscovery = logs.find((l) => l.action === "creator_discovered");
  const lastRun = logs[0];
  const shown = filter === "all" ? logs : logs.filter((l) => logKind(l.action) === filter);

  async function toggle() {
    setToggling(true);
    try {
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidderActive: !config!.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast({ title: config!.isActive ? "Agent paused" : "Agent running", description: config!.isActive ? "It won't place new bids." : "It runs every 30 minutes.", variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Couldn't update the agent", description: data.error ?? "Try again", variant: "destructive" });
      }
    } catch {
      toast({ title: "Couldn't update the agent", variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      const r = data.result as { bidsPlaced?: number; creatorsFound?: number; errors?: string[] } | undefined;
      if (data.success && r) {
        const placed = r.bidsPlaced ?? 0;
        toast({
          title: placed ? `${placed} bid${placed === 1 ? "" : "s"} queued` : "Run finished, no bids",
          description:
            placed || !r.errors?.length
              ? `${r.creatorsFound ?? 0} creator${r.creatorsFound === 1 ? "" : "s"} found. Bids show as “Confirming on Arc” until escrowed.`
              : r.errors[0],
          variant: placed || !r.errors?.length ? "success" : "destructive",
        });
      } else {
        toast({ title: "Agent error", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Agent error", description: "Failed to run the agent", variant: "destructive" });
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-xl font-bold tracking-tight">{config.agentName || "Your bidder agent"}</h2>
              {config.isActive ? (
                <StatusChip tone="success" dot>
                  Running · every 30 min
                </StatusChip>
              ) : (
                <StatusChip tone="muted" dot>
                  Paused
                </StatusChip>
              )}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {lastRun ? (
                <>
                  Last activity <Num>{timeAgo(lastRun.createdAt, now)}</Num>
                </>
              ) : (
                "No runs yet."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={config.isActive ? "outline" : "default"} onClick={toggle} disabled={toggling}>
              {config.isActive ? <Pause aria-hidden className="mr-1.5 h-3.5 w-3.5" /> : <Play aria-hidden className="mr-1.5 h-3.5 w-3.5" />}
              {toggling ? "Saving…" : config.isActive ? "Pause" : "Resume"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={runNow}
              disabled={running || !config.isActive}
              title={config.isActive ? undefined : "Resume the agent to run it"}
            >
              <Zap aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              {running ? "Running…" : "Run now"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit strategy
            </Button>
          </div>
        </div>
        {!config.isActive && <p className="mt-3 text-[13px] text-text-secondary">Paused agents don&apos;t bid. Open bids stay escrowed and still refund after 3 days.</p>}
      </Panel>

      <StatStrip
        items={[
          {
            label: "Budget used today",
            value: (
              <>
                <Money atomic={spent} /> <span className="text-sm text-text-secondary">/ </span>
                <Money atomic={budget} className="text-sm text-text-secondary" />
              </>
            ),
            tone: spent >= budget ? "danger" : "default",
            sub: (
              <span className="mt-1.5 block">
                <span
                  role="progressbar"
                  aria-label="Daily budget used"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="block h-1.5 overflow-hidden rounded-full bg-arc-bg-3"
                >
                  <span className={cn("block h-full rounded-full", spent >= budget ? "bg-arc-coral" : "bg-arc-gold")} style={{ width: `${pct}%` }} />
                </span>
                <span className="mt-1 block">{spent >= budget ? "Limit reached · resets 00:00 UTC" : "Resets 00:00 UTC"}</span>
              </span>
            ),
          },
          { label: "Bids today", value: <Num>{bidsToday}</Num>, sub: "Placed by you or your agent" },
          {
            label: "Creators found",
            value: <Num>{lastDiscovery?.data?.count ?? "—"}</Num>,
            sub: lastDiscovery ? `Last discovery ${timeAgo(lastDiscovery.createdAt, now)}` : "No discovery yet",
          },
          { label: "Max per creator", value: <Money atomic={config.maxBidPerCreator} />, sub: "Clamped to each creator's floor" },
          { label: "Min fit score", value: <Num>{config.minFitScore}/10</Num>, sub: "Creators below this are skipped" },
        ]}
      />

      <AgentPolicy config={config} spent={spent} policy={policy} />

      <div className="flex flex-wrap items-start gap-5">
        <Panel title="Strategy" className="min-w-0 flex-[1_1_300px]">
          <dl className="flex flex-col gap-3 text-[13px]">
            <div>
              <dt className="eyebrow">Goal</dt>
              <dd className="mt-1 text-text-primary">{config.goal || <span className="text-text-secondary">Not set</span>}</dd>
            </div>
            <div>
              <dt className="eyebrow">Search tags</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {config.searchTags.length ? config.searchTags.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-text-secondary">None, so it won&apos;t find creators</span>}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Default message</dt>
              <dd className="mt-1 text-text-secondary">{config.defaultMessage || "None"}</dd>
            </div>
          </dl>
        </Panel>

        <Panel
          padded={false}
          title="Run log"
          description="What your agents did, newest first. Includes your creator agent's triage."
          className="min-w-0 flex-[999_1_520px]"
        >
          <div role="group" aria-label="Filter run log" className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "focus-ring h-8 rounded-full border px-3 text-xs",
                  filter === f.id ? "border-arc-gold bg-arc-bg-3 text-text-primary" : "border-border-bright text-text-secondary hover:text-text-primary",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="border-t border-border px-5 py-10 text-center text-sm text-text-secondary">
              {logs.length === 0 ? "No activity yet. Resume your agent or press Run now." : "Nothing of this kind in the last 50 entries."}
            </p>
          ) : (
            <ol className="max-h-[520px] overflow-y-auto border-t border-border">
              {shown.map((l) => {
                const kind = logKind(l.action);
                return (
                  <li key={l.id} className="flex items-start gap-3 border-b border-border px-5 py-2.5 text-[13px] last:border-b-0">
                    <span aria-hidden className={cn("mt-1.5 h-2 w-2 flex-none rounded-full", KIND_DOT[kind])} />
                    <span className={cn("min-w-0 flex-1", kind === "error" ? "text-arc-coral" : "text-text-primary")}>
                      {logMessage(l.action, l.data)}
                      {l.txHref && (
                        <a href={l.txHref} target="_blank" rel="noopener noreferrer" className="ml-2 text-arc-lavender hover:underline">
                          tx ↗
                        </a>
                      )}
                    </span>
                    <Num className="flex-none text-xs text-text-secondary">{timeAgo(l.createdAt, now)}</Num>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
