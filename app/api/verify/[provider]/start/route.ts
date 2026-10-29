import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { isSocialProvider } from "@/lib/social-verify-rules";
import { VERIFY_COOKIE, VERIFY_STATE_TTL_MS, authorizeUrl, newVerifyState, providerEnabled, redirectUriFor, sealState } from "@/lib/social-verify";
import { backToDashboard, publicOrigin } from "@/lib/verify-routing";

/**
 * Starts verifying a creator's X or LinkedIn account: stores a signed, 10-minute state
 * in an httpOnly cookie and sends the creator to the provider's sign-in page. A plain
 * link (GET) on purpose: a forged visit can only start a sign-in the victim would still
 * have to approve, and the callback refuses any state that isn't in this cookie.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/register?callbackUrl=/dashboard", publicOrigin(req)), { status: 303 });
  const userId = session.user.id;

  if (!isSocialProvider(provider) || !providerEnabled(provider)) return backToDashboard(req, { error: "unavailable" });
  if (await limitOrNull(LIMITS.socialVerify, userId)) return backToDashboard(req, { error: "rate" });

  try {
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { id: true } });
    if (!profile) return backToDashboard(req, { error: "no_market" });

    const state = newVerifyState(provider, userId);
    const res = NextResponse.redirect(authorizeUrl(provider, state, redirectUriFor(provider, publicOrigin(req))), { status: 303 });
    res.cookies.set(VERIFY_COOKIE, sealState(state), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // lax: the cookie must come back on the provider's top-level redirect to our callback.
      sameSite: "lax",
      path: "/api/verify",
      maxAge: Math.floor(VERIFY_STATE_TTL_MS / 1000),
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("verify/start:", err);
    return backToDashboard(req, { error: "failed" });
  }
}
