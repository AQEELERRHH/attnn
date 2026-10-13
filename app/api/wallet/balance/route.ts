import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { serverError } from "@/lib/http-guard";
import { mainWallet } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { getUsdcBalance } from "@/lib/activation";

/**
 * The signed-in user's main-wallet USDC balance, read from the USDC contract on Arc.
 * (It used to pick a token by name from Circle's list, which a fake "USDC" airdropped
 * to the wallet could have matched.) `balance` is a decimal string, e.g. "12.5".
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const wallet = await mainWallet(session.user.id);
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    const atomic = await getUsdcBalance(wallet.address);
    return NextResponse.json({ success: true, balance: formatUnits(atomic, 6), symbol: "USDC" });
  } catch (err) {
    return serverError("wallet/balance", err, "Couldn't read your balance right now.");
  }
}
