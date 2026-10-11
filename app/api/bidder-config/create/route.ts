import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { ensureAgentWallet } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bidderConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ESCROW_MAX_BID, ESCROW_MIN_BID, formatUsd, parseAtomicUsdc } from "@/lib/bid-rules";

/** Checks the money and score fields that were sent. Returns an error message or null. */
function validate(body: Record<string, unknown>): string | null {
  if (body.dailyBudget !== undefined) {
    const v = parseAtomicUsdc(body.dailyBudget);
    if (v === null || v < ESCROW_MIN_BID) return `Daily budget must be at least ${formatUsd(ESCROW_MIN_BID)} USDC`;
  }
  if (body.maxBidPerCreator !== undefined) {
    const v = parseAtomicUsdc(body.maxBidPerCreator);
    if (v === null || v < ESCROW_MIN_BID || v > ESCROW_MAX_BID) return `Max bid per creator must be between ${formatUsd(ESCROW_MIN_BID)} and $1,000 USDC`;
  }
  if (body.minFitScore !== undefined) {
    const v = body.minFitScore;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10) return "Min fit score must be a whole number from 0 to 10";
  }
  const text = (key: string, label: string, max: number) => {
    const v = body[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") return `${label} must be text`;
    return v.length > max ? `${label} can be at most ${max} characters` : null;
  };
  // The default message goes with every agent bid (only its fingerprint is on-chain).
  const textError =
    text("defaultMessage", "Default bid message", 500) ?? text("goal", "Goal", 500) ?? text("agentName", "Agent name", 60);
  if (textError) return textError;
  if (body.searchTags !== undefined) {
    const t = body.searchTags;
    if (!Array.isArray(t) || t.some((x) => typeof x !== "string" || x.length > 32)) return "Search tags must be words of up to 32 characters";
    if (t.length > 20) return "Use at most 20 search tags";
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.profileWrite, session.user.id));
    if (blocked) return blocked;

    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const invalid = validate(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    // Types are guaranteed by validate().
    const goal = body.goal as string | null | undefined;
    const searchTags = body.searchTags as string[] | undefined;
    const minFitScore = body.minFitScore as number | undefined;
    const defaultMessage = body.defaultMessage as string | null | undefined;
    const agentName = body.agentName as string | null | undefined;
    // Stored as canonical atomic strings (validate() already checked them).
    const dailyBudget = body.dailyBudget === undefined ? undefined : parseAtomicUsdc(body.dailyBudget)!.toString();
    const maxBidPerCreator = body.maxBidPerCreator === undefined ? undefined : parseAtomicUsdc(body.maxBidPerCreator)!.toString();

    // Check if already exists
    const existing = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, session.user.id) });
    if (existing) {
      // Update instead
      const updates: Record<string, unknown> = {};
      if (goal !== undefined) updates.goal = goal;
      if (dailyBudget !== undefined) updates.dailyBudget = dailyBudget;
      if (searchTags !== undefined) updates.searchTags = searchTags;
      if (minFitScore !== undefined) updates.minFitScore = minFitScore;
      if (defaultMessage !== undefined) updates.defaultMessage = defaultMessage;
      if (agentName !== undefined) updates.agentName = agentName;
      if (maxBidPerCreator !== undefined) updates.maxBidPerCreator = maxBidPerCreator;
      await db.update(bidderConfigs).set(updates).where(eq(bidderConfigs.userId, session.user.id));
      return NextResponse.json({ success: true, updated: true });
    }

    // Create new
    const [config] = await db.insert(bidderConfigs).values({
      userId: session.user.id,
      goal: goal ?? null,
      dailyBudget: dailyBudget ?? "50000000",
      searchTags: searchTags ?? [],
      minFitScore: minFitScore ?? 5,
      defaultMessage: defaultMessage ?? null,
      agentName: agentName ?? null,
      maxBidPerCreator: maxBidPerCreator ?? "20000000",
      isActive: false,
    }).returning();

    // Give the new agent its own wallet straight away. Best effort: if Circle is
    // slow, the Agent tab offers "Create agent wallet".
    await ensureAgentWallet(session.user.id).catch((err) => console.warn("bidder-config: agent wallet not created yet:", err));

    return NextResponse.json({ config, success: true });
  } catch (err) {
    return serverError("bidder-config/create", err, "Couldn't save your agent settings. Please try again.");
  }
}
