"use client";

import { useState } from "react";
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
      const res = await fetch(`/api/c/${handle}`, {
        method: "GET",
        headers: { "payment-signature": btoa("mock") },
      });
      const data = await res.json();
      if (res.ok && data.unlocked) {
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
      <Card className="p-8">
        {/* Always visible — handle only */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-display font-bold">@{handle}</h1>
            <p className="text-text-secondary mt-1 text-sm">Creator on Attn.</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-dim">
            <Lock className="w-4 h-4" />
            <span>Profile locked</span>
          </div>
        </div>

        <Separator className="my-6" />

        {/* Gated content */}
        {!isActive ? (
          <div className="text-center py-8 text-text-secondary">
            This creator is currently inactive.
          </div>
        ) : accessGranted ? (
          <div>
            {/* Full profile revealed after payment */}
            <div className="flex items-center gap-2 mb-4">
              <Unlock className="w-4 h-4 text-arc-gold" />
              <span className="text-xs text-arc-gold uppercase tracking-wider">Profile Unlocked</span>
            </div>
            {bio && (
              <p className="text-text-secondary mb-4">{bio}</p>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 mb-6 text-sm">
              <Coins className="w-4 h-4 text-arc-gold" />
              <span className="font-mono text-arc-gold">{minBid} USDC minimum bid</span>
            </div>
            <Button className="w-full" onClick={() => window.location.href = "/"}>
              Place a Bid on @{handle}
            </Button>
          </div>
        ) : (
          <div className="text-center py-8">
            {/* Blurred teaser */}
            <div className="mb-6 blur-sm select-none pointer-events-none">
              <p className="text-text-secondary mb-3">Bio and contact details hidden</p>
              <div className="flex flex-wrap gap-2 justify-center mb-3">
                <Badge variant="secondary">••••••</Badge>
                <Badge variant="secondary">••••</Badge>
                <Badge variant="secondary">•••••••</Badge>
              </div>
              <p className="text-arc-gold font-mono text-sm">$•.•• USDC minimum</p>
            </div>
            <Lock className="w-10 h-10 mx-auto mb-4 text-text-secondary" />
            <h2 className="text-lg font-display font-semibold mb-2">Profile Locked</h2>
            <p className="text-text-secondary text-sm mb-6">
              Pay $0.001 USDC to unlock this creator&apos;s full profile — bio, tags, and contact details.
            </p>
            <Button onClick={handleAccess} disabled={loading} className="w-full">
              {loading ? "Processing..." : "Unlock for $0.001 USDC"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
