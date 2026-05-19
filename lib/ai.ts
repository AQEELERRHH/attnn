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
  } catch (err) {
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
  } catch (err) {
    return {
      score: 5,
      bidAmount: "1000000",
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
  } catch (err) {
    return `Thanks for reaching out! I appreciate your bid on my attention and would be happy to discuss further.`;
  }
}

export { callAI, safeJsonParse };
