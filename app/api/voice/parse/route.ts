import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { callAI } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { text } = await req.json();
    if (!text) return NextResponse.json({ error: "No text provided" }, { status: 400 });

    const systemPrompt = "You are a voice command parser for the Attnn attention marketplace. "
      + "Parse the user's spoken command into an action. "
      + "Actions: 'run_agent', 'pause_agent', 'show_inbox', 'accept_bid', 'reject_bid', 'show_earnings', 'show_balance'. "
      + "Return JSON: { \"action\": string, \"params\": object, \"confidence\": number }";

    const raw = await callAI(text, systemPrompt);
    const cleaned = raw.replace(/```json?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json({ ...parsed, success: true });
  } catch (err: any) {
    return NextResponse.json({ action: "unknown", params: {}, confidence: 0, error: err.message, success: false });
  }
}
