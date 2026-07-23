import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/lib/x402";
import { getFullProfileByHandle } from "@/lib/profiles";

const PRICE = "$0.001";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ handle: string }> },
) {
  const { handle } = await ctx.params;
  const endpoint = `/api/c/${handle}`;

  const result = await gate(req, PRICE, endpoint);
  if (!result.ok) return result.response;

  const profile = await getFullProfileByHandle(handle);
  if (!profile) {
    return NextResponse.json({ error: "creator not found" }, { status: 404 });
  }

  const res = NextResponse.json({
    handle,
    unlocked: true,
    payer: result.payer,
    profile: {
      handle: profile.handle,
      bio: profile.bio,
      tags: profile.tags,
      minBid: profile.minBid,
      isActive: profile.isActive,
    },
  });
  if (result.paymentResponseHeader) {
    res.headers.set("PAYMENT-RESPONSE", result.paymentResponseHeader);
  }
  return res;
}
