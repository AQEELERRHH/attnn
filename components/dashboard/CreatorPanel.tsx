"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { FundWalletCard } from "@/app/dashboard/fund-wallet-card";
import { CreatorSetupForm } from "./CreatorSetupForm";
import { toast } from "@/hooks/use-toast";
import { TrendingUp, Clock, CheckCircle, ExternalLink, Edit, Zap, BarChart2 } from "lucide-react";

interface WalletData { id: string; address: string; circleWalletId: string; blockchain: string; state: string; }
interface ProfileData {
  id: string; handle: string; minBid: string; tags: string[]; bio: string | null;
  autoAcceptThreshold: number | null; autoReplyTemplate: string | null;
  isActive: boolean; availabilityStatus: string; openTo: string[];
}
interface BidData { id: string; creatorUserId: string; status: string; amountUsdc: string; settledAt: string | null; createdAt: string; }

function formatAmount(amount: string) {
  const n = Number(BigInt(amount || "0")) / 1_000_000;
  return "$" + n.toFixed(2);
}

function availabilityLabel(status: string) {
  if (status === "limited") return { dot: "bg-arc-gold", label: "Limited availability" };
  if (status === "not_accepting") return { dot: "bg-arc-coral", label: "Not accepting offers" };
  return { dot: "bg-green", label: "Available" };
}

export function CreatorPanel({
  wallet, profile, bids, userId,
}: {
  wallet: WalletData | null;
  profile: ProfileData | null;
  bids: BidData[];
  userId: string;
}) {
  const router = useRouter();
  const [editingProfile, setEditingProfile] = useState(false);
  const [walletFunded, setWalletFunded] = useState(false);
  const [autoAcceptThreshold, setAutoAcceptThreshold] = useState(profile?.autoAcceptThreshold ?? 0);

  const creatorBids = bids.filter(b => b.creatorUserId === userId);
  const acceptedBids = creatorBids.filter(b => b.status === "accepted");
  const pendingBids = creatorBids.filter(b => b.status === "pending");
  const totalEarnings = acceptedBids.reduce((sum, b) => sum + BigInt(b.amountUsdc || "0"), BigInt(0));
  const responseRate = creatorBids.length > 0
    ? Math.round(creatorBids.filter(b => b.status === "accepted" || b.status === "rejected").length / creatorBids.length * 100)
    : null;

  if (!profile || editingProfile) {
    if (wallet && !profile && !editingProfile && !walletFunded && typeof window !== "undefined" && !localStorage.getItem("attnn:funded:" + wallet.address)) {
      return (
        <FundWalletCard
          address={wallet.address}
          onFunded={() => {
            localStorage.setItem("attnn:funded:" + wallet.address, "1");
            setWalletFunded(true);
          }}
        />
      );
    }
    return (
      <CreatorSetupForm
        existingProfile={profile}
        onComplete={() => { setEditingProfile(false); router.refresh(); }}
        onCancel={profile ? () => setEditingProfile(false) : undefined}
      />
    );
  }

  const avail = availabilityLabel(profile.availabilityStatus);

  return (
    <div className="space-y-5">
      {/* Identity header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h2 className="font-display font-bold text-xl">@{profile.handle}</h2>
            {profile.isActive && (
              <span className="text-xs bg-green/10 text-green border border-green/20 px-2 py-0.5 rounded-full font-medium">Verified</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span className={`w-2 h-2 rounded-full ${avail.dot}`} />
            <span>{avail.label}</span>
          </div>
          {profile.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {profile.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {!profile.isActive && (
            <Button variant="default" size="sm" onClick={async () => {
              const res = await fetch("/api/profile/activate", { method: "POST" });
              const data = await res.json();
              if (data.success) { toast({ title: "Activated on Arc!", variant: "success" }); router.refresh(); }
              else toast({ title: "Activation failed", description: data.error ?? "Try again", variant: "destructive" });
            }}>
              <Zap className="w-3.5 h-3.5 mr-1.5" /> Activate on Arc
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
            <Edit className="w-3.5 h-3.5 mr-1.5" /> Edit
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: TrendingUp, label: "Total Earned", value: formatAmount(totalEarnings.toString()), color: "text-green" },
          { icon: Clock, label: "Pending Bids", value: pendingBids.length.toString(), color: "text-arc-gold" },
          { icon: CheckCircle, label: "Deals Closed", value: acceptedBids.length.toString(), color: "text-arc-lavender" },
          { icon: BarChart2, label: "Response Rate", value: responseRate !== null ? responseRate + "%" : "—", color: "text-arc-purple" },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <span className="text-xs text-text-secondary">{label}</span>
            </div>
            <div className={`text-2xl font-display font-bold tabular-nums ${color}`}>{value}</div>
          </Card>
        ))}
      </div>

      {/* Attention market snapshot */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-sm uppercase tracking-wider text-text-secondary">Attention Market</h3>
          <a href={`/c/${profile.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-arc-gold flex items-center gap-1 hover:underline">
            Public profile <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-dim mb-1">Minimum Bid</div>
            <div className="text-lg font-display font-bold tabular-nums">{formatAmount(profile.minBid)} <span className="text-xs text-text-secondary font-normal">USDC</span></div>
          </div>
          <div>
            <div className="text-xs text-text-dim mb-1">Active Offers</div>
            <div className="text-lg font-display font-bold tabular-nums text-arc-gold">{pendingBids.length}</div>
          </div>
        </div>
        {profile.bio && (
          <p className="text-sm text-text-secondary mt-4 pt-4 border-t border-border leading-relaxed line-clamp-3">{profile.bio}</p>
        )}
      </Card>

      {/* Auto-accept threshold */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display font-bold text-sm">Auto-Accept Threshold</h3>
            <p className="text-xs text-text-secondary mt-0.5">Bids scored above this by AISA are accepted automatically</p>
          </div>
          <span className="text-2xl font-display font-bold text-arc-gold tabular-nums">{autoAcceptThreshold}<span className="text-sm text-text-secondary font-normal">/10</span></span>
        </div>
        <Slider
          defaultValue={[autoAcceptThreshold]}
          max={10}
          step={1}
          onValueChange={(val) => setAutoAcceptThreshold(val[0] ?? 0)}
          onValueCommit={async (val) => {
            setAutoAcceptThreshold(val[0] ?? 0);
            await fetch("/api/profile/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, autoAcceptThreshold: val[0] }),
            });
          }}
        />
        <div className="flex justify-between text-xs text-text-dim mt-2">
          <span>0 — Manual review all</span>
          <span>10 — Auto-accept all</span>
        </div>
      </Card>
    </div>
  );
}
