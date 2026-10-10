import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/lib/x402";
import { getFullProfileByHandle } from "@/lib/profiles";
import { auth } from "@/lib/auth";

const PRICE = "$0.001";

/**
 * Creator profile as JSON. Free for signed-in Attnn. users; AI agents pay
 * $0.001 USDC over x402 (Circle Gateway, batched and gas-free).
 *
 * The profile is looked up BEFORE charging, so nobody pays for a 404. Paid
 * responses carry a PAYMENT-RESPONSE header and a `payment` receipt in the body.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const endpoint = `/api/c/${handle}`;

  const profile = await getFullProfileByHandle(handle);
  if (!profile) {
    return NextResponse.json({ error: "creator not found" }, { status: 404 });
  }

  const session = await auth();
  const isSignedIn = !!session?.user?.id;

  let payment = null;
  let paymentResponseHeader: string | null = null;
  if (!isSignedIn) {
    const result = await gate(req, {
      price: PRICE,
      endpoint,
      resource: `profile:${profile.handle}`,
      description: `Attnn. creator profile @${profile.handle} (${PRICE} USDC)`,
    });
    if (!result.ok) return result.response;
    payment = result.receipt;
    paymentResponseHeader = result.paymentResponseHeader;
  }

  const res = NextResponse.json({
    handle: profile.handle,
    unlocked: true,
    payer: isSignedIn ? "authenticated-user" : payment?.payer,
    profile: {
      handle: profile.handle,
      bio: profile.bio,
      tags: profile.tags,
      openTo: profile.openTo,
      availabilityStatus: profile.availabilityStatus,
      minBid: profile.minBid,
      isActive: profile.isActive,
      market: `/c/${profile.handle}`,
    },
    ...(payment ? { payment } : {}),
  });
  if (paymentResponseHeader) {
    res.headers.set("PAYMENT-RESPONSE", paymentResponseHeader);
    res.headers.set("Access-Control-Expose-Headers", "PAYMENT-RESPONSE");
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}
