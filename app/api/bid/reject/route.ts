import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { BidError, submitSettlement } from "@/lib/bids";

/**
 * Sends rejectBid from the creator's wallet, which refunds the bidder on-chain.
 * The bid is marked rejected only once the transaction is COMPLETE.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const { bidId } = (body ?? {}) as Record<string, unknown>;
    if (typeof bidId !== "string" || !bidId) return NextResponse.json({ error: "bidId is required" }, { status: 400 });

    const { txId } = await submitSettlement({ bidId, action: "reject", actorUserId: session.user.id });
    return NextResponse.json({ success: true, status: "confirming", txId }, { status: 202 });
  } catch (err) {
    if (err instanceof BidError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("bid/reject:", err);
    return NextResponse.json({ error: "Could not reject bid" }, { status: 500 });
  }
}
