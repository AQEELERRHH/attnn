"use client";

import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { CreatorPanel } from "@/components/dashboard/CreatorPanel";
import { OffersPanel } from "@/components/dashboard/OffersPanel";
import { AgentPanel } from "@/components/dashboard/AgentPanel";
import { BidsPanel } from "@/components/dashboard/BidsPanel";
import { ActivityPanel } from "@/components/dashboard/ActivityPanel";
import { Users, MessageCircle, Bot, Coins, Activity } from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WalletData { id: string; address: string; circleWalletId: string; blockchain: string; state: string; }
interface ProfileData { id: string; handle: string; minBid: string; tags: string[]; bio: string | null; autoAcceptThreshold: number | null; autoReplyTemplate: string | null; isActive: boolean; availabilityStatus: string; openTo: string[]; }
interface BidderConfigData { id: string; goal: string | null; dailyBudget: string; maxBidPerCreator: string; minFitScore: number; searchTags: string[]; defaultMessage: string | null; isActive: boolean; agentName: string | null; }
interface BidData { id: string; onChainBidId: string | null; bidderUserId: string; creatorUserId: string; bidderAddress: string; creatorAddress: string; amountUsdc: string; message: string | null; status: string; score: number | null; reply: string | null; bidTxHash: string | null; settlementTxHash: string | null; createdAt: string; settledAt: string | null; counterOfferAmount: string | null; onChainTxHash: string | null; settlementOnChainTxHash: string | null; agentName: string | null; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface LogData { id: string; action: string; data: any; txHash: string | null; createdAt: string; }

type Tab = "creator" | "offers" | "bidder" | "bids" | "activity";

// ─── Tab configuration ────────────────────────────────────────────────────────

interface TabConfig {
  id: Tab;
  label: string;
  icon: React.ElementType;
}

const TABS: TabConfig[] = [
  { id: "creator", label: "Creator", icon: Users },
  { id: "offers", label: "Offers", icon: MessageCircle },
  { id: "bidder", label: "My Agent", icon: Bot },
  { id: "bids", label: "Bids", icon: Coins },
  { id: "activity", label: "Activity", icon: Activity },
];

// ─── Wallet provisioning screen ───────────────────────────────────────────────

function ProvisioningScreen() {
  return (
    <div className="min-h-screen bg-arc-bg-0 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center mx-auto mb-4 animate-pulse">
          <span className="font-display font-bold text-xl">A</span>
        </div>
        <h2 className="text-xl font-display font-bold mb-2">Setting up your wallet</h2>
        <p className="text-sm text-text-secondary">Provisioning a Circle wallet on Arc Testnet…</p>
      </div>
    </div>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

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
  const [activeTab, setActiveTab] = useState<Tab>(profile?.isActive ? "bidder" : "creator");
  const [provisioning] = useState(!wallet);

  const pendingOfferCount = useMemo(
    () => bids.filter(b => b.creatorUserId === userId && (b.status === "pending" || b.status === "counter_offered")).length,
    [bids, userId]
  );

  if (provisioning) return <ProvisioningScreen />;

  return (
    <AppShell wallet={wallet} userRole={userRole} pendingOfferCount={pendingOfferCount}>
      {/* Inner layout: tab sidebar + content */}
      <div className="flex h-full">

        {/* Secondary tab sidebar — desktop */}
        <nav className="hidden md:flex flex-col w-48 shrink-0 border-r border-border bg-arc-bg-1/30 py-4 px-2 gap-0.5 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative text-left",
                activeTab === id
                  ? "bg-arc-bg-3 text-text-primary"
                  : "text-text-secondary hover:text-text-primary hover:bg-arc-bg-2/60"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
              {id === "offers" && pendingOfferCount > 0 && (
                <span className="ml-auto bg-arc-gold text-arc-bg-0 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {pendingOfferCount > 9 ? "9+" : pendingOfferCount}
                </span>
              )}
              {activeTab === id && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-arc-gold rounded-r-full" />
              )}
            </button>
          ))}
        </nav>

        {/* Mobile horizontal tab bar */}
        <div className="md:hidden w-full border-b border-border bg-arc-bg-1/40 sticky top-14 z-30 overflow-x-auto">
          <div className="flex items-center px-3 gap-1 min-w-max">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-3 text-sm font-medium whitespace-nowrap relative min-h-[44px] transition-colors",
                  activeTab === id
                    ? "text-text-primary border-b-2 border-arc-gold -mb-px"
                    : "text-text-secondary"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {id === "offers" && pendingOfferCount > 0 && (
                  <span className="bg-arc-gold text-arc-bg-0 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {pendingOfferCount > 9 ? "9+" : pendingOfferCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0 p-4 md:p-7">
          {activeTab === "creator" && (
            <CreatorPanel wallet={wallet} profile={profile} bids={bids} userId={userId} />
          )}
          {activeTab === "offers" && (
            <OffersPanel bids={bids} userId={userId} profileHandle={profile?.handle} />
          )}
          {activeTab === "bidder" && (
            <AgentPanel bidderConfig={bidderConfig} bids={bids} userId={userId} />
          )}
          {activeTab === "bids" && (
            <BidsPanel bids={bids} userId={userId} />
          )}
          {activeTab === "activity" && (
            <ActivityPanel logs={logs} bids={bids} userId={userId} bidderConfig={bidderConfig} />
          )}
        </div>
      </div>


    </AppShell>
  );
}
