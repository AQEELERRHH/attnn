/**
 * Request guards for routes that change state.
 *
 * sameOrigin(): a browser always sends Origin (or Sec-Fetch-Site) on a POST. If either
 * says the request came from another website, refuse it, so a malicious page can't make
 * a signed-in user's browser move their money (CSRF). Requests with neither header are
 * not from a browser page and still need a valid session cookie.
 *
 * serverError(): logs the real error and returns a plain message, so users never see
 * Circle, database or stack details.
 */
import { NextRequest, NextResponse } from "next/server";

function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const own = req.headers.get("host");
  if (own) hosts.add(own.toLowerCase());
  for (const v of [process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
    try {
      if (v) hosts.add(new URL(v).host.toLowerCase());
    } catch {
      /* ignore a malformed setting */
    }
  }
  return hosts;
}

/** A 403 response if the request came from another site, else null. */
export function sameOrigin(req: NextRequest): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "Request blocked" }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      host = null;
    }
    if (!host || !allowedHosts(req).has(host)) {
      return NextResponse.json({ error: "Request blocked" }, { status: 403 });
    }
  }
  return null;
}

/** Logs `err` with context and returns a generic 500 the user can read. */
export function serverError(context: string, err: unknown, message = "Something went wrong. Please try again."): NextResponse {
  console.error(`${context}:`, err);
  return NextResponse.json({ error: message }, { status: 500 });
}
