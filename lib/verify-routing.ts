/**
 * Small helpers shared by the /api/verify routes: the public origin and the
 * redirect back to the creator's dashboard with a result in the query string.
 */
import { NextRequest, NextResponse } from "next/server";

/** The site's public origin: AUTH_URL when set (what the provider has registered), else the request's. */
export function publicOrigin(req: NextRequest): string {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall back to the request */
    }
  }
  return req.nextUrl.origin;
}

/** Back to the Creator tab with ?verified=<provider> or ?verify_error=<code>. */
export function backToDashboard(req: NextRequest, result: { verified?: string; error?: string }): NextResponse {
  const url = new URL("/dashboard", publicOrigin(req));
  url.searchParams.set("view", "creator");
  if (result.verified) url.searchParams.set("verified", result.verified);
  if (result.error) url.searchParams.set("verify_error", result.error);
  return NextResponse.redirect(url, { status: 303 });
}
