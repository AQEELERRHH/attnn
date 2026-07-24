import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { wallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { transferUSDC } from "@/lib/circle";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { to, amount } = await req.json();
    if (!to || !amount) return NextResponse.json({ error: "Missing to or amount" }, { status: 400 });
    if (!to.startsWith("0x") || to.length !== 42) return NextResponse.json({ error: "Invalid address" }, { status: 400 });

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

    const wallet = await db.query.wallets.findFirst({
      where: eq(wallets.userId, session.user.id),
    });
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    // Convert USDC amount to 6 decimal atomic units
    const atomicAmount = Math.round(amountFloat * 1_000_000).toString();

    const result = await transferUSDC(wallet.circleWalletId, to, atomicAmount);

    return NextResponse.json({ success: true, txId: result.txId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to send" }, { status: 500 });
  }
}
