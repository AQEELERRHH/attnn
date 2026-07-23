import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { wallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const wallet = await db.query.wallets.findFirst({
      where: eq(wallets.userId, session.user.id),
    });
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    const client = new CircleDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY!,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
    });

    const res = await client.getWalletTokenBalance({ id: wallet.circleWalletId });
    const tokenBalances = res?.data?.tokenBalances ?? [];
    const usdcBalance = tokenBalances.find(
      (t: any) => t.token?.symbol === "USDC" || t.token?.name?.includes("USD")
    );

    return NextResponse.json({
      success: true,
      balance: usdcBalance?.amount ?? "0",
      symbol: "USDC",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
