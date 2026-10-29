import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSocialProvider } from "@/lib/social-verify-rules";
import { VERIFY_COOKIE, VerificationError, exchangeAndIdentify, openState, redirectUriFor, saveVerification } from "@/lib/social-verify";
import { backToDashboard, publicOrigin } from "@/lib/verify-routing";

/**
 * The provider sends the creator back here. Checks, in order: a signed-in session; the
 * signed state cookie (unexpired, same provider, same user); the state the provider
 * echoed. Only then is the code swapped for the account id and handle, which are stored
 * (the token is dropped). The cookie is cleared whatever happens.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const done = (result: { verified?: string; error?: string }) => {
    const res = backToDashboard(req, result);
    res.cookies.set(VERIFY_COOKIE, "", { path: "/api/verify", maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const session = await auth();
  if (!session?.user?.id) {
    const res = NextResponse.redirect(new URL("/register?callbackUrl=/dashboard", publicOrigin(req)), { status: 303 });
    res.cookies.set(VERIFY_COOKIE, "", { path: "/api/verify", maxAge: 0 });
    return res;
  }
  if (!isSocialProvider(provider)) return done({ error: "unavailable" });

  const q = req.nextUrl.searchParams;
  // The creator pressed Cancel / Deny on the provider's page.
  if (q.get("error")) return done({ error: "cancelled" });

  let state;
  try {
    state = openState(req.cookies.get(VERIFY_COOKIE)?.value);
  } catch (err) {
    console.error("verify/callback:", err);
    return done({ error: "failed" });
  }
  const code = q.get("code");
  if (!state || state.provider !== provider || state.userId !== session.user.id || !code || q.get("state") !== state.state) {
    return done({ error: "expired" });
  }

  try {
    const identity = await exchangeAndIdentify(provider, code, state.verifier, redirectUriFor(provider, publicOrigin(req)));
    await saveVerification(state.userId, provider, identity);
    return done({ verified: provider });
  } catch (err) {
    if (err instanceof VerificationError) return done({ error: err.code });
    console.error("verify/callback:", err);
    return done({ error: "failed" });
  }
}
