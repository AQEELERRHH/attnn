import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runBidderAgent } from "@/lib/agent";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const result = await runBidderAgent(body.userId ?? session.user.id);
    return NextResponse.json({ result, success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Agent run failed" }, { status: 500 });
  }
}
