import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runBidderAgent } from "@/lib/agent";

export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // The agent always runs for the signed-in user; any userId in the body is ignored.
    const result = await runBidderAgent(session.user.id);
    return NextResponse.json({ result, success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Agent run failed" }, { status: 500 });
  }
}
