/**
 * Decision History: the bidder agent's log rows grouped into runs, one decision per
 * creator. Pure and client-safe (no database); the dashboard loads the rows
 * (loadDecisionHistory in app/dashboard/page.tsx) and the screen filters them.
 *
 * A run's rows share `data.runId` (lib/agent.ts tags every row a run writes). Rows from
 * before that have no runId: they're grouped by time instead, since one run writes all of
 * its rows within seconds (a gap of more than LEGACY_GAP_MS starts a new run).
 */

/** The log actions that make up a bidder run. */
export const RUN_ACTIONS = ["creator_discovered", "creator_scored", "agent_stopped", "error"] as const;

export const LEGACY_GAP_MS = 90_000;

export type DecisionKind = "BID_QUEUED" | "SKIPPED" | "BLOCKED" | "FAILED" | "NOT_REACHED";

export interface HistoryRow {
  id: string;
  action: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent_logs.data is untyped jsonb
  data: any;
  createdAt: string;
}

export interface DecisionView {
  id: string;
  creator: string;
  /** null on rows from before decision records (score only). */
  decision: DecisionKind | null;
  reason: string | null;
  score: number | null;
  aiReason: string | null;
  flagged: boolean;
  /** "cache" = the same score as an earlier run (nothing changed). */
  scoreSource: "ai" | "cache" | null;
  scoredAt: string | null;
  /** What reading the profile cost this run (atomic USDC), or how it was read. */
  read: { kind: "paid"; amount: string } | { kind: "earlier" } | { kind: "free" } | null;
  /** Atomic USDC: the bid amount (queued bids) and the creator's floor. */
  amount: string | null;
  floor: string | null;
  /** This is the creator's newest score and it can be refreshed with "Ask again". */
  canAskAgain: boolean;
  /** A fresh score was requested for this creator; the next run asks the AI again. */
  freshScoreRequested: boolean;
}

export interface RunView {
  id: string;
  /** ISO time of the run's last row. */
  at: string;
  summary: {
    found: number;
    evaluated: number | null;
    qualified: number | null;
    attempted: number | null;
    queued: number;
    unscored: number;
    readSpend: string | null;
  } | null;
  stopReason: string | null;
  error: string | null;
  stoppedEarly: boolean;
  decisions: DecisionView[];
}

const DECISIONS = new Set<string>(["BID_QUEUED", "SKIPPED", "BLOCKED", "FAILED", "NOT_REACHED"]);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function decisionView(row: HistoryRow): DecisionView {
  const d = (row.data ?? {}) as Record<string, unknown>;
  const x402 = d.x402 as { amount?: unknown } | undefined;
  const read: DecisionView["read"] =
    d.profile === "x402" ? { kind: "paid", amount: str(x402?.amount) ?? "0" } : d.profile === "x402_earlier" ? { kind: "earlier" } : d.profile === "free" ? { kind: "free" } : null;
  return {
    id: row.id,
    creator: str(d.creator) ?? "unknown",
    decision: typeof d.decision === "string" && DECISIONS.has(d.decision) ? (d.decision as DecisionKind) : null,
    reason: str(d.reason),
    score: num(d.score),
    aiReason: str(d.aiReason),
    flagged: d.flagged === true,
    scoreSource: d.scoreSource === "cache" ? "cache" : d.scoreSource === "ai" ? "ai" : null,
    scoredAt: str(d.scoredAt),
    read,
    amount: str(d.amount),
    floor: str(d.floor),
    canAskAgain: false,
    freshScoreRequested: false,
  };
}

/** Groups rows (any order) into runs, newest first, keeping at most `maxRuns`. */
export function groupRuns(rows: HistoryRow[], maxRuns = 30): RunView[] {
  const asc = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const groups = new Map<string, HistoryRow[]>();
  let legacyKey: string | null = null;
  let legacyLast = 0;
  for (const row of asc) {
    const runId = str(row.data?.runId);
    if (runId) {
      groups.set(runId, [...(groups.get(runId) ?? []), row]);
      continue;
    }
    // Errors without a runId aren't from a bidder run (e.g. the creator agent).
    if (row.action === "error") continue;
    const t = new Date(row.createdAt).getTime();
    if (!legacyKey || t - legacyLast > LEGACY_GAP_MS) legacyKey = `legacy:${row.id}`;
    legacyLast = t;
    groups.set(legacyKey, [...(groups.get(legacyKey) ?? []), row]);
  }

  const runs: RunView[] = [];
  for (const [id, group] of groups) {
    const summaryRow = group.filter((r) => r.action === "creator_discovered").at(-1);
    const s = (summaryRow?.data ?? null) as Record<string, unknown> | null;
    const stop = group.filter((r) => r.action === "agent_stopped").at(-1);
    const err = group.filter((r) => r.action === "error").at(-1);
    runs.push({
      id,
      at: group[group.length - 1]!.createdAt,
      summary: s
        ? {
            found: num(s.count) ?? 0,
            evaluated: num(s.evaluated),
            qualified: num(s.qualified),
            attempted: num(s.attempted),
            queued: num(s.queued) ?? num(s.bidsPlaced) ?? 0,
            unscored: num(s.unscored) ?? 0,
            readSpend: str(s.readSpend),
          }
        : null,
      stopReason: str(stop?.data?.reason),
      error: str(err?.data?.error),
      stoppedEarly: s?.stoppedEarly === true,
      decisions: group.filter((r) => r.action === "creator_scored").map(decisionView),
    });
  }
  runs.sort((a, b) => b.at.localeCompare(a.at));
  const kept = runs.slice(0, maxRuns);

  // "Ask again" goes on each creator's newest scored decision only.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const run of kept) {
    for (const dec of run.decisions) {
      const key = dec.creator.toLowerCase();
      const row = byId.get(dec.id);
      const scored = dec.score !== null && !!str(row?.data?.scoreKey);
      if (!scored || seen.has(key)) continue;
      seen.add(key);
      if (str(row?.data?.rescoreRequestedAt)) dec.freshScoreRequested = true;
      else dec.canAskAgain = true;
    }
  }
  return kept;
}

/** Filters runs to the decisions matching `decision` and a creator search; drops emptied runs. */
export function filterRuns(runs: RunView[], filter: { decision: DecisionKind | "all"; creator: string }): RunView[] {
  const q = filter.creator.trim().replace(/^@/, "").toLowerCase();
  if (filter.decision === "all" && !q) return runs;
  return runs
    .map((run) => ({
      ...run,
      decisions: run.decisions.filter((d) => (filter.decision === "all" || d.decision === filter.decision) && (!q || d.creator.toLowerCase().includes(q))),
    }))
    .filter((run) => run.decisions.length > 0);
}
