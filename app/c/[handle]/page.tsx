import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { profiles, bids, bidderConfigs } from "@/lib/db/schema";
import { eq, and, count, max } from "drizzle-orm";
import { PublicProfileClient } from "./client";
import { formatUsdc } from "@/lib/arc";
import { auth } from "@/lib/auth";

export default async function PublicProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.handle, handle),
    with: { user: true },
  });

  if (!profile) notFound();

  // Fetch highest bid and pending offer count
  const [highestBidResult, pendingCountResult] = await Promise.all([
    db.select({ max: max(bids.amountUsdc) })
      .from(bids)
      .where(and(eq(bids.creatorUserId, profile.userId), eq(bids.status, "pending"))),
    db.select({ count: count() })
      .from(bids)
      .where(and(eq(bids.creatorUserId, profile.userId), eq(bids.status, "pending"))),
  ]);

  const highestBid = highestBidResult[0]?.max ?? null;
  const pendingOfferCount = Number(pendingCountResult[0]?.count ?? 0);
  const minBidAmount = BigInt(profile.minBid);

  // Get logged-in user's agent name if available
  const session = await auth();
  let bidderAgentName: string | null = null;
  let bidderHandle: string | null = null;
  if (session?.user?.id) {
    const [bidderConfig, bidderProfile] = await Promise.all([
      db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, session.user.id) }),
      db.query.profiles.findFirst({ where: eq(profiles.userId, session.user.id) }),
    ]);
    bidderAgentName = bidderConfig?.agentName ?? null;
    bidderHandle = bidderProfile?.handle ?? null;
  }

  return (
    <PublicProfileClient
      handle={profile.handle}
      bio={profile.bio ?? ""}
      tags={profile.tags}
      minBid={formatUsdc(minBidAmount)}
      isActive={profile.isActive}
      profileURI={profile.profileURI ?? ""}
      availabilityStatus={profile.availabilityStatus}
      openTo={profile.openTo}
      highestBid={highestBid ? formatUsdc(BigInt(highestBid)) : null}
      pendingOfferCount={pendingOfferCount}
      bidderAgentName={bidderAgentName}
      bidderHandle={bidderHandle}
    />
  );
}
