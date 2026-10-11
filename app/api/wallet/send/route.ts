import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { mainWallet } from "@/lib/wallets";
import { auth } from "@/lib/auth";
import { parseRequestId, transferUSDC } from "@/lib/circle";
import { dollarsToAtomic } from "@/lib/format";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.walletSend, session.user.id));
    if (blocked) return blocked;

    const { to, amount, requestId: rawRequestId } = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }
    // Dollars in ("12.5"), atomic USDC out, without float maths.
    const atomic = dollarsToAtomic(String(amount ?? ""));
    if (atomic === null || atomic <= BigInt(0)) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    const requestId = parseRequestId(rawRequestId);
    if (!requestId) return NextResponse.json({ error: "Missing request id. Please reload the page and try again." }, { status: 400 });

    const wallet = await mainWallet(session.user.id);
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

    // Same request id → same transfer: a double click or retry never sends twice.
    const result = await transferUSDC(wallet.circleWalletId, to, atomic.toString(), `send:${session.user.id}:${requestId}`);

    return NextResponse.json({ success: true, txId: result.txId });
  } catch (err) {
    return serverError("wallet/send", err, "We couldn't confirm the transfer. Check your balance before trying again.");
  }
}
