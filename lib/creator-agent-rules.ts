/**
 * When the creator agent may accept a bid (and send a reply) without the creator.
 * Client-safe: the dashboard setting and inngest's creatorAgentTriage share it.
 *
 * Stored in profiles.auto_accept_threshold (integer, default 0):
 *   -1      → Off: the agent never accepts on its own; strong bids are shown instead
 *   9, 10   → accept only bids the agent scores at least this
 *   null, 0–8 → 8 (the original fixed cut-off; existing creators keep that behaviour)
 *
 * Below the cut-off nothing changes: 5–7 counter (or show), under 5 decline, and a
 * bid scoring 8 or more that's below the cut-off is shown to the creator, never
 * countered or declined.
 */
export const AUTO_ACCEPT_OFF = -1;
export const AUTO_ACCEPT_DEFAULT = 8;
export const AUTO_ACCEPT_CHOICES = [AUTO_ACCEPT_DEFAULT, 9, 10, AUTO_ACCEPT_OFF] as const;

/** The score a bid needs to be auto-accepted, or null when auto-accept is off. */
export function autoAcceptCutoff(stored: number | null | undefined): number | null {
  if (stored === AUTO_ACCEPT_OFF) return null;
  if (stored === null || stored === undefined || !Number.isFinite(stored) || stored < AUTO_ACCEPT_DEFAULT) return AUTO_ACCEPT_DEFAULT;
  return Math.min(10, Math.floor(stored));
}

export function validateAutoAcceptSetting(v: unknown): { ok: true; value: number } | { ok: false; error: string } {
  return typeof v === "number" && (AUTO_ACCEPT_CHOICES as readonly number[]).includes(v)
    ? { ok: true, value: v }
    : { ok: false, error: "Auto-accept must be 8, 9, 10 or off" };
}

export type TriageDecision = "accept" | "surface" | "reject" | "counter_offer";

/**
 * The creator agent's decision for a 0–10 score. `counter` returns the counter
 * amount for a mid-range bid, or undefined when there's nothing to counter with.
 */
export function triageDecision(
  score: number,
  cutoff: number | null,
  counter: () => string | undefined,
): { decision: TriageDecision; counterOfferAmount?: string } {
  if (cutoff !== null && score >= cutoff) return { decision: "accept" };
  if (score >= 8) return { decision: "surface" }; // strong, but below the creator's bar
  if (score >= 5) {
    const counterOfferAmount = counter();
    return counterOfferAmount ? { decision: "counter_offer", counterOfferAmount } : { decision: "surface" };
  }
  return { decision: "reject" };
}

/** Short label for the dashboard, e.g. "Bids it scores 9 or higher" / "Off". */
export function autoAcceptLabel(stored: number | null | undefined): string {
  const cutoff = autoAcceptCutoff(stored);
  return cutoff === null ? "Off, never accepts for you" : cutoff === 10 ? "Only bids it scores 10/10" : `Bids it scores ${cutoff} or higher`;
}
