// Polyfill BigInt JSON serialization for NextResponse.json
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { bids, wallets } from "@/lib/db/schema";
import { executeContractCall } from "@/lib/circle";
import { escrowAbi } from "@/lib/arc";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { bidId, reply } = await req.json();
    if (!reply || reply.length < 10) return NextResponse.json({ error: "Reply must be 10+ chars" }, { status: 400 });

    const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
    if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    if (bid.status !== "pending") return NextResponse.json({ error: "Bid already processed" }, { status: 400 });

    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, session.user.id) });
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    const escrowAddr = process.env.ATTN_ESCROW_CONTRACT;
    if (!escrowAddr) return NextResponse.json({ error: "Escrow not deployed" }, { status: 500 });

    // Rescue Poll: Give the blockchain 5 extra seconds to finalize before failing
    let finalBidId = bid.onChainBidId;
    if (!finalBidId) {
      console.log("Bid ID missing, attempting rescue poll...");
      try {
        const { createPublicClient, http } = require("viem");
        const publicClient = createPublicClient({
          chain: { id: parseInt(process.env.ARC_CHAIN_ID ?? "5042002"), name: "Arc Testnet", nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } } },
          transport: http("https://rpc.testnet.arc.network"),
        });
        for (let i = 0; i < 2; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const bidIds = await publicClient.readContract({
            address: process.env.ATTN_ESCROW_CONTRACT,
            abi: escrowAbi,
            functionName: "getBidderBids",
            args: [bid.bidderAddress],
          }) as bigint[];
          const lastId = bidIds[bidIds.length - 1];
          if (lastId !== undefined) {
            finalBidId = lastId.toString();
            await db.update(bids).set({ onChainBidId: finalBidId }).where(eq(bids.id, bid.id));
            console.log("Rescue poll succeeded! Got ID:", finalBidId);
            break;
          }
        }
      } catch (e) { console.error("Rescue poll failed:", e); }
      if (!finalBidId) {
        return NextResponse.json({ error: "Bid still finalizing on-chain. Please wait 30 seconds and try again." }, { status: 400 });
      }
    }
    const onChainBidId = BigInt(finalBidId);
    const result = await executeContractCall({
      walletId: wallet.circleWalletId,
      contractAddress: escrowAddr,
      abi: escrowAbi as any,
      functionName: "acceptBid",
      args: [onChainBidId, reply],
    });

    await db.update(bids).set({ status: "accepted", reply, settlementTxHash: result.txId, settledAt: new Date() }).where(eq(bids.id, bidId));
    return NextResponse.json({ success: true, txId: result.txId, reply });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
