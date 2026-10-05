"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Check, X, ArrowUpDown, Bot } from "lucide-react";
import Link from "next/link";

interface BidData {
  id: string; onChainBidId: string | null; bidderUserId: string; creatorUserId: string;
  bidderAddress: string; creatorAddress: string; amountUsdc: string; message: string | null;
  status: string; score: number | null; reply: string | null; bidTxHash: string | null;
  settlementTxHash: string | null; createdAt: string; settledAt: string | null;
  counterOfferAmount: string | null; onChainTxHash: string | null;
  settlementOnChainTxHash: string | null; agentName: string | null;
}

function formatAmount(amount: string) {
  const n = Number(BigInt(amount || "0")) / 1_000_000;
  return "$" + n.toFixed(2);
}

function statusBadge(status: string) {
  const variants: Record<string, "default" | "success" | "destructive" | "gold"> = {
    pending: "gold", accepted: "success", rejected: "destructive", refunded: "default",
  };
  return <Badge variant={variants[status] ?? "default"}>{status}</Badge>;
}

export function OffersPanel({
  bids: initialBids, userId, profileHandle,
}: {
  bids: BidData[];
  userId: string;
  profileHandle?: string;
}) {
  const router = useRouter();
  const [localBids, setLocalBids] = useState(initialBids);
  const [counterBidId, setCounterBidId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterLoading, setCounterLoading] = useState(false);

  const pending = localBids
    .filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered"))
    .sort((a, b) => Number(BigInt(b.amountUsdc) - BigInt(a.amountUsdc)));

  const handleAcceptBid = async (bidId: string) => {
    const reply = window.prompt("Write your reply to accept this bid (min 10 characters):");
    if (reply === null) return;
    if (reply.trim().length < 10) {
      toast({ title: "Reply too short", description: "Reply must be at least 10 characters.", variant: "destructive" });
      return;
    }
    const res = await fetch("/api/bid/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId, userId, reply: reply.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      toast({ title: "Bid accepted!", variant: "success" });
      setLocalBids(prev => prev.map(b => b.id === bidId ? { ...b, status: "accepted" } : b));
      router.refresh();
    } else {
      toast({ title: "Error", description: data.error ?? "Failed to accept", variant: "destructive" });
    }
  };

  const handleRejectBid = async (bidId: string) => {
    const res = await fetch("/api/bid/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId, userId }),
    });
    if (res.ok) {
      toast({ title: "Bid rejected", variant: "success" });
      setLocalBids(prev => prev.map(b => b.id === bidId ? { ...b, status: "rejected" } : b));
      router.refresh();
    } else {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleCounterOffer = async () => {
    if (!counterBidId || !counterAmount) return;
    const amountUsdc = Math.round(parseFloat(counterAmount) * 1_000_000);
    if (isNaN(amountUsdc) || amountUsdc < 5_000_000) {
      toast({ title: "Minimum counter offer is $5 USDC", variant: "destructive" });
      return;
    }
    setCounterLoading(true);
    const res = await fetch("/api/bid/counter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId: counterBidId, counterOfferAmount: amountUsdc }),
    });
    const data = await res.json();
    if (data.success) {
      toast({ title: "Counter offer sent", variant: "success" });
      setLocalBids(prev => prev.map(b => b.id === counterBidId ? { ...b, status: "counter_offered" } : b));
      setCounterBidId(null);
      setCounterAmount("");
    } else {
      toast({ title: data.error ?? "Failed to send counter offer", variant: "destructive" });
    }
    setCounterLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-lg">Incoming Offers</h2>
          <p className="text-xs text-text-secondary mt-0.5">Bids placed on your attention. Accept, reject or counter.</p>
        </div>
        {pending.length > 0 && (
          <Badge variant="gold">{pending.length} pending</Badge>
        )}
      </div>

      {pending.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="text-text-dim text-sm">No pending offers.</div>
          {profileHandle && (
            <p className="text-xs text-text-dim mt-2">
              Share your profile: <code className="text-arc-gold">attnn.xyz/c/{profileHandle}</code>
            </p>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map((bid) => (
            <Card key={bid.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Amount + status + score */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-display font-bold text-lg tabular-nums">{formatAmount(bid.amountUsdc)}</span>
                    <span className="text-xs text-text-secondary">USDC</span>
                    {statusBadge(bid.status)}
                    {bid.score != null && (
                      <Badge variant="default">Score {bid.score}/10</Badge>
                    )}
                  </div>

                  {/* Message */}
                  {bid.message && (
                    <p className="text-sm text-text-secondary leading-relaxed mb-2 line-clamp-3">{bid.message}</p>
                  )}

                  {/* Agent / address */}
                  <div className="flex items-center gap-1.5 text-xs text-text-dim">
                    {bid.agentName ? (
                      <>
                        <Bot className="w-3 h-3" />
                        <Link href={`/agent/${encodeURIComponent(bid.agentName)}`} target="_blank" className="text-text-secondary hover:text-arc-gold transition-colors font-medium">{bid.agentName}</Link>
                        <span>·</span>
                      </>
                    ) : null}
                    <span className="font-mono">{bid.bidderAddress.slice(0, 6)}…{bid.bidderAddress.slice(-4)}</span>
                    <span>·</span>
                    <span>{new Date(bid.createdAt).toLocaleDateString()}</span>
                  </div>

                  {bid.status === "counter_offered" && bid.counterOfferAmount && (
                    <p className="text-xs text-arc-gold mt-1.5">Counter sent: {formatAmount(bid.counterOfferAmount)} — Agent evaluating…</p>
                  )}
                </div>

                {/* Actions */}
                {bid.status === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="default" onClick={() => handleAcceptBid(bid.id)} aria-label="Accept bid">
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleRejectBid(bid.id)} aria-label="Reject bid">
                      <X className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => { setCounterBidId(bid.id); setCounterAmount(""); }}
                      className="text-arc-gold border-arc-gold/40 hover:bg-arc-gold/10"
                      aria-label="Counter offer"
                    >
                      <ArrowUpDown className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {bid.status === "counter_offered" && (
                  <Badge variant="outline" className="text-arc-gold border-arc-gold/40 shrink-0">Counter sent</Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Counter Offer Modal */}
      {counterBidId && (
        <div className="fixed inset-0 bg-arc-bg-0/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-arc-bg-1 border border-border-bright rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-display font-bold mb-2">Send Counter Offer</h3>
            <p className="text-sm text-text-secondary mb-4">The bidder agent will evaluate your counter automatically.</p>
            <div className="mb-4">
              <label className="text-xs text-text-secondary mb-1 block">Counter amount (USDC)</label>
              <input
                type="number" min="5" step="1" placeholder="e.g. 10"
                value={counterAmount} onChange={e => setCounterAmount(e.target.value)}
                className="w-full bg-arc-bg-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-arc-gold"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setCounterBidId(null); setCounterAmount(""); }}>Cancel</Button>
              <Button variant="default" className="flex-1 bg-arc-gold text-arc-bg-0 hover:bg-arc-gold/90" onClick={handleCounterOffer} disabled={counterLoading}>
                {counterLoading ? "Sending…" : "Send Counter"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
