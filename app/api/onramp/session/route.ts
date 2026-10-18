import { NextRequest, NextResponse } from "next/server";
import { KitError } from "@circle-fin/onramp-kit/server";
import { auth } from "@/lib/auth";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { mainWallet } from "@/lib/wallets";
import { createOnrampSession, onrampEnabled } from "@/lib/onramp";

/**
 * POST /api/onramp/session: mints an Onramp Kit session that pays USDC on Arc into the
 * signed-in user's own main wallet. The request body is ignored: the destination wallet
 * and user id come from the server only (see lib/onramp.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.onrampSession, userId));
    if (blocked) return blocked;

    if (!onrampEnabled()) {
      return NextResponse.json({ error: "Buying USDC with a card isn't available yet." }, { status: 503 });
    }
    const wallet = await mainWallet(userId);
    if (!wallet) {
      return NextResponse.json({ error: "Create your wallet first." }, { status: 400 });
    }

    const onramp = await createOnrampSession(userId, wallet.address);
    return NextResponse.json(onramp, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof KitError && err.type === "RATE_LIMIT") {
      return NextResponse.json({ error: "Too many requests. Please wait a little and try again." }, { status: 429 });
    }
    return serverError("onramp/session", err, "Couldn't start the card checkout. Please try again.");
  }
}
