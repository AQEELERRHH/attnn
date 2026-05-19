import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PublicProfileClient } from "./client";
import { formatUsdc } from "@/lib/arc";

export default async function PublicProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.handle, handle),
    with: { user: true },
  });

  if (!profile) notFound();

  const minBidAmount = BigInt(profile.minBid);

  return (
    <PublicProfileClient
      handle={profile.handle}
      bio={profile.bio ?? ""}
      tags={profile.tags}
      minBid={formatUsdc(minBidAmount)}
      isActive={profile.isActive}
      profileURI={profile.profileURI ?? ""}
    />
  );
}
