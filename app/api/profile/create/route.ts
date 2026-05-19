import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles, wallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { handle, minBid, tags, bio, profileURI } = body;

    if (!handle || !minBid) {
      return NextResponse.json({ error: "Handle and minBid are required" }, { status: 400 });
    }

    // Check handle uniqueness — allow if it's this user's own handle
    const existingHandle = await db.query.profiles.findFirst({ where: eq(profiles.handle, handle) });
    if (existingHandle && existingHandle.userId !== session.user.id) {
      return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
    }

    // Ensure user has a wallet
    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, session.user.id) });
    if (!wallet) return NextResponse.json({ error: "No wallet found. Please set up a wallet first." }, { status: 400 });

    // Check if profile already exists for this user → upsert
    const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) });

    if (existing) {
      // Update existing profile
      const [updated] = await db
        .update(profiles)
        .set({
          handle,
          minBid,
          tags: tags ?? [],
          bio: bio ?? null,
          profileURI: profileURI ?? null,
        })
        .where(eq(profiles.userId, session.user.id))
        .returning();

      return NextResponse.json({ profile: updated, success: true, updated: true });
    }

    // Create new profile
    const [profile] = await db.insert(profiles).values({
      userId: session.user.id,
      handle,
      minBid,
      tags: tags ?? [],
      bio: bio ?? null,
      profileURI: profileURI ?? null,
      isActive: false,
    }).returning();

    return NextResponse.json({ profile, success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to create profile" }, { status: 500 });
  }
}
