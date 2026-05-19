import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bidderConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { goal, dailyBudget, searchTags, minFitScore, defaultMessage } = body;

    // Check if already exists
    const existing = await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, session.user.id) });
    if (existing) {
      // Update instead
      const updates: any = {};
      if (goal !== undefined) updates.goal = goal;
      if (dailyBudget !== undefined) updates.dailyBudget = dailyBudget;
      if (searchTags !== undefined) updates.searchTags = searchTags;
      if (minFitScore !== undefined) updates.minFitScore = minFitScore;
      if (defaultMessage !== undefined) updates.defaultMessage = defaultMessage;
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
      isActive: false,
    }).returning();

    return NextResponse.json({ config, success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to create bidder config" }, { status: 500 });
  }
}
