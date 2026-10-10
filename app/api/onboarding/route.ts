import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

/**
 * First-run guide state for the signed-in user.
 *   { action: "welcome", role?: "bidder" | "creator" | "both" }  welcome closed (finished or skipped)
 *   { action: "dismiss-checklist" }                               hide "Get started"
 *   { action: "show-checklist" }                                  Help → show it again
 * Checklist progress itself is never stored: it's worked out from real data (lib/onboarding.ts).
 */
const ROLES = new Set(["bidder", "creator", "both"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; role?: unknown } | null;
  const action = body?.action;
  const now = new Date();

  if (action === "welcome") {
    const role = body?.role;
    if (role !== undefined && (typeof role !== "string" || !ROLES.has(role))) {
      return NextResponse.json({ error: "role must be bidder, creator or both" }, { status: 400 });
    }
    await db
      .update(users)
      .set({
        onboardingSeenAt: now,
        ...(role ? { role: role as "bidder" | "creator" | "both" } : {}),
      })
      .where(eq(users.id, session.user.id));
    return NextResponse.json({ success: true });
  }
  if (action === "dismiss-checklist" || action === "show-checklist") {
    await db
      .update(users)
      .set({ checklistDismissedAt: action === "dismiss-checklist" ? now : null })
      .where(eq(users.id, session.user.id));
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
