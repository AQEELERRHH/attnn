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
    const { bidId } = await req.json();

    const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
    if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, session.user.id) });
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    const escrowAddr = process.env.ATTN_ESCROW_CONTRACT;
    if (!escrowAddr) return NextResponse.json({ error: "Escrow not deployed" }, { status: 500 });

    const onChainBidId = BigInt(bid.onChainBidId ?? "0");
    const result = await executeContractCall({
      walletId: wallet.circleWalletId,
      contractAddress: escrowAddr,
      abi: escrowAbi as any,
      functionName: "rejectBid",
      args: [onChainBidId],
    });

    await db.update(bids).set({ status: "rejected", settlementTxHash: result.txId, settledAt: new Date() }).where(eq(bids.id, bidId));
    return NextResponse.json({ success: true, txId: result.txId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
