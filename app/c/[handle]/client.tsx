"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Lock, Coins, Bot, ArrowRight, Shield, Zap,
  Star, Clock, CheckCircle, BarChart2, ExternalLink,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function availabilityLabel(status: string) {
  if (status === "limited") return { dot: "bg-arc-gold", label: "Limited availability" };
  if (status === "not_accepting") return { dot: "bg-arc-coral", label: "Not accepting offers" };
  return { dot: "bg-green", label: "Available" };
}

function formatUsdc(raw: string) {
  const n = Number(BigInt(raw || "0")) / 1_000_000;
  return "$" + n.toFixed(2);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricChip({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${color ?? "text-text-secondary"}`} />
        <span className={`font-display font-bold tabular-nums text-base ${color ?? "text-text-primary"}`}>{value}</span>
      </div>
      <span className="text-xs text-text-dim">{label}</span>
    </div>
  );
}

function AttentionEndpointCard({ handle }: { handle: string }) {
  return (
    <div className="rounded-xl border border-arc-purple/30 bg-arc-bg-2/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-arc-purple" />
          <span className="text-xs font-display font-bold uppercase tracking-wider text-arc-purple">Attention Endpoint</span>
        </div>
        <Badge variant="default" className="text-xs">x402 Enabled</Badge>
      </div>

      <div className="space-y-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Programmatic access</span>
          <span className="text-green text-xs font-medium">Enabled</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">AI agents can bid</span>
          <span className="text-green text-xs font-medium">Yes</span>
        </div>
        <div className="text-xs text-text-dim font-mono break-all bg-arc-bg-0/60 rounded-lg p-2">
          GET /api/c/{handle}
        </div>
      </div>

      {/* Flow diagram */}
      <div className="mt-4 flex items-center gap-1.5 text-xs text-text-secondary flex-wrap">
        {["Discover", "Bid", "Negotiate", "Escrow", "Settle"].map((step, i, arr) => (
          <span key={step} className="flex items-center gap-1.5">
            <span className={i === 0 ? "text-arc-purple font-medium" : i === arr.length - 1 ? "text-green font-medium" : ""}>{step}</span>
            {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-text-dim" />}
          </span>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-border text-xs text-text-dim flex items-center gap-1.5">
        <Shield className="w-3 h-3" />
        Powered by Attnn. · Circle Gateway · Arc Testnet
      </div>
    </div>
  );
}

function PrivateDetailsCard({ onUnlock, loading }: { onUnlock: () => void; loading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-arc-bg-2/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Lock className="w-4 h-4 text-text-secondary" />
        <span className="text-sm font-display font-bold">Private Details</span>
      </div>

      {/* Blurred preview */}
      <div className="blur-sm select-none pointer-events-none space-y-2 mb-4">
        <div className="text-sm text-text-secondary">Detailed availability · Contact channels</div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">••••••••</Badge>
          <Badge variant="secondary">•••••</Badge>
          <Badge variant="secondary">•••••••</Badge>
        </div>
        <div className="text-xs text-text-dim">WhatsApp · Telegram · Email · Calendly</div>
      </div>

      <p className="text-xs text-text-secondary mb-3 leading-relaxed">
        Deeper availability, full bio, and contact channels require a $0.001 USDC access payment.
      </p>
      <Button onClick={onUnlock} disabled={loading} variant="outline" className="w-full text-sm min-h-[44px]">
        {loading ? "Processing…" : "Unlock for $0.001 USDC"}
      </Button>
      <p className="text-xs text-text-dim text-center mt-2">x402 · Secure & on-chain</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PublicProfileClient({
  handle, bio, tags, minBid, isActive, availabilityStatus, openTo,
  highestBid, pendingOfferCount, bidderAgentName, bidderHandle,
}: {
  handle: string; bio: string | null; tags: string[]; minBid: string;
  isActive: boolean; profileURI: string | null; availabilityStatus: string;
  openTo: string[]; highestBid: string | null; pendingOfferCount: number;
  bidderAgentName: string | null; bidderHandle: string | null;
}) {
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const [bidMessage, setBidMessage] = useState("");
  const [bidLoading, setBidLoading] = useState(false);

  const avail = availabilityLabel(availabilityStatus);
  const minBidUsd = formatUsdc(minBid);
  const topOfferUsd = highestBid ? formatUsdc(highestBid) : null;

  async function handleAccess() {
    setAccessLoading(true);
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
      setAccessLoading(false);
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
        toast({ title: "Bid placed!", description: `${bidAmount} USDC bid sent to @${handle}`, variant: "success" });
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

  return (
    <div className="min-h-screen bg-arc-bg-0">
      {/* Minimal top bar */}
      <header className="h-14 border-b border-border bg-arc-bg-0/80 backdrop-blur-xl sticky top-0 z-40 flex items-center px-4 md:px-5">
        <Link href="/" className="flex items-center gap-2">
          <img src="/attnn-logo.jpeg" alt="Attnn." className="w-7 h-7 rounded-lg object-cover" />
          <span className="font-display font-bold text-base">attnn.</span>
        </Link>
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <Link href="/creators" className="text-sm text-text-secondary hover:text-text-primary transition-colors hidden sm:inline">
            Discover
          </Link>
          <Link href="/register">
            <Button size="sm" variant="outline" className="min-h-[44px]">Sign in</Button>
          </Link>
        </div>
      </header>

      {/* Sticky mobile "Make a Bid" CTA — only shows when profile is active and bid form is hidden */}
      {isActive && !showBidForm && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 p-4 bg-arc-bg-0/95 backdrop-blur-xl border-t border-border">
          <Button
            className="w-full bg-arc-gold text-arc-bg-0 hover:bg-arc-gold/90 font-bold h-12 text-base"
            onClick={() => setShowBidForm(true)}
          >
            <Coins className="w-4 h-4 mr-2" />
            Make a Bid · Min {formatUsdc(minBid)} USDC
          </Button>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 md:py-12 pb-28 md:pb-12">
        <div className="grid md:grid-cols-[1fr_320px] gap-5 lg:gap-8">

          {/* ── LEFT COLUMN ───────────────────────────────────────── */}
          <div className="space-y-5 min-w-0">

            {/* Identity header */}
            <div className="rounded-xl border border-border bg-arc-bg-1/60 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                    <h1 className="font-display font-bold text-2xl">@{handle}</h1>
                    {isActive && (
                      <span className="text-xs bg-arc-purple/20 text-arc-lavender border border-arc-purple/30 px-2 py-0.5 rounded-full font-medium">Verified</span>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary">Verified on Attnn.</p>
                </div>
                <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${isActive ? "bg-green/10 text-green border border-green/20" : "bg-border text-text-dim"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? avail.dot : "bg-text-dim"}`} />
                  {isActive ? avail.label : "Inactive"}
                </div>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
              )}

              {/* Metrics row — only real computed values, no fabricated data */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border">
                <MetricChip icon={Coins} label="Min. bid" value={minBidUsd + " USDC"} color="text-arc-gold" />
                <MetricChip icon={BarChart2} label="Active offers" value={pendingOfferCount.toString()} />
                <MetricChip icon={CheckCircle} label="Top offer" value={topOfferUsd ? topOfferUsd + " USDC" : "—"} color={topOfferUsd ? "text-arc-gold" : undefined} />
                <MetricChip icon={Star} label="Reputation" value="—" />
              </div>
            </div>

            {/* Attention Market — bid section */}
            {isActive && (
              <div className="rounded-xl border border-arc-gold/30 bg-arc-bg-1/60 p-6">
                <div className="flex items-center gap-2 mb-5">
                  <TrendingUpIcon />
                  <h2 className="font-display font-bold text-sm uppercase tracking-wider text-arc-gold">Attention Market</h2>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                  <div>
                    <div className="text-xs text-text-dim mb-1">Minimum Bid</div>
                    <div className="text-xl font-display font-bold tabular-nums">{minBidUsd} <span className="text-xs text-text-secondary font-normal">USDC</span></div>
                  </div>
                  <div>
                    <div className="text-xs text-text-dim mb-1">Top Offer</div>
                    <div className={`text-xl font-display font-bold tabular-nums ${topOfferUsd ? "text-arc-gold" : "text-text-dim"}`}>
                      {topOfferUsd ?? "—"} {topOfferUsd && <span className="text-xs text-text-secondary font-normal">USDC</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-dim mb-1">Active Offers</div>
                    <div className="text-xl font-display font-bold tabular-nums">{pendingOfferCount}</div>
                  </div>
                </div>

                {/* Bidder agent identity */}
                {bidderAgentName && (
                  <div className="rounded-lg border border-border bg-arc-bg-2/60 p-3 mb-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-arc-purple to-arc-gold flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-xs text-text-dim">Bidding as</div>
                      <div className="text-sm font-semibold">{bidderAgentName}</div>
                      {bidderHandle && <div className="text-xs text-text-dim">Operated by @{bidderHandle}</div>}
                    </div>
                  </div>
                )}

                {/* Bid form / CTA — hidden on mobile where sticky CTA takes over */}
                {!showBidForm ? (
                  <Button
                    className="w-full bg-arc-gold text-arc-bg-0 hover:bg-arc-gold/90 font-bold h-11 hidden md:flex items-center justify-center"
                    onClick={() => setShowBidForm(true)}
                  >
                    <Coins className="w-4 h-4 mr-2" />
                    Make a Bid
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <input
                      type="number"
                      placeholder={`Minimum ${minBidUsd} USDC`}
                      value={bidAmount}
                      onChange={e => setBidAmount(e.target.value)}
                      min={Number(BigInt(minBid)) / 1_000_000}
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
                    <div className="rounded-lg border border-border bg-arc-bg-2/60 p-3">
                      <div className="flex items-center justify-between text-xs text-text-dim">
                        <span className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> {bidAmount || "0"} USDC locked in escrow</span>
                        <span>No reply in 3 days → auto-refund</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 min-h-[44px]" onClick={() => setShowBidForm(false)}>Cancel</Button>
                      <Button
                        className="flex-1 bg-arc-gold text-arc-bg-0 hover:bg-arc-gold/90 font-bold min-h-[44px]"
                        disabled={bidLoading || !bidAmount || !bidMessage || bidMessage.length < 10}
                        onClick={handlePlaceBid}
                      >
                        {bidLoading ? "Placing…" : `Place ${bidAmount || "0"} USDC Bid`}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* About + Open To */}
            {accessGranted && (
              <div className="space-y-4">
                {bio && (
                  <div className="rounded-xl border border-border bg-arc-bg-1/60 p-5">
                    <h3 className="text-xs font-display font-bold uppercase tracking-wider text-text-secondary mb-3">About</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{bio}</p>
                  </div>
                )}
                {openTo.length > 0 && (
                  <div className="rounded-xl border border-border bg-arc-bg-1/60 p-5">
                    <h3 className="text-xs font-display font-bold uppercase tracking-wider text-text-secondary mb-3">Open To</h3>
                    <div className="flex flex-wrap gap-2">
                      {openTo.map(item => (
                        <Badge key={item} variant="outline" className="text-arc-purple border-arc-purple/40">{item}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="rounded-xl border border-border bg-arc-bg-1/60 p-5">
                    <h3 className="text-xs font-display font-bold uppercase tracking-wider text-text-secondary mb-3">Tags</h3>
                    <div className="flex flex-wrap gap-2">
                      {tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Why reach / typical info — always visible */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-arc-bg-1/60 p-4">
                <div className="text-xs text-text-dim mb-1.5">Typical response</div>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Clock className="w-3.5 h-3.5 text-text-secondary" />
                  <span>—</span>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-arc-bg-1/60 p-4">
                <div className="text-xs text-text-dim mb-1.5">Min. attention price</div>
                <div className="text-sm font-display font-bold tabular-nums text-arc-gold">{minBidUsd} USDC</div>
              </div>
            </div>
          </div>

          {/* ── RIGHT RAIL ────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Private details */}
            {!isActive ? (
              <div className="rounded-xl border border-border bg-arc-bg-2/40 p-6 text-center text-text-secondary text-sm">
                This creator is currently inactive.
              </div>
            ) : accessGranted ? (
              <div className="rounded-xl border border-green/20 bg-green/5 p-4">
                <div className="flex items-center gap-2 text-green text-sm font-medium mb-3">
                  <CheckCircle className="w-4 h-4" />
                  Private details unlocked
                </div>
                <div className="space-y-2 text-sm text-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${avail.dot}`} />
                    {avail.label}
                  </div>
                  {openTo.length > 0 && (
                    <div className="text-xs text-text-dim">Open to: {openTo.join(" · ")}</div>
                  )}
                </div>
              </div>
            ) : (
              <PrivateDetailsCard onUnlock={handleAccess} loading={accessLoading} />
            )}

            {/* Attention endpoint */}
            <AttentionEndpointCard handle={handle} />

            {/* Arc explorer link */}
            <div className="rounded-xl border border-border bg-arc-bg-1/40 p-4">
              <a
                href={`https://testnet.arcscan.app/address/${handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                <span>View on ArcScan</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small inline icon to avoid import complexity
function TrendingUpIcon() {
  return (
    <svg className="w-4 h-4 text-arc-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}
