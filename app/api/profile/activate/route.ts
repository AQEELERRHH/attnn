import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { wallets, profiles } from "@/lib/db/schema";
import { executeContractCall } from "@/lib/circle";
import { registryAbi } from "@/lib/arc";
import { eq } from "drizzle-orm";

export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) });
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, session.user.id) });
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    const registryAddr = process.env.ATTN_REGISTRY_CONTRACT;
    if (!registryAddr) return NextResponse.json({ error: "Registry not deployed" }, { status: 500 });

    const result = await executeContractCall({
      walletId: wallet.circleWalletId,
      contractAddress: registryAddr,
      abi: registryAbi as any,
      functionName: "registerCreator",
      args: [profile.handle, profile.minBid, profile.tags, profile.profileURI ?? ""],
    });

    await db.update(profiles).set({ isActive: true, onChainTx: result.txId }).where(eq(profiles.userId, session.user.id));
    return NextResponse.json({ success: true, txId: result.txId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
