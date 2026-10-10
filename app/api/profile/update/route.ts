import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles, bidderConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { validateCreatorFloor } from "@/lib/bid-rules";
import { validateReplyTemplate } from "@/lib/reply-rules";
import { normalizeTags } from "@/lib/profile-rules";
import { registrationState, syncRegistryProfile, type RegistrySync } from "@/lib/registration";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const updates = body;

    // ── Profile fields ──
    const profileUpdates: Record<string, unknown> = {};
    if (updates.handle !== undefined) profileUpdates.handle = updates.handle;
    if (updates.minBid !== undefined) {
      const floor = validateCreatorFloor(updates.minBid);
      if (!floor.ok) return NextResponse.json({ error: floor.error }, { status: 400 });
      profileUpdates.minBid = floor.amount.toString();
    }
    if (updates.tags !== undefined) {
      const tagCheck = normalizeTags(updates.tags);
      if (!tagCheck.ok) return NextResponse.json({ error: tagCheck.error }, { status: 400 });
      profileUpdates.tags = tagCheck.tags;
    }
    if (updates.bio !== undefined) profileUpdates.bio = updates.bio;
    if (updates.profileURI !== undefined) profileUpdates.profileURI = updates.profileURI;
    if (updates.autoAcceptThreshold !== undefined) profileUpdates.autoAcceptThreshold = updates.autoAcceptThreshold;
    if (updates.autoReplyTemplate !== undefined) {
      const template = validateReplyTemplate(updates.autoReplyTemplate);
      if (!template.ok) return NextResponse.json({ error: template.error }, { status: 400 });
      profileUpdates.autoReplyTemplate = template.value;
    }
    if (updates.availabilityStatus !== undefined) profileUpdates.availabilityStatus = updates.availabilityStatus;
    if (updates.openTo !== undefined) profileUpdates.openTo = updates.openTo;

    let registrySync: RegistrySync | undefined;
    if (Object.keys(profileUpdates).length > 0) {
      const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) });
      // The handle is written to the registry at registration and can't change there.
      const state = existing ? registrationState(existing) : "none";
      if (existing && (state === "active" || state === "registering") && updates.handle !== undefined && updates.handle !== existing.handle) {
        return NextResponse.json({ error: "Your handle is registered on Arc and can't be changed" }, { status: 400 });
      }
      // Check handle uniqueness if changing handle
      if (updates.handle) {
        const existingHandle = await db.query.profiles.findFirst({ where: eq(profiles.handle, updates.handle) });
        if (existingHandle && existingHandle.userId !== session.user.id) {
          return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
        }
      }
      await db.update(profiles).set(profileUpdates).where(eq(profiles.userId, session.user.id));

      const onChainChanged =
        (profileUpdates.minBid !== undefined && profileUpdates.minBid !== existing?.minBid) ||
        (profileUpdates.tags !== undefined && (profileUpdates.tags as string[]).join("\n") !== existing?.tags.join("\n")) ||
        (profileUpdates.profileURI !== undefined && (profileUpdates.profileURI ?? "") !== (existing?.profileURI ?? ""));
      if (existing?.isActive && onChainChanged) registrySync = await syncRegistryProfile(session.user.id);
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

    return NextResponse.json({ success: true, registrySync });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
