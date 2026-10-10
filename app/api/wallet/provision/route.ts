import { NextRequest, NextResponse } from "next/server";
import { mainWallet } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { wallets } from "@/lib/db/schema";
import { provisionUserWallet } from "@/lib/circle";

export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const userName = session.user.name ?? "Attnn User";

    // Check if wallet already exists
    const existing = await mainWallet(userId);
    if (existing) {
      return NextResponse.json({
        wallet: {
          id: existing.id,
          address: existing.address,
          circleWalletId: existing.circleWalletId,
          blockchain: existing.blockchain,
          state: existing.state,
        },
        success: true,
        alreadyExisted: true,
      });
    }

    // Provision via Circle SDK
    const provisioned = await provisionUserWallet(userId, userName);

    // Store in database. Two tabs provisioning at once: the unique (user, purpose)
    // index keeps the first; the other gets that wallet back.
    const [inserted] = await db
      .insert(wallets)
      .values({
        userId,
        circleWalletId: provisioned.walletId,
        address: provisioned.address,
        blockchain: provisioned.blockchain,
        state: "active",
        purpose: "main",
      })
      .onConflictDoNothing()
      .returning();
    const wallet = inserted ?? (await mainWallet(userId));

    if (!wallet) {
      return NextResponse.json({ error: "Failed to save wallet" }, { status: 500 });
    }

    return NextResponse.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        circleWalletId: wallet.circleWalletId,
        blockchain: wallet.blockchain,
        state: wallet.state,
      },
      success: true,
    });
  } catch (err) {
    console.error("Wallet provision error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to provision wallet" },
      { status: 500 },
    );
  }
}
