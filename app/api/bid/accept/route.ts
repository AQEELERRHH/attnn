import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { BidError, submitSettlement } from "@/lib/bids";
import { db } from "@/lib/db/client";
import { bids, profiles } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { manualReplySource, replyError } from "@/lib/reply-rules";

/**
 * Sends acceptBid from the creator's wallet. The bid stays pending ("confirming")
 * until the transaction is COMPLETE on Arc; only then is it marked accepted and
 * counted as earnings.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.bidSettle, session.user.id));
    if (blocked) return blocked;

    const body = await req.json().catch(() => null);
    const { bidId, reply } = (body ?? {}) as Record<string, unknown>;
    if (typeof bidId !== "string" || !bidId) return NextResponse.json({ error: "bidId is required" }, { status: 400 });
    if (typeof reply !== "string") return NextResponse.json({ error: "A reply is required" }, { status: 400 });
    const problem = replyError(reply);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    // The creator's saved template word for word is labelled as one; their agent's AI
    // draft sent unchanged is labelled "ai" (bidders see both as auto-replies).
    const [profile, bid] = await Promise.all([
      db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id), columns: { autoReplyTemplate: true } }),
      db.query.bids.findFirst({ where: and(eq(bids.id, bidId), eq(bids.creatorUserId, session.user.id)), columns: { suggestedReply: true } }),
    ]);
    const replySource = manualReplySource(reply, profile?.autoReplyTemplate, bid?.suggestedReply);

    const { txId } = await submitSettlement({ bidId, action: "accept", actorUserId: session.user.id, reply, replySource });
    return NextResponse.json({ success: true, status: "confirming", txId }, { status: 202 });
  } catch (err) {
    if (err instanceof BidError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("bid/accept:", err);
    return NextResponse.json({ error: "Could not accept bid" }, { status: 500 });
  }
}
