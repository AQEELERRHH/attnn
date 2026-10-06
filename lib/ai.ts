import { ESCROW_MAX_BID, creatorFloor } from "./bid-rules";
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

const ScoreForCreatorSchema = z.object({
  score: z.number().min(0).max(10),
  recommendation: z.enum(["accept", "reject", "review"]),
  reason: z.string().max(500),
});

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

export async function scoreBidForCreator(
  bid: BidData,
  creatorProfile: CreatorProfile,
): Promise<z.infer<typeof ScoreForCreatorSchema>> {
  const systemPrompt = `You are an AI scoring agent for a creator attention marketplace. 
Score incoming bids on a scale of 0-10 based on:
1. Bid amount relative to creator's minimum (minBid)
2. Message quality and relevance
3. Likelihood of meaningful engagement

Respond with JSON: { "score": number, "recommendation": "accept"|"reject"|"review", "reason": string }`;

  const prompt = JSON.stringify({ bid, creatorProfile });

  try {
    const raw = await callAI(prompt, systemPrompt);
    const parsed = safeJsonParse(raw);
    return ScoreForCreatorSchema.parse(parsed);
  } catch {
    const bidAmount = BigInt(bid.amountUsdc);
    const minBid = BigInt(creatorProfile.minBid);
    const score = bidAmount >= minBid * BigInt(2) ? 7 : bidAmount >= minBid ? 5 : 2;
    return {
      score,
      recommendation: score >= 7 ? "accept" as const : score >= 5 ? "review" as const : "reject" as const,
      reason: `Bid of ${bid.amountUsdc} USDC vs minimum ${creatorProfile.minBid} USDC. ${score >= 7 ? "Above threshold." : score >= 5 ? "Meets minimum." : "Below minimum."}`,
    };
  }
}

export async function evaluateCreatorForBidder(
  creator: CreatorProfile,
  bidderGoal: string,
): Promise<z.infer<typeof EvaluateCreatorForBidderSchema>> {
  const systemPrompt = `You are an AI evaluation agent for a bidder on a creator attention marketplace.
Evaluate how well a creator fits the bidder's goal on a scale of 0-10.
Return JSON: { "score": number, "bidAmount": string (USDC with 6 decimals), "reason": string, "proceed": boolean }`;

  const prompt = JSON.stringify({ creator, bidderGoal });

  try {
    const raw = await callAI(prompt, systemPrompt);
    const parsed = safeJsonParse(raw);
    return EvaluateCreatorForBidderSchema.parse(parsed);
  } catch {
    // Bid the creator's floor. The agent clamps every amount to the floor and the
    // bidder's cap anyway (resolveAgentBidAmount), so this can never go below $5.
    return {
      score: 5,
      bidAmount: creator.minBid,
      reason: "Default evaluation — AI unavailable, using mid-range score.",
      proceed: true,
    };
  }
}

export async function draftReply(
  bidMessage: string,
  creatorContext: { handle: string; bio?: string },
): Promise<string> {
  const systemPrompt = `You are a creator on an attention marketplace. 
Write a reply to a bidder's message. The reply must be at least 10 characters (on-chain requirement).
Be authentic, professional, and engaging. Return JSON: { "reply": string }`;

  const prompt = JSON.stringify({ bidMessage, creatorContext });

  try {
    const raw = await callAI(prompt, systemPrompt);
    const parsed = safeJsonParse(raw);
    const result = DraftReplySchema.parse(parsed);
    return result.reply;
  } catch {
    return `Thanks for reaching out! I appreciate your bid on my attention and would be happy to discuss further.`;
  }
}


// ─── Creator Agent Triage ─────────────────────────────────────────────────────
export interface TriageResult {
  decision: "accept" | "surface" | "reject" | "counter_offer";
  score: number;
  reason: string;
  draftedReply?: string;
  counterOfferAmount?: string;
}


/** The creator's reply template if it is long enough to accept with (10–2,000 chars). */
function usableTemplate(template: string | null | undefined): string | undefined {
  const t = template?.trim();
  return t && t.length >= 10 && t.length <= 2000 ? t : undefined;
}

/**
 * What the creator agent asks for when it counters: 85% of the highest escrowed
 * bid, never below the creator's floor or $5. Returns undefined (so the bid is
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
  creatorProfile: CreatorProfile & { autoAcceptThreshold: number; autoReplyTemplate: string | null; queueDepth: number },
  highestBidAmount?: string,
): Promise<TriageResult> {
  const systemPrompt = `You are a creator-side AI agent on an attention marketplace.
Triage an incoming bid on a scale of 0-10 based on:
1. Bid amount vs creator minimum (40 points max)
2. Message quality and topic relevance to creator tags (30 points max)
3. Queue depth adjustment — if many bids pending, raise the bar (up to -15)
4. Overall engagement potential (30 points max)
Decision rules: score >= 8 = accept, score 5-7 = surface (show to creator), score < 5 = reject.
Return JSON: { "score": number, "decision": "accept"|"surface"|"reject", "reason": string }`;

  const prompt = JSON.stringify({
    bid: { amount: bid.amountUsdc, message: bid.message },
    creator: { handle: creatorProfile.handle, bio: creatorProfile.bio, tags: creatorProfile.tags, minBid: creatorProfile.minBid },
    queueDepth: creatorProfile.queueDepth,
    autoAcceptThreshold: creatorProfile.autoAcceptThreshold,
  });

  try {
    const raw = await callAI(prompt, systemPrompt);
    const parsed = safeJsonParse(raw);
    const score = typeof parsed.score === "number" ? Math.min(10, Math.max(0, parsed.score)) : 5;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "AI triage completed.";

    // Counter-offer logic — mid-range score + higher bid exists in queue
    let decision: "accept" | "surface" | "reject" | "counter_offer";
    let counterOfferAmount: string | undefined;

    if (score >= 8) {
      decision = "accept";
    } else if (score >= 5) {
      counterOfferAmount = counterAmountFor(bid.amountUsdc, highestBidAmount, creatorProfile.minBid);
      decision = counterOfferAmount ? "counter_offer" : "surface";
    } else {
      decision = "reject";
    }

    let draftedReply: string | undefined;
    if (decision === "accept") {
      // The escrow app requires a 10+ character reply; an empty or too-short template
      // would make the accept fail, so draft one instead.
      draftedReply = usableTemplate(creatorProfile.autoReplyTemplate) ??
        await draftReply(bid.message, { handle: creatorProfile.handle, bio: creatorProfile.bio });
    }

    return { decision, score, reason, draftedReply, counterOfferAmount };
  } catch {
    const bidAmount = BigInt(bid.amountUsdc);
    const minBid = BigInt(creatorProfile.minBid);
    const score = bidAmount >= minBid * BigInt(2) ? 8 : bidAmount >= minBid ? 5 : 3;
    let decisionFallback: "accept" | "surface" | "reject" | "counter_offer";
    let counterOfferAmountFallback: string | undefined;
    if (score >= 8) {
      decisionFallback = "accept";
    } else if (score >= 5) {
      counterOfferAmountFallback = counterAmountFor(bid.amountUsdc, highestBidAmount, creatorProfile.minBid);
      decisionFallback = counterOfferAmountFallback ? "counter_offer" : "surface";
    } else {
      decisionFallback = "reject";
    }
    return {
      decision: decisionFallback,
      score,
      reason: "Fallback triage — AI unavailable.",
      draftedReply: decisionFallback === "accept" ? usableTemplate(creatorProfile.autoReplyTemplate) : undefined,
      counterOfferAmount: counterOfferAmountFallback,
    };
  }
}

export { callAI, safeJsonParse };
