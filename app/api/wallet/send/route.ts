import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { wallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { transferUSDC } from "@/lib/circle";
import { dollarsToAtomic } from "@/lib/format";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { to, amount } = await req.json();
    if (typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }
    // Dollars in ("12.5"), atomic USDC out, without float maths.
    const atomic = dollarsToAtomic(String(amount ?? ""));
    if (atomic === null || atomic <= BigInt(0)) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

    const wallet = await db.query.wallets.findFirst({
      where: eq(wallets.userId, session.user.id),
    });
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    const result = await transferUSDC(wallet.circleWalletId, to, atomic.toString());

    return NextResponse.json({ success: true, txId: result.txId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to send" }, { status: 500 });
  }
}
