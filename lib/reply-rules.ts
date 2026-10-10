/**
 * Reply rules. A reply is what a creator gives in exchange for a bid's USDC, so
 * it has to be a real answer: at least REPLY_MIN_CHARS characters. The escrow
 * contract only stores the reply; this app-level minimum is enforced before
 * acceptBid is sent (lib/bids.ts), by the reply composer, for reply templates
 * and for the creator agent's auto-replies.
 *
 * Client-safe (no Node imports).
 */
export const REPLY_MIN_CHARS = 100;
export const REPLY_MAX_CHARS = 2000;

/** Who wrote a reply: the creator, the creator's saved template, or the creator agent's AI. */
export type ReplySource = "creator" | "template" | "ai";

/** Error message for a reply, or null if it's acceptable. */
export function replyError(reply: string): string | null {
  const n = reply.trim().length;
  if (n < REPLY_MIN_CHARS) return `Replies need at least ${REPLY_MIN_CHARS} characters (${n} so far). Give the bidder a real answer.`;
  if (n > REPLY_MAX_CHARS) return `Replies can be at most ${REPLY_MAX_CHARS} characters.`;
  return null;
}

/**
 * A reply template is optional, but if set it must be long enough to be sent as a
 * reply. Returns the cleaned template (null for empty) or an error.
 */
export function validateReplyTemplate(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Reply template must be text" };
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  if (t.length < REPLY_MIN_CHARS) {
    return { ok: false, error: `Your reply template needs at least ${REPLY_MIN_CHARS} characters, or leave it empty.` };
  }
  if (t.length > REPLY_MAX_CHARS) return { ok: false, error: `Your reply template can be at most ${REPLY_MAX_CHARS} characters.` };
  return { ok: true, value: t };
}

/** "template" if the reply is the creator's saved template word for word, else "creator". */
export function manualReplySource(reply: string, template: string | null | undefined): ReplySource {
  return template && reply.trim() === template.trim() ? "template" : "creator";
}

/** Share of rated replies bidders found worth it, or null with no ratings. */
export function ratingShare(up: number, down: number): number | null {
  return up + down > 0 ? up / (up + down) : null;
}
