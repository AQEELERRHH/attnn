"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Bot, Coins, Inbox, LogOut } from "lucide-react";
import { SiteHeader } from "@/components/market/site-header";
import { Num } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { AgentConsole } from "./agent-console";
import { BidderView } from "./bidder-view";
import { CreatorView } from "./creator-view";
import { WalletDialog } from "./wallet-dialog";
import type { BidData, BidderConfigData, LogData, PortfolioSummary, ProfileData, WalletData } from "./types";

type View = "bidder" | "creator" | "agent";

/** Refresh interval while a bid is still confirming on Arc. */
const POLL_MS = 15_000;

export function DashboardClient({
  wallet,
  profile,
  bidderConfig,
  bids,
  summary,
  logs,
  userId,
  userRole,
  hasGooglePhoto,
  now,
  networkLabel,
}: {
  wallet: WalletData | null;
  profile: ProfileData | null;
  bidderConfig: BidderConfigData | null;
  bids: BidData[];
  summary: PortfolioSummary;
  logs: LogData[];
  userId: string;
  userRole: string;
  hasGooglePhoto: boolean;
  /** Server render time; every relative time uses it so server and browser agree. */
  now: number;
  networkLabel: string;
}) {
  const router = useRouter();
  const [provisioning, setProvisioning] = React.useState(!wallet);

  const placed = React.useMemo(() => bids.filter((b) => b.bidderUserId === userId), [bids, userId]);
  const received = React.useMemo(() => bids.filter((b) => b.creatorUserId === userId), [bids, userId]);
  const openPositions = placed.filter((b) => b.status === "placing" || b.status === "pending" || b.status === "counter_offered").length;
  const inboxCount = received.filter((b) => b.status === "pending" || b.status === "counter_offered").length;

  const [view, setView] = React.useState<View>(() =>
    inboxCount > 0 || (!profile && userRole === "creator") ? "creator" : "bidder",
  );

  // Auto-provision the Circle wallet on first visit.
  React.useEffect(() => {
    if (wallet) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wallet/provision", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.success) {
          toast({
            title: data.alreadyExisted ? "Wallet ready" : "Wallet created",
            description: shortAddress(data.wallet?.address),
            variant: "success",
          });
          router.refresh();
        } else {
          toast({ title: "Wallet provisioning failed", description: data.error ?? "Unknown error", variant: "destructive" });
        }
      } catch {
        if (!cancelled) toast({ title: "Wallet provisioning error", variant: "destructive" });
      } finally {
        if (!cancelled) setProvisioning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // While anything is confirming on Arc (placing, or a settlement in flight), refresh
  // so the row flips to its final status without a manual reload.
  const inFlight = bids.some((b) => b.status === "placing" || (!!b.settlementTxHash && (b.status === "pending" || b.status === "counter_offered")));
  React.useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [inFlight, router]);

  if (provisioning) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-arc-bg-0 px-4">
        <div className="text-center" role="status">
          <span aria-hidden className="mx-auto mb-4 flex h-12 w-12 animate-pulse items-center justify-center rounded-xl border-2 border-arc-gold">
            <span className="h-3 w-3 rounded-[3px] bg-arc-gold" />
          </span>
          <h1 className="mb-2 font-display text-xl font-bold">Setting up your wallet</h1>
          <p className="text-sm text-text-secondary">Creating a Circle wallet on {networkLabel}…</p>
        </div>
      </div>
    );
  }

  const views: { id: View; label: string; icon: React.ReactNode; count?: number; badge?: boolean }[] = [
    { id: "bidder", label: "Bidding", icon: <Coins aria-hidden className="hidden h-4 w-4 sm:block" />, count: openPositions },
    { id: "creator", label: "Creator", icon: <Inbox aria-hidden className="hidden h-4 w-4 sm:block" />, count: inboxCount, badge: inboxCount > 0 },
    { id: "agent", label: "Agent", icon: <Bot aria-hidden className="hidden h-4 w-4 sm:block" /> },
  ];

  return (
    <div className="min-h-screen bg-arc-bg-0">
      <SiteHeader
        networkLabel={networkLabel}
        actions={
          <>
            {wallet && <WalletDialog address={wallet.address} balanceUsdc={summary.walletUsdc} />}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-arc-bg-2 hover:text-text-primary"
            >
              <LogOut aria-hidden className="h-4 w-4" />
              <span className="sr-only">Sign out</span>
            </button>
          </>
        }
      />

      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Portfolio</h1>
            <p className="mt-1 text-text-secondary">Your bids, your market and your agents, settled in USDC on Arc.</p>
          </div>
          <div role="tablist" aria-label="Portfolio view" className="flex w-full rounded-xl border border-border bg-arc-bg-1 p-1 sm:w-auto">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                id={`tab-${v.id}`}
                aria-selected={view === v.id}
                aria-controls={`panel-${v.id}`}
                onClick={() => setView(v.id)}
                className={cn(
                  "focus-ring inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium sm:flex-none sm:gap-2 sm:px-4",
                  view === v.id ? "bg-arc-bg-3 text-text-primary" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {v.icon}
                {v.label}
                {v.count !== undefined && v.count > 0 && (
                  <Num
                    className={cn(
                      "rounded-full px-1.5 text-xs",
                      v.badge ? "bg-arc-gold font-bold text-arc-bg-0" : "bg-arc-bg-2 text-text-secondary",
                    )}
                  >
                    {v.count}
                  </Num>
                )}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
          {view === "bidder" && (
            <BidderView bids={placed} summary={summary} bidderConfig={bidderConfig} now={now} onOpenAgent={() => setView("agent")} />
          )}
          {view === "creator" && (
            <CreatorView profile={profile} wallet={wallet} bids={received} summary={summary} hasGooglePhoto={hasGooglePhoto} now={now} />
          )}
          {view === "agent" && <AgentConsole config={bidderConfig} bids={placed} logs={logs} summary={summary} now={now} />}
        </div>
      </main>
    </div>
  );
}
