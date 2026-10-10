import { NextRequest, NextResponse } from "next/server";
import { mainWallet } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { validateCreatorFloor } from "@/lib/bid-rules";
import { validateReplyTemplate } from "@/lib/reply-rules";
import { normalizeTags } from "@/lib/profile-rules";
import { registrationState, syncRegistryProfile } from "@/lib/registration";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { handle, minBid, tags, bio, profileURI, availabilityStatus, openTo, autoReplyTemplate } = body;

    if (!handle || !minBid) {
      return NextResponse.json({ error: "Handle and minBid are required" }, { status: 400 });
    }
    const floor = validateCreatorFloor(minBid);
    if (!floor.ok) return NextResponse.json({ error: floor.error }, { status: 400 });
    const minBidAtomic = floor.amount.toString();
    const tagCheck = normalizeTags(tags);
    if (!tagCheck.ok) return NextResponse.json({ error: tagCheck.error }, { status: 400 });

    // The reply template the creator typed (it used to be dropped here). Omitted →
    // keep the default template.
    const template = autoReplyTemplate === undefined ? null : validateReplyTemplate(autoReplyTemplate);
    if (template && !template.ok) return NextResponse.json({ error: template.error }, { status: 400 });
    const templateField = template?.ok ? { autoReplyTemplate: template.value } : {};

    // Check handle uniqueness — allow if it's this user's own handle
    const existingHandle = await db.query.profiles.findFirst({ where: eq(profiles.handle, handle) });
    if (existingHandle && existingHandle.userId !== session.user.id) {
      return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
    }

    // Ensure user has a wallet
    const wallet = await mainWallet(session.user.id);
    if (!wallet) return NextResponse.json({ error: "No wallet found. Please set up a wallet first." }, { status: 400 });

    // Check if profile already exists for this user → upsert
    const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) });

    if (existing) {
      // The handle is written to the registry at registration and can't change there.
      const state = registrationState(existing);
      if ((state === "active" || state === "registering") && handle !== existing.handle) {
        return NextResponse.json({ error: "Your handle is registered on Arc and can't be changed" }, { status: 400 });
      }
      // Update existing profile
      const [updated] = await db
        .update(profiles)
        .set({
          handle,
          minBid: minBidAtomic,
          tags: tagCheck.tags,
          bio: bio ?? null,
          profileURI: profileURI ?? null,
          availabilityStatus: availabilityStatus ?? "available",
          openTo: openTo ?? [],
          ...templateField,
        })
        .where(eq(profiles.userId, session.user.id))
        .returning();

      const onChainChanged =
        existing.minBid !== minBidAtomic ||
        existing.tags.join("\n") !== tagCheck.tags.join("\n") ||
        (existing.profileURI ?? "") !== (profileURI ?? "");
      const registrySync = existing.isActive && onChainChanged ? await syncRegistryProfile(session.user.id) : undefined;

      return NextResponse.json({ profile: updated, success: true, updated: true, registrySync });
    }

    // Create new profile
    const [profile] = await db.insert(profiles).values({
      userId: session.user.id,
      handle,
      minBid: minBidAtomic,
      tags: tagCheck.tags,
      bio: bio ?? null,
      profileURI: profileURI ?? null,
      availabilityStatus: availabilityStatus ?? "available",
      openTo: openTo ?? [],
      ...templateField,
      isActive: false,
    }).returning();

    return NextResponse.json({ profile, success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create profile" }, { status: 500 });
  }
}
