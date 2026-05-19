import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scoreBidForCreator, evaluateCreatorForBidder } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { type } = body;

    if (type === "bid") {
      const result = await scoreBidForCreator(body.bid, body.creator);
      return NextResponse.json({ result, success: true });
    } else if (type === "creator") {
      const result = await evaluateCreatorForBidder(body.creator, body.goal);
      return NextResponse.json({ result, success: true });
    }
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Scoring failed" }, { status: 500 });
  }
}
