"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FundWalletCard } from "./fund-wallet-card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { LogOut, Wallet, Play, Square, MessageCircle, Check, X, Activity, Zap, Bot, Users, Coins } from "lucide-react";

interface WalletData { id: string; address: string; circleWalletId: string; blockchain: string; state: string; }
interface ProfileData { id: string; handle: string; minBid: string; tags: string[]; bio: string | null; autoAcceptThreshold: number | null; autoReplyTemplate: string | null; isActive: boolean; availabilityStatus: string; openTo: string[]; }
interface BidderConfigData { id: string; goal: string | null; dailyBudget: string; maxBidPerCreator: string; minFitScore: number; searchTags: string[]; defaultMessage: string | null; isActive: boolean; agentName: string | null; }
interface BidData { id: string; onChainBidId: string | null; bidderUserId: string; creatorUserId: string; bidderAddress: string; creatorAddress: string; amountUsdc: string; message: string | null; status: string; score: number | null; reply: string | null; bidTxHash: string | null; settlementTxHash: string | null; createdAt: string; settledAt: string | null; counterOfferAmount: string | null; onChainTxHash: string | null; settlementOnChainTxHash: string | null; agentName: string | null; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent_logs.data is untyped jsonb whose shape varies by action
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
  const [dailyBudget, setDailyBudget] = useState(bidderConfig?.dailyBudget ? (Number(BigInt(bidderConfig.dailyBudget)) / 1_000_000).toString() : "50");
  const [minFitScore, setMinFitScore] = useState(bidderConfig?.minFitScore ?? 5);
  const [agentRunning, setAgentRunning] = useState(false);
  const [provisioning, setProvisioning] = useState(!wallet);
  const [editingProfile, setEditingProfile] = useState(false);
  const [walletFunded, setWalletFunded] = useState(false);
  const [editingBidder, setEditingBidder] = useState(false);
  const [autoAcceptThreshold, setAutoAcceptThreshold] = useState(profile?.autoAcceptThreshold ?? 0);

  // Calculate actual daily spend using UTC to match blockchain timestamps
  const dailySpend = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (!bids || !userId) return 0;
    return bids
      .filter(b => b.bidderUserId === userId && new Date(b.createdAt) >= today)
      .reduce((sum, b) => {
        const raw = b.amountUsdc || "0";
        const amount = typeof raw === 'string' && raw.includes('.') ? parseFloat(raw) * 1_000_000 : Number(raw);
        return sum + (amount / 1_000_000);
      }, 0);
  }, [bids, userId]);

  const isBudgetExceeded = bidderConfig ? dailySpend >= Number(BigInt(bidderConfig.dailyBudget || "0")) / 1_000_000 : false;
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [localBids, setLocalBids] = useState(bids);
  const [activityFilter, setActivityFilter] = useState("all");
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
      } catch {
        if (!cancelled) {
          toast({ title: "Wallet provisioning error", variant: "destructive" });
          setProvisioning(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // run once on mount

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent_logs.data is untyped jsonb whose shape varies by action
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
    } catch {
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
        setLocalBids(prev => prev.map(b => b.id === bidId ? { ...b, status: "accepted" } : b));
        router.refresh();
      } else {
        toast({ title: "Error", description: data.error ?? "Failed to accept", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const [counterBidId, setCounterBidId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterLoading, setCounterLoading] = useState(false);

  const handleCounterOffer = async () => {
    if (!counterBidId || !counterAmount) return;
    const amountUsdc = Math.round(parseFloat(counterAmount) * 1_000_000);
    if (isNaN(amountUsdc) || amountUsdc < 5_000_000) {
      toast({ title: "Minimum counter offer is $5 USDC", variant: "destructive" });
      return;
    }
    setCounterLoading(true);
    try {
      const res = await fetch("/api/bid/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId: counterBidId, counterOfferAmount: amountUsdc }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Counter offer sent! The bidder agent will evaluate it.", variant: "success" });
        setLocalBids(prev => prev.map(b => b.id === counterBidId ? { ...b, status: "counter_offered" } : b));
        setCounterBidId(null);
        setCounterAmount("");
      } else {
        toast({ title: data.error ?? "Failed to send counter offer", variant: "destructive" });
      }
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setCounterLoading(false);
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
        setLocalBids(prev => prev.map(b => b.id === bidId ? { ...b, status: "rejected" } : b));
        router.refresh();
      }
    } catch {
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
            <img src="/attnn-logo.jpeg" alt="Attnn." className="w-8 h-8 rounded-lg object-cover" />
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
            <Button variant="ghost" size="sm" onClick={async () => {
              await fetch("/api/auth/signout", { method: "POST" });
              window.location.href = "/";
            }}><LogOut className="w-4 h-4" /></Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-8 pb-24 md:pb-8">
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4 md:mb-8">
          <div className="flex gap-6">
            <TabsList className="hidden md:flex flex-col h-auto w-44 shrink-0 gap-1 bg-arc-bg-2 p-2 rounded-xl self-start sticky top-24">
              <TabsTrigger value="creator" className="w-full justify-start flex items-center gap-2 px-3 py-2.5 text-sm">
                <Users className="w-4 h-4" /> Creator
              </TabsTrigger>
              <TabsTrigger value="offers" className="w-full justify-start flex items-center gap-2 px-3 py-2.5 text-sm">
                <MessageCircle className="w-4 h-4" /> Offers
                {localBids.filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered")).length > 0 && (
                  <span className="ml-auto bg-arc-gold text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {localBids.filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered")).length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="bidder" className="w-full justify-start flex items-center gap-2 px-3 py-2.5 text-sm">
                <Bot className="w-4 h-4" /> Bidder
              </TabsTrigger>
              <TabsTrigger value="bids" className="w-full justify-start flex items-center gap-2 px-3 py-2.5 text-sm">
                <Coins className="w-4 h-4" /> Bids
              </TabsTrigger>
              <TabsTrigger value="activity" className="w-full justify-start flex items-center gap-2 px-3 py-2.5 text-sm">
                <Activity className="w-4 h-4" /> Activity
              </TabsTrigger>
            </TabsList>
            <div className="flex-1 min-w-0">

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
                    <div className="flex gap-2">
                      {!profile.isActive && (
                        <Button variant="default" size="sm" onClick={async () => {
                          try {
                            const res = await fetch("/api/profile/activate", { method: "POST" });
                            const data = await res.json();
                            if (data.success) {
                              toast({ title: "Activated on Arc!", variant: "success" });
                              router.refresh();
                            } else {
                              toast({ title: "Activation failed", description: data.error ?? "Try again", variant: "destructive" });
                            }
                          } catch {
                            toast({ title: "Error", variant: "destructive" });
                          }
                        }}>
                          Activate on Arc
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
                        Edit Profile
                      </Button>
                    </div>
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

              </>
            )}
          </TabsContent>

          {/* Offers Tab */}
          <TabsContent value="offers" className="space-y-4 mt-6">
            <div>
              <h2 className="text-xl font-display font-bold mb-1">Offers</h2>
              <p className="text-xs text-text-secondary mb-6">Bids waiting for your response. Accept, reject or counter.</p>
              <div className="space-y-3">
                {localBids.filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered")).sort((a, b) => Number(BigInt(b.amountUsdc) - BigInt(a.amountUsdc))).map((bid) => (
                  <Card key={bid.id} className="p-4 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-display font-bold">{formatAmount(bid.amountUsdc)}</span>
                        {statusBadge(bid.status)}
                        {bid.score != null && <Badge variant="default">Score: {bid.score}/10</Badge>}
                      </div>
                      {bid.message && <p className="text-sm text-text-secondary">{bid.message}</p>}
                      <p className="text-xs text-text-dim mt-1">
                        {bid.agentName ? (
                          <span>🤖 <span className="text-white font-medium">{bid.agentName}</span> · {bid.bidderAddress.slice(0, 6)}...{bid.bidderAddress.slice(-4)}</span>
                        ) : (
                          <span>From: {bid.bidderAddress.slice(0, 6)}...{bid.bidderAddress.slice(-4)}</span>
                        )}
                      </p>
                      <p className="text-xs text-text-dim mt-0.5">{new Date(bid.createdAt).toLocaleString()}{bid.settledAt && <span className="ml-2 text-text-dim">· Settled: {new Date(bid.settledAt).toLocaleString()}</span>}</p>
                      {bid.status === "counter_offered" && bid.counterOfferAmount && (
                        <p className="text-xs text-arc-gold mt-1">Counter sent: {formatAmount(bid.counterOfferAmount)} — Agent evaluating...</p>
                      )}
                    </div>
                    {bid.status === "pending" && (
                      <div className="flex gap-2 ml-4">
                        <Button size="sm" variant="default" onClick={() => handleAcceptBid(bid.id)}><Check className="w-4 h-4" /></Button>
                        <Button size="sm" variant="destructive" onClick={() => handleRejectBid(bid.id)}><X className="w-4 h-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => { setCounterBidId(bid.id); setCounterAmount(""); }} className="text-arc-gold border-arc-gold hover:bg-arc-gold hover:text-black">↕</Button>
                      </div>
                    )}
                    {bid.status === "counter_offered" && (
                      <div className="ml-4">
                        <Badge variant="outline" className="text-arc-gold border-arc-gold">Counter sent</Badge>
                      </div>
                    )}
                  </Card>
                ))}
                {localBids.filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered")).length === 0 && (
                  <p className="text-sm text-text-dim text-center py-12">No pending offers. Share your profile: <code className="text-arc-gold">attnn.xyz/c/{profile?.handle}</code></p>
                )}
              </div>
            </div>

            {/* Counter Offer Modal */}
            {counterBidId && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm mx-4">
                  <h3 className="text-lg font-display font-bold mb-2">Send Counter Offer</h3>
                  <p className="text-sm text-text-secondary mb-4">Enter the amount you want to receive in USDC. The bidder agent will evaluate your counter offer automatically.</p>
                  <div className="mb-4">
                    <label className="text-xs text-text-secondary mb-1 block">Counter offer amount (USDC)</label>
                    <input
                      type="number"
                      min="5"
                      step="1"
                      placeholder="e.g. 10"
                      value={counterAmount}
                      onChange={e => setCounterAmount(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-arc-gold"
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => { setCounterBidId(null); setCounterAmount(""); }}>Cancel</Button>
                    <Button variant="default" className="flex-1 bg-arc-gold text-black hover:bg-arc-gold/90" onClick={handleCounterOffer} disabled={counterLoading}>
                      {counterLoading ? "Sending..." : "Send Counter"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Bids Tab */}
          <TabsContent value="bids" className="space-y-4 mt-6">
            <div>
              <h2 className="text-xl font-display font-bold mb-1">Bids</h2>
              <p className="text-xs text-text-secondary mb-6">All bids placed by your agent and manually.</p>
              <div className="space-y-2">
                {localBids.filter(b => b.bidderUserId === userId).map((bid) => (
                  <Card key={bid.id} className="p-3 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      {statusBadge(bid.status)}
                      <span className="font-bold">{formatAmount(bid.amountUsdc)}</span>
                      <span className="text-text-secondary">→ {bid.creatorAddress.slice(0, 6)}...</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-text-dim text-xs">{bid.settledAt ? new Date(bid.settledAt).toLocaleString() : new Date(bid.createdAt).toLocaleString()}</span>
                      {bid.reply && <p className="text-text-dim text-xs max-w-xs truncate">Reply: {bid.reply}</p>}
                      {bid.status === "counter_offered" && bid.counterOfferAmount && (
                        <div className="text-xs text-arc-gold font-medium">
                          Counter: {formatAmount(bid.counterOfferAmount)} — Agent evaluating...
                        </div>
                      )}
                      {bid.onChainTxHash && (
                        <a href={`https://testnet.arcscan.app/tx/${bid.onChainTxHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-arc-purple hover:underline">
                          Bid ↗
                        </a>
                      )}
                      {bid.settlementOnChainTxHash && (
                        <a href={`https://testnet.arcscan.app/tx/${bid.settlementOnChainTxHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-arc-purple hover:underline">
                          Settlement ↗
                        </a>
                      )}
                    </div>
                  </Card>
                ))}
                {localBids.filter(b => b.bidderUserId === userId).length === 0 && (
                  <p className="text-sm text-text-dim text-center py-12">No bids placed yet. Activate your agent to start bidding.</p>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Bidder Tab */}
          <TabsContent value="bidder" className="space-y-6 mt-6">
            {(!bidderConfig || editingBidder) && (
              <BidderSetupForm userId={userId} existingConfig={bidderConfig} onComplete={() => { setEditingBidder(false); router.refresh(); }} />
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
                      <div className="text-2xl font-display font-bold">${dailySpend.toFixed(2)} <span className="text-xs text-text-secondary font-normal">/ {formatAmount(bidderConfig.dailyBudget)} budget</span></div>
                      {isBudgetExceeded && <div className="text-xs text-red-400 mt-1">Daily limit reached.</div>}
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
              </>
            )}
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-4 mt-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-xl font-display font-bold">Agent Activity</h2>
                <p className="text-xs text-text-secondary mt-0.5">Real-time updates from your agent discovery and bidding activity.</p>
              </div>
              {bidderConfig?.isActive && (
                <div className="flex items-center gap-1.5 text-xs text-green">
                  <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
                  Agent Live
                </div>
              )}
            </div>

            {/* Summary Cards */}
            {(() => {
              const creatorsFound = Math.max(...logs.filter(l => l.action === "creator_discovered").map(l => l.data?.count ?? 0), 0);
              const bidsPlaced = logs.filter(l => l.action === "bid_placed").length;
              const accepted = localBids.filter(b => (b.bidderUserId === userId || b.creatorUserId === userId) && b.status === "accepted").length;
              const totalBidValue = localBids.filter(b => b.bidderUserId === userId).reduce((sum, b) => sum + Number(BigInt(b.amountUsdc || "0")) / 1_000_000, 0);
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: "Creators Found", value: creatorsFound, color: "text-arc-purple" },
                    { label: "Agent Bids", value: bidsPlaced, color: "text-arc-gold" },
                    { label: "Accepted", value: accepted, color: "text-green" },
                    { label: "Total Bid Value", value: `$${totalBidValue.toFixed(2)}`, color: "text-arc-coral" },
                  ].map(({ label, value, color }) => (
                    <Card key={label} className="p-3 text-center">
                      <div className={`text-xl font-display font-bold ${color}`}>{value}</div>
                      <div className="text-xs text-text-secondary mt-0.5">{label}</div>
                    </Card>
                  ))}
                </div>
              );
            })()}

            {/* Filter Tabs */}
            <div className="flex gap-2 mb-3">
              {["all", "creators", "bids", "accepted"].map(f => (
                <button
                  key={f}
                  onClick={() => setActivityFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${activityFilter === f ? "bg-arc-gold text-arc-bg-0" : "border border-border text-text-secondary hover:text-text-primary"}`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {/* Activity Feed — Conversational */}
            <div className="space-y-0 divide-y divide-border">
              {(activityFilter === "accepted"
                ? localBids.filter(b => (b.bidderUserId === userId || b.creatorUserId === userId) && b.status === "accepted").map(b => ({
                    id: b.id,
                    action: "bid_accepted",
                    data: { creator: b.creatorAddress.slice(0,6) + "..." + b.creatorAddress.slice(-4), amount: b.amountUsdc, reply: b.reply },
                    createdAt: b.settledAt ?? b.createdAt,
                  }))
                : logs.filter(log => {
                    if (activityFilter === "creators") return log.action === "creator_discovered";
                    if (activityFilter === "bids") return log.action === "bid_placed";
                    return true;
                  })
              ).map((log) => {
                const iconMap: Record<string, string> = {
                  creator_discovered: "🔎",
                  creator_scored: "🧠",
                  bid_placed: "💰",
                  bid_accepted: "✅",
                  bid_rejected: "❌",
                  auto_accept: "✅",
                  counter_received: "↩️",
                  webhook_received: "📡",
                  agent_started: "▶️",
                  agent_stopped: "⏸️",
                  refund_claimed: "💸",
                  error: "⚠️",
                };
                const icon = iconMap[log.action] ?? "📋";

                const buildMessage = (action: string, data: any): string => {
                  const agentName = data?.agentName ?? "Your agent";
                  switch (action) {
                    case "creator_discovered":
                      return `${agentName} discovered ${data?.count ?? 0} creator${data?.count !== 1 ? "s" : ""}${data?.scored ? `, scored ${data.scored}` : ""}${data?.bidsPlaced ? `, placed ${data.bidsPlaced} bid${data.bidsPlaced !== 1 ? "s" : ""}` : ""}.`;
                    case "bid_placed":
                      return `${agentName} placed ${data?.amount ? formatAmount(data.amount) : ""} bid${data?.creator ? ` on @${data.creator}` : ""}${data?.score !== undefined ? ` · fit score ${data.score}/10` : ""}.`;
                    case "bid_accepted":
                      return `Bid accepted${data?.creator ? ` by @${data.creator}` : ""}${data?.amount ? ` · ${formatAmount(data.amount)}` : ""}.`;
                    case "bid_rejected":
                      return `Bid rejected${data?.creator ? ` by @${data.creator}` : ""}.`;
                    case "auto_accept":
                      return `Auto-accepted bid${data?.amount ? ` of ${formatAmount(data.amount)}` : ""}${data?.bidder ? ` from ${data.bidder}` : ""}.`;
                    case "agent_stopped":
                      return `${agentName} stopped · ${data?.reason ?? "unknown reason"}`;
                    case "agent_started":
                      return `${agentName} started.`;
                    case "refund_claimed":
                      return `Refund processed for bid ${data?.bidId ? data.bidId.slice(0,8) + "..." : ""}.`;
                    case "webhook_received":
                      return `On-chain event received · bid ID ${data?.bidId ?? "unknown"}.`;
                    case "error":
                      return `Error: ${data?.error ?? "unknown"}`;
                    default:
                      return formatLogData(action, data);
                  }
                };

                return (
                  <div key={log.id} className="flex gap-3 py-3 px-1">
                    <div className="text-base shrink-0 mt-0.5">{icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary leading-relaxed">{buildMessage(log.action, log.data)}</p>
                    </div>
                    <span className="text-xs text-text-dim shrink-0 mt-0.5">{new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                );
              })}
              {logs.length === 0 && <p className="text-text-dim text-center py-8">No activity yet. Run your agent to get started.</p>}
              {logs.length > 0 && activityFilter === "all" && <p className="text-xs text-text-dim text-center pt-2">Showing last {Math.min(logs.length, 50)} entries</p>}
            </div>
          </TabsContent>
            </div>
          </div>
        </Tabs>

        {/* Mobile Bottom Navigation */}
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-arc-bg-1 border-t border-border">
          <div className="flex items-center justify-around px-2 py-2">
            <button onClick={() => setActiveTab("creator")} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${activeTab === "creator" ? "text-arc-gold" : "text-text-dim"}`}>
              <Users className="w-5 h-5" />
              <span className="text-xs">Creator</span>
            </button>
            <button onClick={() => setActiveTab("offers")} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors relative ${activeTab === "offers" ? "text-arc-gold" : "text-text-dim"}`}>
              <MessageCircle className="w-5 h-5" />
              <span className="text-xs">Offers</span>
              {localBids.filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered")).length > 0 && (
                <span className="absolute top-0 right-1 bg-arc-gold text-black text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {localBids.filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered")).length}
                </span>
              )}
            </button>
            <button onClick={() => setActiveTab("bidder")} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${activeTab === "bidder" ? "text-arc-gold" : "text-text-dim"}`}>
              <Bot className="w-5 h-5" />
              <span className="text-xs">Bidder</span>
            </button>
            <button onClick={() => setActiveTab("bids")} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${activeTab === "bids" ? "text-arc-gold" : "text-text-dim"}`}>
              <Coins className="w-5 h-5" />
              <span className="text-xs">Bids</span>
            </button>
            <button onClick={() => setActiveTab("activity")} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${activeTab === "activity" ? "text-arc-gold" : "text-text-dim"}`}>
              <Activity className="w-5 h-5" />
              <span className="text-xs">Activity</span>
            </button>
          </div>
        </div>
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
  const [availabilityStatus, setAvailabilityStatus] = useState(existingProfile?.availabilityStatus ?? "available");
  const [openTo, setOpenTo] = useState(existingProfile?.openTo?.join(", ") ?? "");
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
          body: JSON.stringify({ handle, minBid: minBidRaw, tags: tagsArr, bio: bio || null, autoReplyTemplate: autoReplyTemplate || null, availabilityStatus, openTo: openTo.split(",").map((t: string) => t.trim()).filter(Boolean) }),
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
          body: JSON.stringify({ handle, minBid: minBidRaw, tags: tagsArr, bio: bio || null, autoReplyTemplate: autoReplyTemplate || null, availabilityStatus, openTo: openTo.split(",").map((t: string) => t.trim()).filter(Boolean) }),
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
    } catch {
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
          <label className="text-sm text-text-secondary mb-1 block">Availability Status</label>
          <select
            value={availabilityStatus}
            onChange={e => setAvailabilityStatus(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-arc-gold"
          >
            <option value="available">🟢 Available for new opportunities</option>
            <option value="limited">🟡 Limited availability</option>
            <option value="not_accepting">🔴 Not accepting offers</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Open To (comma-separated)</label>
          <Input
            placeholder="Partnerships, Developer work, Research, Speaking"
            value={openTo}
            onChange={e => setOpenTo(e.target.value)}
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

function BidderSetupForm({ userId: _userId, onComplete, existingConfig }: { userId: string; onComplete: () => void; existingConfig?: BidderConfigData | null }) {
  const [goal, setGoal] = useState(existingConfig?.goal ?? "");
  const [dailyBudget, setDailyBudget] = useState(existingConfig?.dailyBudget ? (Number(BigInt(existingConfig.dailyBudget)) / 1_000_000).toString() : "50");
  const [searchTags, setSearchTags] = useState(existingConfig?.searchTags?.join(", ") ?? "");
  const [minFitScore, setMinFitScore] = useState(existingConfig?.minFitScore != null ? existingConfig.minFitScore.toString() : "5");
  const [maxBidPerCreator, setMaxBidPerCreator] = useState(existingConfig?.maxBidPerCreator ? (Number(BigInt(existingConfig.maxBidPerCreator)) / 1_000_000).toString() : "20");
  const [agentName, setAgentName] = useState(existingConfig?.agentName ?? "");
  const [defaultMessage, setDefaultMessage] = useState(existingConfig?.defaultMessage ?? "");
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
          maxBidPerCreator: (parseFloat(maxBidPerCreator) * 1_000_000).toString(),
          agentName: agentName || null,
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
    } catch {
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
          <label className="text-sm text-text-secondary mb-1 block">Agent Name</label>
          <Input
            placeholder="e.g. Aqeelerh Scout"
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
          />
          <p className="text-xs text-text-dim mt-1">This is how creators will see your agent. e.g. &quot;Aqeelerh Scout operated by @aqeelerh&quot;</p>
        </div>
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
          <label className="text-sm text-text-secondary mb-1 block">Max Bid Per Creator (USDC)</label>
          <Input
            type="number"
            step="0.01"
            min="5"
            placeholder="20"
            value={maxBidPerCreator}
            onChange={e => setMaxBidPerCreator(e.target.value)}
            required
          />
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
