import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { mainWallet } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ACTIVATION_FUNDS_MESSAGE, ACTIVATION_MIN_USDC, getUsdcBalance } from "@/lib/activation";
import { RegistrationError, submitRegistration } from "@/lib/registration";

/**
 * Registers the creator on the AttnnRegistry from their own wallet.
 *
 * Returns { success, status }: "registering" while the transaction confirms (the
 * market goes live when the registry confirms it, usually within seconds), or
 * "active" if the creator is already registered. The market is never marked live
 * before Arc confirms it.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.profileWrite, session.user.id));
    if (blocked) return blocked;
    const userId = session.user.id;

    const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (profile.isActive) return NextResponse.json({ success: true, status: "active" });

    const wallet = await mainWallet(userId);
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    // Registration is paid for in USDC gas from the creator's own wallet.
    try {
      const balance = await getUsdcBalance(wallet.address);
      if (balance < ACTIVATION_MIN_USDC) {
        return NextResponse.json(
          { error: ACTIVATION_FUNDS_MESSAGE, code: "INSUFFICIENT_FUNDS", balance: balance.toString() },
          { status: 400 },
        );
      }
    } catch (err) {
      // RPC hiccup: don't block activation; an unfunded wallet fails at Circle anyway.
      console.warn("profile/activate: balance check skipped:", err);
    }

    const status = await submitRegistration(userId);
    return NextResponse.json({ success: true, status });
  } catch (err) {
    if (err instanceof RegistrationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return serverError("profile/activate", err, "Couldn't start registration on Arc. Please try again.");
  }
}
