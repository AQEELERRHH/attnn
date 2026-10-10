import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bids } from "@/lib/db/schema";

/**
 * The bidder rates a reply they paid for: { bidId, rating: "up" | "down" | null }.
 * Only the bidder can rate, only bids that cleared on Arc, and they can change or
 * clear their rating. Ratings show on the creator's public market.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { bidId?: unknown; rating?: unknown } | null;
  const bidId = typeof body?.bidId === "string" ? body.bidId : "";
  const rating = body?.rating === "up" ? 1 : body?.rating === "down" ? -1 : body?.rating === null ? null : undefined;
  if (!bidId || rating === undefined) {
    return NextResponse.json({ error: 'Send { bidId, rating: "up" | "down" | null }' }, { status: 400 });
  }

  const [updated] = await db
    .update(bids)
    .set({ replyRating: rating, replyRatedAt: rating === null ? null : new Date() })
    .where(
      and(
        eq(bids.id, bidId),
        eq(bids.bidderUserId, session.user.id),
        eq(bids.status, "accepted"),
        isNotNull(bids.settlementOnChainTxHash),
      ),
    )
    .returning({ id: bids.id, replyRating: bids.replyRating });

  if (!updated) {
    return NextResponse.json({ error: "You can only rate replies to your own bids once they've cleared on Arc" }, { status: 404 });
  }
  return NextResponse.json({ success: true, rating: updated.replyRating });
}
