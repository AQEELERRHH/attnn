"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Lock, Coins, MessageCircle } from "lucide-react";

function availabilityLabel(status: string) {
  if (status === "limited") return { emoji: "🟡", label: "Limited availability" };
  if (status === "not_accepting") return { emoji: "🔴", label: "Not accepting offers" };
  return { emoji: "🟢", label: "Available for new opportunities" };
}

export function PublicProfileClient({
  handle, bio, tags, minBid, isActive, availabilityStatus, openTo, highestBid, pendingOfferCount,
}: {
  handle: string; bio: string | null; tags: string[]; minBid: string;
  isActive: boolean; profileURI: string | null; availabilityStatus: string;
  openTo: string[]; highestBid: string | null; pendingOfferCount: number;
}) {
  const [accessGranted, setAccessGranted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const [bidMessage, setBidMessage] = useState("");
  const [bidLoading, setBidLoading] = useState(false);

  async function handleAccess() {
    setLoading(true);
    try {
      const res = await fetch(`/api/c/${handle}`, { method: "GET" });
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

  async function handlePlaceBid() {
    setBidLoading(true);
    try {
      const res = await fetch("/api/bid/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorHandle: handle,
          amountUsdc: Math.round(parseFloat(bidAmount) * 1_000_000).toString(),
          message: bidMessage,
          isPrivate: false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Bid placed!", description: `$${bidAmount} USDC bid sent to @${handle}`, variant: "success" });
        setShowBidForm(false);
        setBidAmount("");
        setBidMessage("");
      } else {
        toast({ title: "Failed", description: data.error ?? "Could not place bid", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setBidLoading(false);
    }
  }

  const avail = availabilityLabel(availabilityStatus);

  return (
    <div className="min-h-screen bg-arc-bg-0">
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Profile Header — always free */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold">@{handle}</h1>
            <p className="text-text-secondary text-sm mt-1">Creator on Attnn.</p>
          </div>
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${isActive ? "bg-green/10 text-green" : "bg-border text-text-dim"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-green" : "bg-text-dim"}`} />
            {isActive ? "Active" : "Inactive"}
          </div>
        </div>

        {/* Stats — always free */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-arc-bg-2 rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-arc-gold">4.9</div>
            <div className="text-xs text-text-dim mt-0.5">Reputation</div>
          </div>
          <div className="bg-arc-bg-2 rounded-xl p-3 text-center">
            <div className="text-lg font-bold">94%</div>
            <div className="text-xs text-text-dim mt-0.5">Response</div>
          </div>
          <div className="bg-arc-bg-2 rounded-xl p-3 text-center">
            <div className="text-lg font-bold">~7h</div>
            <div className="text-xs text-text-dim mt-0.5">Avg reply</div>
          </div>
          <div className="bg-arc-bg-2 rounded-xl p-3 text-center">
            <div className="text-lg font-bold">42</div>
            <div className="text-xs text-text-dim mt-0.5">Deals</div>
          </div>
        </div>

        {/* Attention Market — always free */}
        <div className="bg-arc-bg-2 rounded-xl p-4 mb-6">
          <div className="text-xs text-text-dim uppercase tracking-wider mb-3">Attention Market</div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <div className="text-xs text-text-dim mb-1">Minimum bid</div>
              <div className="text-xl font-bold">${minBid} <span className="text-sm text-text-secondary font-normal">USDC</span></div>
            </div>
            <div>
              <div className="text-xs text-text-dim mb-1">Current top offer</div>
              <div className="text-xl font-bold text-arc-gold">
                {highestBid ? `$${highestBid}` : "—"} <span className="text-sm font-normal">USDC</span>
              </div>
            </div>
          </div>
          {pendingOfferCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <MessageCircle className="w-3.5 h-3.5" />
              {pendingOfferCount} offer{pendingOfferCount > 1 ? "s" : ""} in queue
            </div>
          )}
        </div>

        {/* Bid Button — always visible */}
        {!showBidForm ? (
          <Button
            className="w-full mb-6 bg-arc-gold text-arc-bg-0 hover:bg-arc-gold/90 font-bold text-base py-5"
            onClick={() => setShowBidForm(true)}
            disabled={!isActive}
          >
            <Coins className="w-4 h-4 mr-2" />
            Make a Bid — from ${minBid}
          </Button>
        ) : (
          <div className="bg-arc-bg-2 rounded-xl p-4 mb-6 space-y-3">
            <div className="text-xs text-text-dim uppercase tracking-wider mb-2">Make an Offer</div>
            <input
              type="number"
              placeholder={`Minimum $${minBid} USDC`}
              value={bidAmount}
              onChange={e => setBidAmount(e.target.value)}
              min={minBid}
              step="1"
              className="w-full text-sm px-3 py-2.5 rounded-lg border border-border bg-arc-bg-0 text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold"
            />
            <textarea
              placeholder="Why do you want their attention? (min 10 characters)"
              value={bidMessage}
              onChange={e => setBidMessage(e.target.value)}
              rows={3}
              className="w-full text-sm px-3 py-2.5 rounded-lg border border-border bg-arc-bg-0 text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold resize-none"
            />
            <div className="bg-arc-bg-0 rounded-lg p-3 text-center border border-border">
              <div className="text-xs text-text-dim">🔒 ${bidAmount || "0"} USDC → Escrow</div>
              <div className="text-xs text-text-dim mt-0.5">No reply in 14 days → automatic refund</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowBidForm(false)}>Cancel</Button>
              <Button
                className="flex-1 bg-arc-gold text-arc-bg-0 hover:bg-arc-gold/90 font-bold"
                disabled={bidLoading || !bidAmount || !bidMessage || bidMessage.length < 10}
                onClick={handlePlaceBid}
              >
                {bidLoading ? "Placing..." : `Place $${bidAmount || "0"} Bid`}
              </Button>
            </div>
          </div>
        )}

        {/* Gated Section */}
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-arc-bg-2 flex items-center justify-between">
            <div className="text-xs text-text-dim uppercase tracking-wider">Full Profile</div>
            {!accessGranted && <Lock className="w-3.5 h-3.5 text-text-dim" />}
          </div>

          {accessGranted ? (
            <div className="p-4 space-y-4">
              {/* Availability Status */}
              <div className="flex items-center gap-2 text-sm">
                <span>{avail.emoji}</span>
                <span className="text-text-primary">{avail.label}</span>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div>
                  <div className="text-xs text-text-dim mb-2">Interests</div>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map(tag => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Bio */}
              {bio && (
                <div>
                  <div className="text-xs text-text-dim mb-2">About</div>
                  <p className="text-sm text-text-secondary leading-relaxed">{bio}</p>
                </div>
              )}

              {/* Open To */}
              {openTo.length > 0 && (
                <div>
                  <div className="text-xs text-text-dim mb-2">Open to</div>
                  <div className="flex flex-wrap gap-1.5">
                    {openTo.map(item => (
                      <Badge key={item} variant="outline" className="text-arc-purple border-arc-purple">{item}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Agent Access */}
              <div className="bg-arc-bg-2 rounded-lg p-3">
                <div className="text-xs text-arc-purple mb-1">Agent Access</div>
                <div className="text-xs text-text-secondary">✓ x402 enabled · Any AI agent can bid</div>
                <div className="text-xs text-text-dim mt-1 font-mono">attnn.xyz/api/c/{handle}</div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center">
              {/* Blurred preview */}
              <div className="blur-sm select-none pointer-events-none mb-4 space-y-2">
                <div className="text-sm text-text-secondary">🟢 Available for new opportunities</div>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  <Badge variant="secondary">••••••</Badge>
                  <Badge variant="secondary">••••</Badge>
                  <Badge variant="secondary">•••••••</Badge>
                </div>
                <div className="text-sm text-text-secondary">Open to: Partnerships · Dev work · Research</div>
              </div>
              <p className="text-sm text-text-secondary mb-4">
                Pay $0.001 USDC to unlock availability status, interests, bio, and contact details.
              </p>
              <Button onClick={handleAccess} disabled={loading} variant="outline" className="w-full">
                {loading ? "Processing..." : "Unlock for $0.001 USDC"}
              </Button>
              <div className="text-xs text-text-dim mt-2">x402 · Circle Gateway · Instant access</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
