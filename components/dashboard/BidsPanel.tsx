"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

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

const STATUS_CONFIG: Record<string, { variant: "default" | "success" | "destructive" | "gold"; label: string }> = {
  pending: { variant: "gold", label: "Pending" },
  accepted: { variant: "success", label: "Accepted" },
  rejected: { variant: "destructive", label: "Rejected" },
  refunded: { variant: "default", label: "Refunded" },
  counter_offered: { variant: "default", label: "Counter sent" },
};

export function BidsPanel({ bids, userId }: { bids: BidData[]; userId: string }) {
  const myBids = bids
    .filter(b => b.bidderUserId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display font-bold text-lg">Bids Placed</h2>
        <p className="text-xs text-text-secondary mt-0.5">All bids placed by your agent and manually.</p>
      </div>

      {myBids.length === 0 ? (
        <Card className="p-10 text-center text-text-dim text-sm">
          No bids placed yet. Activate your agent to start bidding.
        </Card>
      ) : (
        <div className="space-y-2">
          {myBids.map((bid) => {
            const cfg = STATUS_CONFIG[bid.status] ?? { variant: "default" as const, label: bid.status };
            return (
              <Card key={bid.id} className="px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant={cfg.variant} className="shrink-0">{cfg.label}</Badge>
                  <span className="font-display font-bold tabular-nums">{formatAmount(bid.amountUsdc)}</span>
                  <span className="text-text-secondary text-sm">USDC</span>
                  <span className="text-text-dim text-xs">→</span>
                  <span className="text-text-secondary text-xs font-mono">{bid.creatorAddress.slice(0, 6)}…{bid.creatorAddress.slice(-4)}</span>

                  {bid.score != null && (
                    <Badge variant="default" className="ml-auto shrink-0">Score {bid.score}/10</Badge>
                  )}

                  <span className="text-text-dim text-xs ml-auto">
                    {(bid.settledAt ? new Date(bid.settledAt) : new Date(bid.createdAt)).toLocaleDateString()}
                  </span>

                  {bid.status === "counter_offered" && bid.counterOfferAmount && (
                    <span className="text-xs text-arc-gold w-full mt-1">
                      Counter: {formatAmount(bid.counterOfferAmount)} — Agent evaluating…
                    </span>
                  )}

                  {bid.reply && (
                    <p className="text-xs text-text-secondary w-full mt-1 line-clamp-2">Reply: {bid.reply}</p>
                  )}

                  {/* On-chain links */}
                  <div className="flex gap-3 w-full mt-1">
                    {bid.onChainTxHash && (
                      <a href={`https://testnet.arcscan.app/tx/${bid.onChainTxHash}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-arc-purple hover:underline flex items-center gap-1">
                        Bid tx <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {bid.settlementOnChainTxHash && (
                      <a href={`https://testnet.arcscan.app/tx/${bid.settlementOnChainTxHash}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-arc-purple hover:underline flex items-center gap-1">
                        Settlement <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
