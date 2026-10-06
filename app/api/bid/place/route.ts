import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { BidError, createBidIntent } from "@/lib/bids";

/**
 * Records a bid and queues it for on-chain placement. Returns 202 straight away:
 * the bid shows as "placing" until the placeBid job has escrowed it on Arc
 * ("pending") or it fails with a reason ("failed", no USDC moved).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const { creatorHandle, amountUsdc, message, isPrivate } = (body ?? {}) as Record<string, unknown>;
    if (typeof creatorHandle !== "string" || !creatorHandle) {
      return NextResponse.json({ error: "creatorHandle is required" }, { status: 400 });
    }
    if (message !== undefined && message !== null && (typeof message !== "string" || message.length > 2000)) {
      return NextResponse.json({ error: "Message must be text under 2000 characters" }, { status: 400 });
    }

    const creatorProfile = await db.query.profiles.findFirst({ where: eq(profiles.handle, creatorHandle) });
    if (!creatorProfile) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    const bid = await createBidIntent({
      bidderUserId: session.user.id,
      creatorUserId: creatorProfile.userId,
      amountUsdc: typeof amountUsdc === "number" ? String(amountUsdc) : (amountUsdc as string),
      message: (message as string | undefined) ?? null,
      isPrivate: isPrivate === true,
    });

    return NextResponse.json(
      { success: true, status: "placing", bid: { id: bid.id, status: bid.status, amountUsdc: bid.amountUsdc } },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof BidError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("bid/place:", err);
    return NextResponse.json({ error: "Could not place bid" }, { status: 500 });
  }
}
