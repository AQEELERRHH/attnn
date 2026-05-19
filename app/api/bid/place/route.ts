import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bids, wallets, profiles } from "@/lib/db/schema";
import { executeContractCall } from "@/lib/circle";
import { escrowAbi } from "@/lib/arc";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { creatorHandle, amountUsdc, message, isPrivate } = body;

    const creatorProfile = await db.query.profiles.findFirst({ where: eq(profiles.handle, creatorHandle) });
    if (!creatorProfile) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    const creatorWallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, creatorProfile.userId) });
    const bidderWallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, session.user.id) });
    if (!bidderWallet || !creatorWallet) return NextResponse.json({ error: "Wallets not found" }, { status: 404 });

    const escrowAddr = process.env.ATTN_ESCROW_CONTRACT;
    if (!escrowAddr) return NextResponse.json({ error: "Escrow not deployed" }, { status: 500 });

    const result = await executeContractCall({
      walletId: bidderWallet.circleWalletId,
      contractAddress: escrowAddr,
      abi: escrowAbi as any,
      functionName: "placeBid",
      args: [creatorWallet.address, amountUsdc, message ?? "", isPrivate ?? false],
    });

    const [bid] = await db.insert(bids).values({
      bidderUserId: session.user.id, creatorUserId: creatorProfile.userId,
      bidderAddress: bidderWallet.address, creatorAddress: creatorWallet.address,
      amountUsdc, message, isPrivate: isPrivate ?? false, status: "pending",
      bidTxHash: result.txId,
    }).returning();
    return NextResponse.json({ bid, success: true, txId: result.txId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
