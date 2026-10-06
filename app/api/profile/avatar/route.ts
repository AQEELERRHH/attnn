import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles, users } from "@/lib/db/schema";
import {
  AVATAR_MAX_BYTES,
  avatarStorageConfigured,
  deleteAvatar,
  isGooglePhoto,
  sniffImageType,
  uploadAvatar,
} from "@/lib/avatar-storage";

/**
 * Market photo for the signed-in creator.
 *   POST   multipart "file"            → upload a photo (JPG/PNG/WebP, ≤512 KB after resizing)
 *   PUT    { "source": "google" }      → use their Google account photo (opt-in)
 *   DELETE                             → remove; the market shows their initial
 */
async function requireProfile() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) });
  if (!profile) return { error: NextResponse.json({ error: "Create your creator profile first" }, { status: 404 }) };
  return { userId: session.user.id };
}

export async function POST(req: NextRequest) {
  const ctx = await requireProfile();
  if ("error" in ctx) return ctx.error;
  if (!avatarStorageConfigured()) {
    return NextResponse.json({ error: "Photo upload isn't set up yet. Use your Google photo for now." }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No photo received" }, { status: 400 });
  if (file.size > AVATAR_MAX_BYTES) return NextResponse.json({ error: "Photo is too large (max 512 KB after resizing)" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return NextResponse.json({ error: "Use a JPG, PNG or WebP image" }, { status: 415 });

  try {
    const url = await uploadAvatar(ctx.userId, bytes, type);
    await db.update(profiles).set({ avatarUrl: url }).where(eq(profiles.userId, ctx.userId));
    return NextResponse.json({ success: true, avatarUrl: url });
  } catch (err) {
    console.error("avatar upload failed:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await requireProfile();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  if (body?.source !== "google") return NextResponse.json({ error: "Unsupported source" }, { status: 400 });

  const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId), columns: { image: true } });
  if (!isGooglePhoto(user?.image)) return NextResponse.json({ error: "No Google photo on this account" }, { status: 404 });

  await deleteAvatar(ctx.userId).catch(() => {});
  await db.update(profiles).set({ avatarUrl: user.image }).where(eq(profiles.userId, ctx.userId));
  return NextResponse.json({ success: true, avatarUrl: user.image });
}

export async function DELETE() {
  const ctx = await requireProfile();
  if ("error" in ctx) return ctx.error;
  await deleteAvatar(ctx.userId).catch((err) => console.warn("avatar delete failed:", err));
  await db.update(profiles).set({ avatarUrl: null }).where(eq(profiles.userId, ctx.userId));
  return NextResponse.json({ success: true, avatarUrl: null });
}
