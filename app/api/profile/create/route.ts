import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { mainWallet } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { validateCreatorFloor } from "@/lib/bid-rules";
import { validateReplyTemplate } from "@/lib/reply-rules";
import { normalizeTags, validateHandle, validateProfileFields } from "@/lib/profile-rules";
import { registrationState, syncRegistryProfile } from "@/lib/registration";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.profileWrite, session.user.id));
    if (blocked) return blocked;

    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const { minBid, tags, autoReplyTemplate } = body;

    const h = validateHandle(body.handle);
    if (!h.ok) return NextResponse.json({ error: h.error }, { status: 400 });
    if (minBid === undefined || minBid === null || minBid === "") {
      return NextResponse.json({ error: "Set the lowest bid you'll accept" }, { status: 400 });
    }
    const floor = validateCreatorFloor(minBid);
    if (!floor.ok) return NextResponse.json({ error: floor.error }, { status: 400 });
    const minBidAtomic = floor.amount.toString();
    const tagCheck = normalizeTags(tags);
    if (!tagCheck.ok) return NextResponse.json({ error: tagCheck.error }, { status: 400 });
    const fields = validateProfileFields({
      bio: body.bio ?? null,
      openTo: body.openTo ?? [],
      availabilityStatus: body.availabilityStatus ?? "available",
      profileURI: body.profileURI ?? null,
    });
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
    const { bio, openTo, availabilityStatus, profileURI } = fields.values;

    // The reply template the creator typed (it used to be dropped here). Omitted →
    // keep the default template.
    const template = autoReplyTemplate === undefined ? null : validateReplyTemplate(autoReplyTemplate);
    if (template && !template.ok) return NextResponse.json({ error: template.error }, { status: 400 });
    const templateField = template?.ok ? { autoReplyTemplate: template.value } : {};

    // Unique ignoring case, like the registry on Arc; this user's own handle is fine.
    const existingHandle = await db.query.profiles.findFirst({
      where: and(sql`lower(${profiles.handle}) = ${h.handle}`, ne(profiles.userId, session.user.id)),
      columns: { id: true },
    });
    if (existingHandle) return NextResponse.json({ error: "Handle already taken" }, { status: 409 });

    // Ensure user has a wallet
    const wallet = await mainWallet(session.user.id);
    if (!wallet) return NextResponse.json({ error: "No wallet found. Please set up a wallet first." }, { status: 400 });

    // Check if profile already exists for this user → upsert
    const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) });

    if (existing) {
      // The handle is written to the registry at registration and can't change there.
      const state = registrationState(existing);
      // Same handle in another case is no change (older handles may have capitals).
      const sameHandle = h.handle === existing.handle.toLowerCase();
      if ((state === "active" || state === "registering") && !sameHandle) {
        return NextResponse.json({ error: "Your handle is registered on Arc and can't be changed" }, { status: 400 });
      }
      const handle = sameHandle ? existing.handle : h.handle;
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
      handle: h.handle,
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
    return serverError("profile/create", err, "Couldn't save your market. Please try again.");
  }
}
