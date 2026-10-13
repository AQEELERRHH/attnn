import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { runBidderAgent } from "@/lib/agent";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.agentRun, session.user.id));
    if (blocked) return blocked;
    // The agent always runs for the signed-in user; any userId in the body is ignored.
    const result = await runBidderAgent(session.user.id);
    return NextResponse.json({ result, success: true });
  } catch (err) {
    return serverError("agent/run", err, "The agent run failed. Please try again.");
  }
}
