import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bids, wallets, profiles } from "@/lib/db/schema";
import { executeContractCall } from "@/lib/circle";
import { escrowAbi } from "@/lib/arc";
import { eq } from "drizzle-orm";
import { createPublicClient, http } from "viem";

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

    // Wait briefly for Circle transaction to settle on Arc
    await new Promise(r => setTimeout(r, 4000));

    // Query contract for the latest on-chain bid ID for this bidder
    let onChainBidId: string | null = null;
    try {
      const publicClient = createPublicClient({
        chain: { id: parseInt(process.env.ARC_CHAIN_ID ?? "5042002"), name: "Arc Testnet", nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } } },
        transport: http("https://rpc.testnet.arc.network"),
      });
      const bidIds = await publicClient.readContract({
        address: escrowAddr as `0x${string}`,
        abi: escrowAbi,
        functionName: "getBidderBids",
        args: [bidderWallet.address as `0x${string}`],
      }) as bigint[];
      const lastBidId = bidIds.at(-1);
      if (lastBidId !== undefined) {
        onChainBidId = lastBidId.toString();
      }
    } catch (e) {
      console.error("Failed to fetch on-chain bid ID:", e);
    }

    const [bid] = await db.insert(bids).values({
      bidderUserId: session.user.id, creatorUserId: creatorProfile.userId,
      bidderAddress: bidderWallet.address, creatorAddress: creatorWallet.address,
      amountUsdc, message, isPrivate: isPrivate ?? false, status: "pending",
      bidTxHash: result.txId, onChainBidId,
    }).returning();
    // Auto-accept logic — runs after bid is inserted
    let autoAccepted = false;
    if (!bid) return NextResponse.json({ success: true, txId: result.txId, autoAccepted });
    try {
      const threshold = creatorProfile.autoAcceptThreshold ?? 0;
      if (threshold > 0) {
        const { scoreBidForCreator } = await import("@/lib/ai");
        const scoreResult = await scoreBidForCreator(
          { amountUsdc, message: message ?? "", bidderAddress: bidderWallet.address },
          { minBid: creatorProfile.minBid, tags: creatorProfile.tags, bio: creatorProfile.bio ?? "", handle: creatorProfile.handle }
        );
        // Update bid score in DB
        await db.update(bids).set({ score: scoreResult.score }).where(eq(bids.id, bid.id));
        if (scoreResult.score >= threshold) {
          const replyTemplate = creatorProfile.autoReplyTemplate ?? "Thanks for reaching out! I have reviewed your bid and I am happy to connect.";
          // Call acceptBid on-chain using creator wallet
          const acceptResult = await executeContractCall({
            walletId: creatorWallet.circleWalletId,
            contractAddress: escrowAddr,
            abi: escrowAbi as any,
            functionName: "acceptBid",
            args: [BigInt(bid.onChainBidId ?? "0"), replyTemplate],
          });
          await db.update(bids).set({
            status: "accepted",
            reply: replyTemplate,
            score: scoreResult.score,
            settlementTxHash: acceptResult.txId,
            settledAt: new Date(),
          }).where(eq(bids.id, bid.id));
          autoAccepted = true;
        }
      }
    } catch (autoErr) {
      // Auto-accept failure is non-fatal — bid stays pending
      console.error("Auto-accept failed:", autoErr);
    }

    return NextResponse.json({ bid, success: true, txId: result.txId, autoAccepted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
