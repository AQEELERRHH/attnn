import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { requestFreshScore } from "@/lib/agent";

/**
 * POST { creator: "<handle>" }: the signed-in user's agent asks the AI for a fresh score
 * for that creator on its next run. Only this user's own scores are touched. It changes
 * no setting and places no bid, so it needs no security code.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.agentRescore, session.user.id));
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as { creator?: unknown } | null;
    const creator = typeof body?.creator === "string" ? body.creator.trim().replace(/^@/, "") : "";
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(creator)) return NextResponse.json({ error: "Which creator?" }, { status: 400 });

    const stamped = await requestFreshScore(session.user.id, creator);
    if (stamped === 0) {
      return NextResponse.json({ error: "Your agent hasn't scored this creator yet, so there's nothing to refresh." }, { status: 404 });
    }
    return NextResponse.json({ success: true, creator });
  } catch (err) {
    return serverError("agent/rescore", err, "Couldn't ask for a fresh score. Please try again.");
  }
}
