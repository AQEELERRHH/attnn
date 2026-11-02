import type { NextRequest } from "next/server";

/** The requesting client's IP (Vercel sets x-forwarded-for), or "unknown". For rate limits only. */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** A token sent as "Authorization: Bearer <token>", or null. */
export function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}
