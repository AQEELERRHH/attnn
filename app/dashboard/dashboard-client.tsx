"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FundWalletCard } from "./fund-wallet-card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { LogOut, Wallet, Play, Square, MessageCircle, Check, X, Activity, Zap, Bot, Users } from "lucide-react";

interface WalletData { id: string; address: string; circleWalletId: string; blockchain: string; state: string; }
interface ProfileData { id: string; handle: string; minBid: string; tags: string[]; bio: string | null; autoAcceptThreshold: number | null; autoReplyTemplate: string | null; isActive: boolean; }
interface BidderConfigData { id: string; goal: string | null; dailyBudget: string; maxBidPerCreator: string; minFitScore: number; searchTags: string[]; defaultMessage: string | null; isActive: boolean; }
interface BidData { id: string; onChainBidId: string | null; bidderUserId: string; creatorUserId: string; bidderAddress: string; creatorAddress: string; amountUsdc: string; message: string | null; status: string; score: number | null; reply: string | null; bidTxHash: string | null; settlementTxHash: string | null; createdAt: string; settledAt: string | null; }
interface LogData { id: string; action: string; data: any; txHash: string | null; createdAt: string; }

export function DashboardClient({
  wallet, profile, bidderConfig, bids, logs, userId, userRole,
}: {
  wallet: WalletData | null;
  profile: ProfileData | null;
  bidderConfig: BidderConfigData | null;
  bids: BidData[];
  logs: LogData[];
  userId: string;
  userRole: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(profile?.isActive ? "bidder" : "creator");
  const [dailyBudget, setDailyBudget] = useState(bidderConfig?.dailyBudget ?? "50000000");
  const [minFitScore, setMinFitScore] = useState(bidderConfig?.minFitScore ?? 5);
  const [agentRunning, setAgentRunning] = useState(false);
  const [provisioning, setProvisioning] = useState(!wallet);
  const [editingProfile, setEditingProfile] = useState(false);
  const [walletFunded, setWalletFunded] = useState(false);
  const [editingBidder, setEditingBidder] = useState(false);
  const [autoAcceptThreshold, setAutoAcceptThreshold] = useState(profile?.autoAcceptThreshold ?? 0);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendLoading, setSendLoading] = useState(false);

  // Auto-provision wallet if missing
  useEffect(() => {
    if (wallet) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wallet/provision", { method: "POST" });
        const data = await res.json();
        if (!cancelled) {
          if (data.success) {
            toast({
              title: data.alreadyExisted ? "Wallet ready" : "Wallet created",
              description: data.wallet?.address?.slice(0, 6) + "..." + data.wallet?.address?.slice(-4),
              variant: "success",
            });
            setProvisioning(false);
            router.refresh();
          } else {
            toast({ title: "Wallet provisioning failed", description: data.error ?? "Unknown error", variant: "destructive" });
            setProvisioning(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          toast({ title: "Wallet provisioning error", variant: "destructive" });
          setProvisioning(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // run once on mount

  const formatLogData = (action: string, data: any): string => {
    if (!data || Object.keys(data).length === 0) return "";
    try {
      switch (action) {
        case "creator_discovered":
          return [
            data.count !== undefined ? `${data.count} creator${data.count !== 1 ? "s" : ""} found` : null,
            data.scored !== undefined ? `${data.scored} scored` : null,
            data.bidsPlaced !== undefined ? `${data.bidsPlaced} bid${data.bidsPlaced !== 1 ? "s" : ""} placed` : null,
          ].filter(Boolean).join(" · ");
        case "bid_placed":
          return [
            data.amount ? `Bid ${formatAmount(data.amount)}` : null,
            data.creator ? `on @${data.creator}` : null,
            data.score !== undefined ? `· fit score ${data.score}/10` : null,
          ].filter(Boolean).join(" ");
        case "agent_stopped":
          return data.reason ?? "Agent stopped";
        case "auto_refund":
          return data.bidId ? `Refunded bid ${data.bidId.slice(0, 8)}...` : "Bid refunded";
        case "bid_accepted":
          return data.creator ? `Accepted by @${data.creator}` : "Bid accepted";
        case "bid_rejected":
          return data.creator ? `Rejected by @${data.creator}` : "Bid rejected";
        default:
          return Object.entries(data)
            .slice(0, 3)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ");
      }
    } catch {
      return "";
    }
  };

  const formatAmount = (amount: string) => {
    const n = Number(BigInt(amount || "0")) / 1_000_000;
    return "$" + n.toFixed(2);
  };

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      toast({ title: "Copied!", variant: "success" });
    }
  };

  const fetchBalance = async () => {
    if (walletBalance !== null) return;
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/wallet/balance");
      const data = await res.json();
      if (data.success) setWalletBalance(data.balance);
    } catch {}
    finally { setBalanceLoading(false); }
  };

  const handleRunAgent = async () => {
    setAgentRunning(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Agent run complete", description: `${data.result?.bidsPlaced ?? 0} bids placed`, variant: "success" });
      } else {
        toast({ title: "Agent error", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to run agent", variant: "destructive" });
    }
    setAgentRunning(false);
    router.refresh();
  };

  const handleAcceptBid = async (bidId: string) => {
    const reply = window.prompt("Write your reply to accept this bid (min 10 characters):");
    if (reply === null) return;
    if (reply.trim().length < 10) {
      toast({ title: "Reply too short", description: "Reply must be at least 10 characters.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/bid/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId, userId, reply: reply.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Bid accepted!", variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Error", description: data.error ?? "Failed to accept", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleRejectBid = async (bidId: string) => {
    try {
      const res = await fetch("/api/bid/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId, userId }),
      });
      if (res.ok) {
        toast({ title: "Bid rejected", variant: "success" });
        router.refresh();
      }
    } catch (err) {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default"|"success"|"destructive"|"gold"> = {
      pending: "gold", accepted: "success", rejected: "destructive", refunded: "default",
    };
    return <Badge variant={variants[status] ?? "default"}>{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-arc-bg-0">
      {provisioning ? (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center mx-auto mb-4 animate-pulse">
              <span className="font-display font-bold text-xl">A</span>
            </div>
            <h2 className="text-xl font-display font-bold mb-2">Setting up your wallet</h2>
            <p className="text-sm text-text-secondary">Provisioning a Circle wallet on Arc Testnet...</p>
          </div>
        </div>
      ) : (
      <>
      {/* Top Bar */}
      <header className="border-b border-border bg-arc-bg-1/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center text-xs font-display font-bold">A</div>
            <span className="font-display font-bold text-lg">attnn.</span>
          </div>
          <div className="flex items-center gap-4">
            {wallet && (
              <div className="relative">
                <button
                  onClick={() => { setWalletOpen(!walletOpen); fetchBalance(); }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-arc-bg-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Wallet className="w-3 h-3" />
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                </button>
                {walletOpen && (
                  <div className="absolute right-0 top-9 w-64 rounded-lg border border-border bg-arc-bg-1 shadow-xl z-50 p-4">
                    <div className="text-xs text-text-secondary mb-1 uppercase tracking-wider">USDC Balance</div>
                    <div className="text-xl font-display font-bold text-arc-gold mb-3">
                      {balanceLoading ? "..." : walletBalance !== null ? `$${parseFloat(walletBalance).toFixed(2)}` : "—"}
                    </div>
                    <div className="text-xs text-text-dim font-mono break-all mb-3">{wallet.address}</div>
                    <button
                      onClick={() => { copyAddress(); setWalletOpen(false); }}
                      className="w-full text-xs py-1.5 rounded border border-border text-text-secondary hover:text-text-primary transition-colors mb-2"
                    >
                      Copy Address
                    </button>
                    <button
                      onClick={() => setShowSend(!showSend)}
                      className="w-full text-xs py-1.5 rounded border border-arc-gold/40 text-arc-gold hover:bg-arc-gold/10 transition-colors"
                    >
                      {showSend ? "Cancel" : "Send USDC"}
                    </button>
                    {showSend && (
                      <div className="mt-3 space-y-2">
                        <input
                          type="text"
                          placeholder="Recipient address (0x...)"
                          value={sendTo}
                          onChange={e => setSendTo(e.target.value)}
                          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-arc-bg-2 text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold"
                        />
                        <input
                          type="number"
                          placeholder="Amount (USDC)"
                          value={sendAmount}
                          onChange={e => setSendAmount(e.target.value)}
                          min="0.01"
                          step="0.01"
                          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-arc-bg-2 text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold"
                        />
                        <button
                          disabled={sendLoading || !sendTo || !sendAmount}
                          onClick={async () => {
                            setSendLoading(true);
                            try {
                              const res = await fetch("/api/wallet/send", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ to: sendTo, amount: sendAmount }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                toast({ title: "Sent!", description: `${sendAmount} USDC sent`, variant: "success" });
                                setSendTo(""); setSendAmount(""); setShowSend(false); setWalletOpen(false);
                                setWalletBalance(null);
                              } else {
                                toast({ title: "Failed", description: data.error ?? "Send failed", variant: "destructive" });
                              }
                            } catch { toast({ title: "Error", variant: "destructive" }); }
                            finally { setSendLoading(false); }
                          }}
                          className="w-full text-xs py-1.5 rounded bg-arc-gold text-arc-bg-0 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {sendLoading ? "Sending..." : "Confirm Send"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <Badge variant="gold" className="text-xs">{userRole}</Badge>
            <form action="/api/auth/signout" method="POST">
              <Button variant="ghost" size="sm" type="submit"><LogOut className="w-4 h-4" /></Button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-8">
          <TabsList>
            <TabsTrigger value="creator" className="flex items-center gap-2"><Users className="w-4 h-4" /> Creator</TabsTrigger>
            <TabsTrigger value="bidder" className="flex items-center gap-2"><Bot className="w-4 h-4" /> Bidder</TabsTrigger>
            <TabsTrigger value="activity" className="flex items-center gap-2"><Activity className="w-4 h-4" /> Activity</TabsTrigger>
          </TabsList>

          {/* Creator Tab */}
          <TabsContent value="creator" className="space-y-6 mt-6">
            {(!profile || editingProfile) && (
              wallet && !profile && !editingProfile && !walletFunded && typeof window !== "undefined" && !localStorage.getItem("attnn:funded:" + wallet.address) ? (
                <FundWalletCard
                  address={wallet.address}
                  onFunded={() => {
                    localStorage.setItem("attnn:funded:" + wallet.address, "1");
                    setWalletFunded(true);
                  }}
                />
              ) : (
                <CreatorSetupForm
                  existingProfile={profile}
                  onComplete={() => { setEditingProfile(false); router.refresh(); }}
                  onCancel={profile ? () => setEditingProfile(false) : undefined}
                />
              )
            )}

            {profile && (
              <>
                {/* Stats Row */}
                <div className="grid md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">Total Earnings</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-2xl font-display font-bold text-green">
                        {formatAmount(bids.filter(b => b.status === "accepted" && b.creatorUserId === userId).reduce((sum, b) => sum + BigInt(b.amountUsdc || "0"), BigInt(0)).toString())}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">Pending Bids</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-2xl font-display font-bold text-arc-gold">{bids.filter(b => b.status === "pending" && b.creatorUserId === userId).length}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">Response Rate</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-2xl font-display font-bold text-arc-lavender">
                        {bids.filter(b => b.creatorUserId === userId).length > 0
                          ? Math.round(bids.filter(b => b.creatorUserId === userId && (b.status === "accepted" || b.status === "rejected")).length / bids.filter(b => b.creatorUserId === userId).length * 100) + "%"
                          : "—"}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Profile info + edit */}
                <Card className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display font-bold">@{profile.handle}</h3>
                      <p className="text-xs text-text-secondary mt-1">
                        Min bid: {formatAmount(profile.minBid)} &middot; Tags: {profile.tags.join(", ") || "none"}
                        {profile.bio && <> &middot; Bio: {profile.bio}</>}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
                      Edit Profile
                    </Button>
                  </div>
                </Card>

                {/* Auto-accept threshold */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-display font-bold">Auto-Accept Threshold</h3>
                      <p className="text-xs text-text-secondary">Bids scored above this will be automatically accepted</p>
                    </div>
                    <span className="text-2xl font-display font-bold text-arc-gold">{autoAcceptThreshold}</span>
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
                </Card>

                {/* Inbox */}
                <div>
                  <h2 className="text-xl font-display font-bold mb-4 flex items-center gap-2">
                    <MessageCircle className="w-5 h-5 text-arc-gold" /> Inbox
                    <span className="text-xs text-text-secondary font-normal">(AI-scored by bid amount)</span>
                  </h2>
                  <div className="space-y-3">
                    {bids.filter(b => b.creatorUserId === userId).map((bid) => (
                      <Card key={bid.id} className="p-4 flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-display font-bold">{formatAmount(bid.amountUsdc)}</span>
                            {statusBadge(bid.status)}
                            {bid.score != null && <Badge variant="default">Score: {bid.score}/10</Badge>}
                          </div>
                          {bid.message && <p className="text-sm text-text-secondary">{bid.message}</p>}
                          <p className="text-xs text-text-dim mt-1">From: {bid.bidderAddress.slice(0, 6)}...{bid.bidderAddress.slice(-4)}</p>
                        </div>
                        {bid.status === "pending" && (
                          <div className="flex gap-2 ml-4">
                            <Button size="sm" variant="default" onClick={() => handleAcceptBid(bid.id)}><Check className="w-4 h-4" /></Button>
                            <Button size="sm" variant="destructive" onClick={() => handleRejectBid(bid.id)}><X className="w-4 h-4" /></Button>
                          </div>
                        )}
                      </Card>
                    ))}
                    {bids.filter(b => b.creatorUserId === userId).length === 0 && (
                      <p className="text-sm text-text-dim text-center py-8">No bids yet. Share your handle: <code className="text-arc-gold">attn.xyz/c/{profile.handle}</code></p>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Bidder Tab */}
          <TabsContent value="bidder" className="space-y-6 mt-6">
            {(!bidderConfig || editingBidder) && (
              <BidderSetupForm userId={userId} onComplete={() => { setEditingBidder(false); router.refresh(); }} />
            )}

            {bidderConfig && (
              <>
                <div className="grid md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">Agent Status</CardTitle></CardHeader>
                    <CardContent>
                      <Badge variant={bidderConfig.isActive ? "success" : "default"} className="text-sm px-3 py-1">
                        {bidderConfig.isActive ? "Active" : "Paused"}
                      </Badge>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">Daily Spend</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-2xl font-display font-bold">{formatAmount(bidderConfig.dailyBudget)} <span className="text-xs text-text-secondary font-normal">/ day</span></div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">Bids Placed</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-2xl font-display font-bold text-arc-gold">{bids.filter(b => b.bidderUserId === userId).length}</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Agent Controls */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-display font-bold">Agent Controls</h3>
                      <p className="text-xs text-text-secondary mt-1">Goal: {bidderConfig.goal ?? "Not set"}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant={bidderConfig.isActive ? "destructive" : "default"} size="sm" onClick={async () => {
                        await fetch("/api/profile/update", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ userId, bidderActive: !bidderConfig.isActive }),
                        });
                        router.refresh();
                      }}>
                        {bidderConfig.isActive ? <><Square className="w-4 h-4 mr-1" /> Pause</> : <><Play className="w-4 h-4 mr-1" /> Activate</>}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditingBidder(true)}>
                        Edit Agent
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleRunAgent} disabled={agentRunning}>
                        <Zap className="w-4 h-4 mr-1" /> {agentRunning ? "Running..." : "Run Now"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Daily Budget (USDC)</label>
                      <Input value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Min Fit Score</label>
                      <Input type="number" value={minFitScore} onChange={e => setMinFitScore(Number(e.target.value))} min={0} max={10} />
                    </div>
                  </div>
                </Card>

                {/* Bid History */}
                <div>
                  <h2 className="text-xl font-display font-bold mb-4">Bid History</h2>
                  <div className="space-y-2">
                    {bids.filter(b => b.bidderUserId === userId).map((bid) => (
                      <Card key={bid.id} className="p-3 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3">
                          {statusBadge(bid.status)}
                          <span className="font-bold">{formatAmount(bid.amountUsdc)}</span>
                          <span className="text-text-secondary">→ {bid.creatorAddress.slice(0, 6)}...</span>
                        </div>
                        {bid.reply && <p className="text-text-dim text-xs max-w-xs truncate">Reply: {bid.reply}</p>}
                      </Card>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-4 mt-6">
            <h2 className="text-xl font-display font-bold mb-4">Agent Activity Feed</h2>
            <div className="space-y-2">
              {logs.map((log) => (
                <Card key={log.id} className="p-3 flex items-center gap-3 text-sm">
                  <Activity className="w-4 h-4 text-arc-purple shrink-0" />
                  <div className="flex-1">
                    <span className="font-medium capitalize">{log.action.replace(/_/g, " ")}</span>
                    {log.data && Object.keys(log.data).length > 0 && (
                      <span className="text-text-dim ml-2 text-xs">{formatLogData(log.action, log.data)}</span>
                    )}
                  </div>
                  <span className="text-xs text-text-dim">{new Date(log.createdAt).toLocaleString()}</span>
                </Card>
              ))}
              {logs.length === 0 && <p className="text-text-dim text-center py-8">No activity yet</p>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
      </>
      )}
    </div>
  );
}

// ─── Creator Setup / Edit Form ──────────────────────────────────

function CreatorSetupForm({
  existingProfile,
  onComplete,
  onCancel,
}: {
  existingProfile: ProfileData | null;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const isEdit = !!existingProfile;
  const [handle, setHandle] = useState(existingProfile?.handle ?? "");
  const [minBid, setMinBid] = useState(
    existingProfile ? (Number(BigInt(existingProfile.minBid || "0")) / 1_000_000).toString() : "5",
  );
  const [tags, setTags] = useState(existingProfile?.tags?.join(", ") ?? "");
  const [bio, setBio] = useState(existingProfile?.bio ?? "");
  const [autoReplyTemplate, setAutoReplyTemplate] = useState(existingProfile?.autoReplyTemplate ?? "Thanks for reaching out! I've reviewed your bid and I'm happy to connect. Looking forward to hearing more — reach out on WhatsApp: +2319023XXXXXXX");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const minBidRaw = (parseFloat(minBid) * 1_000_000).toString();
      const tagsArr = tags.split(",").map(t => t.trim()).filter(Boolean);

      if (isEdit) {
        // Update via profile/update (no on‑chain re‑registration needed)
        const res = await fetch("/api/profile/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle, minBid: minBidRaw, tags: tagsArr, bio: bio || null, autoReplyTemplate: autoReplyTemplate || null }),
        });
        const data = await res.json();
        if (data.success) {
          toast({ title: "Profile updated!", variant: "success" });
          onComplete();
        } else {
          setError(data.error ?? "Failed to update profile");
        }
      } else {
        // Create + activate on‑chain
        const res = await fetch("/api/profile/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle, minBid: minBidRaw, tags: tagsArr, bio: bio || null, autoReplyTemplate: autoReplyTemplate || null }),
        });
        const data = await res.json();
        if (data.success) {
          const activateRes = await fetch("/api/profile/activate", { method: "POST" });
          const activateData = await activateRes.json();
          if (activateData.success) {
            toast({ title: "Creator profile created!", description: "Registered on-chain", variant: "success" });
            onComplete();
          } else {
            setError("Profile saved but on-chain registration failed: " + (activateData.error ?? "Unknown error"));
          }
        } else {
          setError(data.error ?? "Failed to create profile");
        }
      }
    } catch (err) {
      setError("Something went wrong");
    }
    setLoading(false);
  };

  return (
    <Card className="p-8">
      <h3 className="font-display font-bold text-lg mb-2">
        {isEdit ? "Edit Creator Profile" : "Create Creator Profile"}
      </h3>
      <p className="text-sm text-text-secondary mb-6">
        {isEdit
          ? "Update your profile details. Changes are reflected immediately."
          : "Set up your profile to start receiving bids on your attention."}
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Handle</label>
          <Input
            placeholder="your-handle"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Min Bid (USDC)</label>
          <Input
            type="number"
            step="0.01"
            min="5"
            max="1000"
            placeholder="5"
            value={minBid}
            onChange={e => setMinBid(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Tags (comma-separated)</label>
          <Input
            placeholder="ai, crypto, design"
            value={tags}
            onChange={e => setTags(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Bio</label>
          <Input
            placeholder="Tell the world what you do"
            value={bio}
            onChange={e => setBio(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Auto-Reply Template</label>
          <textarea
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold resize-none"
            rows={3}
            placeholder="Message sent automatically when a bid is auto-accepted..."
            value={autoReplyTemplate}
            onChange={e => setAutoReplyTemplate(e.target.value)}
          />
          <p className="text-xs text-text-dim mt-1">This message is sent on your behalf when a bid scores above your auto-accept threshold.</p>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3">
          {onCancel && (
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" className={onCancel ? "flex-1" : "w-full"} disabled={loading}>
            {loading ? "Saving..." : isEdit ? "Save Changes" : "Create & Register on-chain"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Bidder Setup Form (shown when no bidder config exists) ──────────────────

function BidderSetupForm({ userId: _userId, onComplete }: { userId: string; onComplete: () => void }) {
  const [goal, setGoal] = useState("");
  const [dailyBudget, setDailyBudget] = useState("50");
  const [searchTags, setSearchTags] = useState("");
  const [minFitScore, setMinFitScore] = useState("5");
  const [defaultMessage, setDefaultMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/bidder-config/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal || null,
          dailyBudget: (parseFloat(dailyBudget) * 1_000_000).toString(),
          searchTags: searchTags.split(",").map(t => t.trim()).filter(Boolean),
          minFitScore: parseInt(minFitScore),
          defaultMessage: defaultMessage || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Bidder agent configured!", variant: "success" });
        onComplete();
      } else {
        setError(data.error ?? "Failed to configure agent");
      }
    } catch (err) {
      setError("Something went wrong");
    }
    setLoading(false);
  };

  return (
    <Card className="p-8">
      <h3 className="font-display font-bold text-lg mb-2">Configure Bidder Agent</h3>
      <p className="text-sm text-text-secondary mb-6">Set your budget and criteria for discovering creators.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Goal (what are you looking for?)</label>
          <Input
            placeholder="e.g. finding crypto alpha, design inspiration"
            value={goal}
            onChange={e => setGoal(e.target.value)}
          />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-text-secondary mb-1 block">Daily Budget (USDC)</label>
            <Input
              type="number"
              step="0.01"
              min="5"
              placeholder="50"
              value={dailyBudget}
              onChange={e => setDailyBudget(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm text-text-secondary mb-1 block">Min Fit Score (0-10)</label>
            <Input
              type="number"
              min="0"
              max="10"
              step="1"
              placeholder="5"
              value={minFitScore}
              onChange={e => setMinFitScore(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Search Tags (comma-separated)</label>
          <Input
            placeholder="ai, crypto, defi"
            value={searchTags}
            onChange={e => setSearchTags(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Default Bid Message</label>
          <Input
            placeholder="Hi! I'd love your take on..."
            value={defaultMessage}
            onChange={e => setDefaultMessage(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Saving..." : "Save Configuration"}
        </Button>
      </form>
    </Card>
  );
}
