import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bids, wallets, profiles } from "@/lib/db/schema";
import { executeContractCall } from "@/lib/circle";
import { escrowAbi, usdcAbi, USDC_ADDRESS } from "@/lib/arc";
import { eq } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import { inngest } from "@/lib/inngest";

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

    // Step 1: Approve escrow to spend USDC
    await executeContractCall({
      walletId: bidderWallet.circleWalletId,
      contractAddress: USDC_ADDRESS,
      abi: usdcAbi as any,
      functionName: "approve",
      args: [escrowAddr, amountUsdc],
    });

    // Wait for approval to settle on Arc
    await new Promise(r => setTimeout(r, 8000));

    // Step 2: Place the bid
    const result = await executeContractCall({
      walletId: bidderWallet.circleWalletId,
      contractAddress: escrowAddr,
      abi: escrowAbi as any,
      functionName: "placeBid",
      args: [creatorWallet.address, amountUsdc, message ?? "", isPrivate ?? false],
    });
    // Fire and forget — Inngest settleTransaction handles on-chain confirmation
    const onChainBidId: string | null = null;

    const [bid] = await db.insert(bids).values({
      bidderUserId: session.user.id, creatorUserId: creatorProfile.userId,
      bidderAddress: bidderWallet.address, creatorAddress: creatorWallet.address,
      amountUsdc, message, isPrivate: isPrivate ?? false, status: "pending",
      bidTxHash: result.txId, onChainBidId,
    }).returning();
    // Auto-accept logic — runs after bid is inserted
    let autoAccepted = false;
    if (!bid) return NextResponse.json({ success: true, txId: result.txId, autoAccepted });
    // Auto-accept is handled by Inngest creatorAgentTriage — not here

    // Fire creator-agent triage event
    if (bid) {
      await inngest.send({
        name: "attnn/bid.placed",
        data: { bidId: bid.id, creatorUserId: creatorProfile.userId },
      }).catch(() => {});

      // Fire settlement engine — gets real 0x hash and onChainBidId in background
      await inngest.send({
        name: "attnn/transaction.pending",
        data: { bidId: bid.id, circleTxId: result.txId, type: "place" },
      }).catch(() => {});
    }

    return NextResponse.json({ bid, success: true, txId: result.txId, autoAccepted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
