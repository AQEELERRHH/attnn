import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { profiles, socialVerifications } from "@/lib/db/schema";
import { serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { clientIp } from "@/lib/api-request";
import { creatorFloor } from "@/lib/bid-rules";

/**
 * GET /api/v1/creators?tag=<tag>&limit=<n>: live creator markets an agent can bid on,
 * free. Only what the public market pages already show: handle, topics, floor, whether
 * they're accepting bids, and verified accounts. The full profile (bio, what they're open
 * to) is GET /api/c/<handle>, paid over x402. See docs/AGENTS.md.
 */
export async function GET(req: NextRequest) {
  try {
    const blocked = await limitOrNull(LIMITS.externalBidRead, clientIp(req));
    if (blocked) return blocked;
    const tag = req.nextUrl.searchParams.get("tag")?.trim().toLowerCase() || null;
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), 100);

    const rows = await db
      .select({ userId: profiles.userId, handle: profiles.handle, tags: profiles.tags, minBid: profiles.minBid, availability: profiles.availabilityStatus })
      .from(profiles)
      .where(
        and(
          eq(profiles.isActive, true),
          ne(profiles.availabilityStatus, "not_accepting"),
          tag ? sql`exists (select 1 from unnest(${profiles.tags}) t where lower(t) = ${tag})` : undefined,
        ),
      )
      .orderBy(profiles.handle)
      .limit(limit);
    const verified = rows.length
      ? await db
          .select({ userId: socialVerifications.userId, provider: socialVerifications.provider })
          .from(socialVerifications)
          .where(inArray(socialVerifications.userId, rows.map((r) => r.userId)))
      : [];

    return NextResponse.json({
      creators: rows.map((r) => ({
        handle: r.handle,
        tags: r.tags,
        floor: creatorFloor(r.minBid).toString(),
        availability: r.availability,
        verified: verified.filter((v) => v.userId === r.userId).map((v) => v.provider),
        profile: `/api/c/${r.handle}`,
      })),
    });
  } catch (err) {
    return serverError("v1/creators", err, "Couldn't list creators. Please try again.");
  }
}
