import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles, bidderConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const updates = body;

    // ── Profile fields ──
    const profileUpdates: Record<string, unknown> = {};
    if (updates.handle !== undefined) profileUpdates.handle = updates.handle;
    if (updates.minBid !== undefined) profileUpdates.minBid = updates.minBid;
    if (updates.tags !== undefined) profileUpdates.tags = updates.tags;
    if (updates.bio !== undefined) profileUpdates.bio = updates.bio;
    if (updates.profileURI !== undefined) profileUpdates.profileURI = updates.profileURI;
    if (updates.autoAcceptThreshold !== undefined) profileUpdates.autoAcceptThreshold = updates.autoAcceptThreshold;
    if (updates.autoReplyTemplate !== undefined) profileUpdates.autoReplyTemplate = updates.autoReplyTemplate;

    if (Object.keys(profileUpdates).length > 0) {
      // Check handle uniqueness if changing handle
      if (updates.handle) {
        const existingHandle = await db.query.profiles.findFirst({ where: eq(profiles.handle, updates.handle) });
        if (existingHandle && existingHandle.userId !== session.user.id) {
          return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
        }
      }
      await db.update(profiles).set(profileUpdates).where(eq(profiles.userId, session.user.id));
    }

    // ── Bidder config fields ──
    if (updates.bidderActive !== undefined) {
      await db.update(bidderConfigs).set({ isActive: updates.bidderActive }).where(eq(bidderConfigs.userId, session.user.id));
    }
    if (updates.goal !== undefined || updates.dailyBudget !== undefined || updates.searchTags !== undefined || updates.minFitScore !== undefined || updates.defaultMessage !== undefined) {
      const cfgUpdates: Record<string, unknown> = {};
      if (updates.goal !== undefined) cfgUpdates.goal = updates.goal;
      if (updates.dailyBudget !== undefined) cfgUpdates.dailyBudget = updates.dailyBudget;
      if (updates.searchTags !== undefined) cfgUpdates.searchTags = updates.searchTags;
      if (updates.minFitScore !== undefined) cfgUpdates.minFitScore = updates.minFitScore;
      if (updates.defaultMessage !== undefined) cfgUpdates.defaultMessage = updates.defaultMessage;
      await db.update(bidderConfigs).set(cfgUpdates).where(eq(bidderConfigs.userId, session.user.id));
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
