import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { goLive } from "@/lib/go-live";
import { RegistrationError } from "@/lib/registration";

/**
 * Registers the creator on the AttnnRegistry from their own wallet (lib/go-live.ts).
 * Requires at least one verified social account (X or LinkedIn) whenever verification
 * is configured. A verified creator short of USDC gets the one-time sponsored top-up
 * when it's set up (lib/sponsorship.ts).
 *
 * Returns { success, status }: "registering" while the top-up and the transaction
 * confirm (the market goes live when the registry confirms it, usually within seconds),
 * or "active" if the creator is already registered. The market is never marked live
 * before Arc confirms it.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.profileWrite, session.user.id));
    if (blocked) return blocked;

    const result = await goLive(session.user.id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.code !== "NOT_FOUND" ? { code: result.code } : {}), ...(result.balance ? { balance: result.balance } : {}) },
        { status: result.httpStatus },
      );
    }
    return NextResponse.json({ success: true, status: result.status, ...(result.sponsored ? { sponsored: true } : {}) });
  } catch (err) {
    if (err instanceof RegistrationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return serverError("profile/activate", err, "Couldn't start registration on Arc. Please try again.");
  }
}
