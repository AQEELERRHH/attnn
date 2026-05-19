import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles, wallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
// x402 imports removed


export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { handle, signature: _signature } = body;

    if (!handle) {
      return NextResponse.json({ error: "Handle required" }, { status: 400 });
    }

    // Get the profile
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.handle, handle),
    });
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Get the current user's wallet
    const userWallet = await db.query.wallets.findFirst({
      where: eq(wallets.userId, session.user.id),
    });
    if (!userWallet) {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }

    // Check if x402 is enabled
    if (process.env.ENABLE_X402_MIDDLEWARE !== "true") {
      // Bypass for development
      return NextResponse.json({ success: true, bypassed: true });
    }

    // In a real implementation, we would:
    // 1. Create a payment request if no signature provided
    // 2. Verify the signature if provided
    // 3. Store successful payment in database
    
    // For now, we'll simulate a successful payment
    // TODO: Implement actual x402 flow
    
    return NextResponse.json({
      success: true,
      message: "Access granted (simulated)",
      // Include payment request challenge if no signature
    });
  } catch (err: any) {
    console.error("x402 access error:", err);
    return NextResponse.json(
      { error: err.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}