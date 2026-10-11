import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles, bidderConfigs } from "@/lib/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { validateCreatorFloor } from "@/lib/bid-rules";
import { notifyAccount } from "@/lib/withdrawals";
import { validateReplyTemplate } from "@/lib/reply-rules";
import { normalizeTags, validateHandle, validateProfileFields } from "@/lib/profile-rules";
import { validateAutoAcceptSetting } from "@/lib/creator-agent-rules";
import { registrationState, syncRegistryProfile, type RegistrySync } from "@/lib/registration";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.profileWrite, session.user.id));
    if (blocked) return blocked;
    const updates = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

    // ── Profile fields ──
    const profileUpdates: Record<string, unknown> = {};
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
    const fields = validateProfileFields(updates);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
    Object.assign(profileUpdates, fields.values);
    if (updates.autoAcceptThreshold !== undefined) {
      const setting = validateAutoAcceptSetting(updates.autoAcceptThreshold);
      if (!setting.ok) return NextResponse.json({ error: setting.error }, { status: 400 });
      profileUpdates.autoAcceptThreshold = setting.value;
    }
    if (updates.autoReplyTemplate !== undefined) {
      const template = validateReplyTemplate(updates.autoReplyTemplate);
      if (!template.ok) return NextResponse.json({ error: template.error }, { status: 400 });
      profileUpdates.autoReplyTemplate = template.value;
    }
    let newHandle: string | undefined;
    if (updates.handle !== undefined) {
      const h = validateHandle(updates.handle);
      if (!h.ok) return NextResponse.json({ error: h.error }, { status: 400 });
      newHandle = h.handle;
    }

    let registrySync: RegistrySync | undefined;
    if (Object.keys(profileUpdates).length > 0 || newHandle !== undefined) {
      const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) });
      if (!existing) return NextResponse.json({ error: "Create your market first" }, { status: 404 });
      // Same handle in another case is no change (older handles may have capitals).
      if (newHandle !== undefined && newHandle !== existing.handle.toLowerCase()) {
        // The handle is written to the registry at registration and can't change there.
        const state = registrationState(existing);
        if (state === "active" || state === "registering") {
          return NextResponse.json({ error: "Your handle is registered on Arc and can't be changed" }, { status: 400 });
        }
        // Unique ignoring case, like the registry.
        const taken = await db.query.profiles.findFirst({
          where: and(sql`lower(${profiles.handle}) = ${newHandle}`, ne(profiles.userId, session.user.id)),
          columns: { id: true },
        });
        if (taken) return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
        profileUpdates.handle = newHandle;
      }
      if (Object.keys(profileUpdates).length > 0) {
        await db.update(profiles).set(profileUpdates).where(eq(profiles.userId, session.user.id));
      }

      const onChainChanged =
        (profileUpdates.minBid !== undefined && profileUpdates.minBid !== existing?.minBid) ||
        (profileUpdates.tags !== undefined && (profileUpdates.tags as string[]).join("\n") !== existing?.tags.join("\n")) ||
        (profileUpdates.profileURI !== undefined && (profileUpdates.profileURI ?? "") !== (existing?.profileURI ?? ""));
      if (existing?.isActive && onChainChanged) registrySync = await syncRegistryProfile(session.user.id);
    }

    // ── Bidder agent on/off ──
    // Budgets, caps and tags are only set through /api/bidder-config/create, which
    // validates them; this route just pauses and resumes the agent.
    if (updates.bidderActive !== undefined) {
      if (typeof updates.bidderActive !== "boolean") return NextResponse.json({ error: "bidderActive must be true or false" }, { status: 400 });
      const [switched] = await db
        .update(bidderConfigs)
        .set({ isActive: updates.bidderActive })
        .where(and(eq(bidderConfigs.userId, session.user.id), eq(bidderConfigs.isActive, !updates.bidderActive)))
        .returning({ id: bidderConfigs.id });
      // Switching the agent on lets it bid from its wallet: tell the account (spots a stolen session).
      if (switched && updates.bidderActive) {
        await notifyAccount(session.user.id, "Your Attnn. bidder agent was switched on", [
          "Your bidder agent was switched on and can now bid from its agent wallet, within the budget and limits you set.",
        ]);
      }
    }

    return NextResponse.json({ success: true, registrySync });
  } catch (err) {
    return serverError("profile/update", err, "Couldn't save your changes. Please try again.");
  }
}
