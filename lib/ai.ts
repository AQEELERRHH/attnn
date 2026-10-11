import { triageDecision } from "./creator-agent-rules";
import { ESCROW_MAX_BID, creatorFloor } from "./bid-rules";
import { REPLY_MIN_CHARS, replyError } from "./reply-rules";
import { z } from "zod";

// ─── AI Client ───────────────────────────────────────────────────────────────

const AISA_API_URL = process.env.AISA_API_URL ?? "https://api.aisa.one/v1";
const AISA_API_KEY = process.env.AISA_API_KEY ?? "";
const AISA_MODEL = process.env.AISA_MODEL ?? "deepseek-chat";

interface AISAResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/** Longest a single AI call may take. Agent runs make up to ~11 calls inside a 10-minute lease. */
const AI_TIMEOUT_MS = 25_000;

async function callAI(prompt: string, systemPrompt?: string): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${AISA_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AISA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AISA_MODEL,
      messages,
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.3,
    }),
    // A hung provider must not stall an agent run past its lease (lib/agent-lease.ts).
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`AISA API error (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as AISAResponse;
  const content = data.choices[0]?.message?.content ?? "{}";
  const cleaned = content.replace(/```json?/g, "").replace(/```/g, "").trim();
  return cleaned;
}

function safeJsonParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ─── Score Schemas ───────────────────────────────────────────────────────────

const EvaluateCreatorForBidderSchema = z.object({
  score: z.number().min(0).max(10),
  bidAmount: z.string(),
  reason: z.string().max(500),
  proceed: z.boolean(),
});

const DraftReplySchema = z.object({
  reply: z.string().min(10).max(1000),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BidData {
  amountUsdc: string;
  message?: string;
  bidderAddress: string;
}

export interface CreatorProfile {
  handle: string;
  bio?: string;
  tags: string[];
  minBid: string;
}

// ─── AI Functions ────────────────────────────────────────────────────────────


/**
 * Scores how well a creator fits the bidder's goal.
 *
 * Returns null when the AI can't produce a valid answer (outage, timeout, bad JSON).
 * There is deliberately no rule-based fallback here: the bidder agent spends real
 * USDC, so a creator it couldn't score is skipped, never bid on blind.
 */
export async function evaluateCreatorForBidder(
  creator: CreatorProfile,
  bidderGoal: string,
): Promise<z.infer<typeof EvaluateCreatorForBidderSchema> | null> {
  const systemPrompt = `You are an AI evaluation agent for a bidder on a creator attention marketplace.
Evaluate how well a creator fits the bidder's goal on a scale of 0-10.
Return JSON: { "score": number, "bidAmount": string (USDC with 6 decimals), "reason": string, "proceed": boolean }`;

  const prompt = JSON.stringify({ creator, bidderGoal });

  try {
    const raw = await callAI(prompt, systemPrompt);
    const parsed = safeJsonParse(raw);
    return EvaluateCreatorForBidderSchema.parse(parsed);
  } catch (err) {
    console.warn(`evaluateCreatorForBidder: AI unavailable for @${creator.handle}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Drafts a reply in the creator's voice. Returns undefined when the AI fails or
 * writes something too short: there is no generic fallback, because a canned
 * "thanks for reaching out" is exactly the kind of reply that shouldn't collect
 * a bid. The creator agent then leaves the bid for the creator to answer.
 */
export async function draftReply(
  bidMessage: string,
  creatorContext: { handle: string; bio?: string },
): Promise<string | undefined> {
  const systemPrompt = `You are a creator on an attention marketplace, replying to someone who paid for your attention.
Write a genuine, specific reply to their message: answer what they asked or say concretely how you can help and the next step.
Between ${REPLY_MIN_CHARS + 50} and 800 characters. No generic thank-you filler.
Return JSON: { "reply": string }`;

  const prompt = JSON.stringify({ bidMessage, creatorContext });

  try {
    const raw = await callAI(prompt, systemPrompt);
    const parsed = safeJsonParse(raw);
    const reply = DraftReplySchema.parse(parsed).reply.trim();
    return replyError(reply) ? undefined : reply;
  } catch {
    return undefined;
  }
}


// ─── Creator Agent Triage ─────────────────────────────────────────────────────
export interface TriageResult {
  decision: "accept" | "surface" | "reject" | "counter_offer";
  score: number;
  reason: string;
  draftedReply?: string;
  /** Who wrote draftedReply: the creator's saved template or the AI. */
  replySource?: "template" | "ai";
  counterOfferAmount?: string;
}


/** The creator's reply template if it meets the reply rules (lib/reply-rules.ts). */
function usableTemplate(template: string | null | undefined): string | undefined {
  const t = template?.trim();
  return t && !replyError(t) ? t : undefined;
}

/**
 * What the creator agent asks for when it counters: 85% of the highest escrowed
 * bid, never below the creator's floor or the escrow minimum. Returns undefined (so the bid is
 * surfaced instead) unless that is strictly more than this bid and within the
 * $1,000 maximum, the same rules /api/bid/counter enforces for creators.
 */
export function counterAmountFor(bidAmountUsdc: string, highestBidAmount: string | null | undefined, creatorMinBid: string): string | undefined {
  if (!highestBidAmount) return undefined;
  const amount = BigInt(bidAmountUsdc);
  const highest = BigInt(highestBidAmount);
  if (highest <= amount) return undefined;
  const floor = creatorFloor(creatorMinBid);
  const target = (highest * BigInt(85)) / BigInt(100);
  const counter = target > floor ? target : floor;
  if (counter <= amount || counter > ESCROW_MAX_BID) return undefined;
  return counter.toString();
}
export async function triageBidForCreator(
  bid: BidData & { message: string },
  creatorProfile: CreatorProfile & {
    /** Score needed to auto-accept, or null when the creator turned auto-accept off (lib/creator-agent-rules.ts). */
    autoAcceptCutoff: number | null;
    autoReplyTemplate: string | null;
    queueDepth: number;
  },
  highestBidAmount?: string,
): Promise<TriageResult> {
  const counter = () => counterAmountFor(bid.amountUsdc, highestBidAmount, creatorProfile.minBid);
  const systemPrompt = `You are a creator-side AI agent on an attention marketplace.
Triage an incoming bid on a scale of 0-10 based on:
1. Bid amount vs creator minimum (40 points max)
2. Message quality and topic relevance to creator tags (30 points max)
3. Queue depth adjustment — if many bids pending, raise the bar (up to -15)
4. Overall engagement potential (30 points max)
Score the bid only; the decision is made from your score by fixed rules.
Return JSON: { "score": number, "reason": string }`;

  const prompt = JSON.stringify({
    bid: { amount: bid.amountUsdc, message: bid.message },
    creator: { handle: creatorProfile.handle, bio: creatorProfile.bio, tags: creatorProfile.tags, minBid: creatorProfile.minBid },
    queueDepth: creatorProfile.queueDepth,
  });

  try {
    const raw = await callAI(prompt, systemPrompt);
    const parsed = safeJsonParse(raw);
    const score = typeof parsed.score === "number" ? Math.min(10, Math.max(0, parsed.score)) : 5;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "AI triage completed.";

    const { decision, counterOfferAmount } = triageDecision(score, creatorProfile.autoAcceptCutoff, counter);

    let draftedReply: string | undefined;
    let replySource: "template" | "ai" | undefined;
    if (decision === "accept") {
      // Use the creator's template if it meets the reply rules, else have the AI
      // write a specific reply. If neither works, the bid is left for the creator.
      draftedReply = usableTemplate(creatorProfile.autoReplyTemplate);
      if (draftedReply) {
        replySource = "template";
      } else {
        draftedReply = await draftReply(bid.message, { handle: creatorProfile.handle, bio: creatorProfile.bio });
        if (draftedReply) replySource = "ai";
      }
    }

    return { decision, score, reason, draftedReply, replySource, counterOfferAmount };
  } catch {
    const bidAmount = BigInt(bid.amountUsdc);
    const minBid = BigInt(creatorProfile.minBid);
    const score = bidAmount >= minBid * BigInt(2) ? 8 : bidAmount >= minBid ? 5 : 3;
    const { decision: decisionFallback, counterOfferAmount: counterOfferAmountFallback } = triageDecision(
      score,
      creatorProfile.autoAcceptCutoff,
      counter,
    );
    return {
      decision: decisionFallback,
      score,
      reason: "Fallback triage — AI unavailable.",
      draftedReply: decisionFallback === "accept" ? usableTemplate(creatorProfile.autoReplyTemplate) : undefined,
      replySource: decisionFallback === "accept" && usableTemplate(creatorProfile.autoReplyTemplate) ? "template" : undefined,
      counterOfferAmount: counterOfferAmountFallback,
    };
  }
}

export { callAI, safeJsonParse };
