import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/lib/x402";
import { getFullProfileByHandle } from "@/lib/profiles";
import { auth } from "@/lib/auth";

const PRICE = "$0.001";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ handle: string }> },
) {
  const { handle } = await ctx.params;
  const endpoint = `/api/c/${handle}`;

  // Signed-in Attn. users get free access — no payment required
  const session = await auth();
  const isSignedIn = !!session?.user?.id;

  if (!isSignedIn) {
    // External agent or non-signed-in visitor — require x402 payment
    const result = await gate(req, PRICE, endpoint);
    if (!result.ok) return result.response;
  }

  const profile = await getFullProfileByHandle(handle);
  if (!profile) {
    return NextResponse.json({ error: "creator not found" }, { status: 404 });
  }

  const res = NextResponse.json({
    handle,
    unlocked: true,
    payer: isSignedIn ? "authenticated-user" : "x402",
    profile: {
      handle: profile.handle,
      bio: profile.bio,
      tags: profile.tags,
      minBid: profile.minBid,
      isActive: profile.isActive,
    },
  });

  return res;
}
