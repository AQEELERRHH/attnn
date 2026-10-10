import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { BidError, submitSettlement } from "@/lib/bids";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

    const body = await req.json().catch(() => null);
    const { bidId, reply } = (body ?? {}) as Record<string, unknown>;
    if (typeof bidId !== "string" || !bidId) return NextResponse.json({ error: "bidId is required" }, { status: 400 });
    if (typeof reply !== "string") return NextResponse.json({ error: "A reply is required" }, { status: 400 });
    const problem = replyError(reply);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    // A reply that is the creator's saved template word for word is labelled as one.
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id), columns: { autoReplyTemplate: true } });
    const replySource = manualReplySource(reply, profile?.autoReplyTemplate);

    const { txId } = await submitSettlement({ bidId, action: "accept", actorUserId: session.user.id, reply, replySource });
    return NextResponse.json({ success: true, status: "confirming", txId }, { status: 202 });
  } catch (err) {
    if (err instanceof BidError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("bid/accept:", err);
    return NextResponse.json({ error: "Could not accept bid" }, { status: 500 });
  }
}
