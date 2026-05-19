"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { Lock, Unlock, Coins } from "lucide-react";

export function PublicProfileClient({
  handle, bio, tags, minBid, isActive, profileURI,
}: {
  handle: string; bio: string | null; tags: string[]; minBid: string;
  isActive: boolean; profileURI: string | null;
}) {
  const [accessGranted, setAccessGranted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleAccess() {
    setLoading(true);
    try {
      const res = await fetch("/api/x402/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const data = await res.json();
      if (data.success) {
        setAccessGranted(true);
      } else {
        toast({ title: "Access denied", description: data.error ?? "Payment required", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to request access", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Profile Card */}
      <Card className="p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-display font-bold">@{handle}</h1>
            {bio && <p className="text-text-secondary mt-2">{bio}</p>}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Coins className="w-4 h-4 text-arc-gold" />
            <span className="font-mono">{minBid} USDC</span>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </div>
        )}

        <Separator className="my-6" />

        {/* Access Gate */}
        {!isActive ? (
          <div className="text-center py-8 text-text-secondary">
            This creator is currently inactive.
          </div>
        ) : accessGranted ? (
          <div className="text-center py-8">
            <Unlock className="w-12 h-12 mx-auto mb-4 text-arc-gold" />
            <h2 className="text-xl font-display font-semibold mb-2">Access Granted</h2>
            <p className="text-text-secondary mb-6">
              You can now view {profileURI ? "the full profile" : "exclusive content"}.
            </p>
            {profileURI && (
              <Link href={profileURI}>
                <Button>View Full Profile</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <Lock className="w-12 h-12 mx-auto mb-4 text-text-secondary" />
            <h2 className="text-xl font-display font-semibold mb-2">Profile Locked</h2>
            <p className="text-text-secondary mb-6">
              Access this creator&apos;s full profile for $0.001 USDC via Circle x402.
            </p>
            <Button onClick={handleAccess} disabled={loading}>
              {loading ? "Processing..." : "Unlock for $0.001 USDC"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
