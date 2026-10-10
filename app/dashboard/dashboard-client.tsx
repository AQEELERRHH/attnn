"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Bot, Coins, Inbox, LogOut } from "lucide-react";
import { SiteHeader } from "@/components/market/site-header";
import { Num } from "@/components/market";
import { BrandMark } from "@/components/market/brand-mark";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { AgentConsole } from "./agent-console";
import { BidderView } from "./bidder-view";
import { CreatorView } from "./creator-view";
import { WalletDialog } from "./wallet-dialog";
import { WelcomeDialog } from "./welcome-dialog";
import { GettingStarted } from "./getting-started";
import { HelpMenu } from "./help-menu";
import { onboardingRole, type ChecklistStep, type OnboardingRole } from "@/lib/onboarding";
import type { AgentPolicyInfo, BidData, BidderConfigData, LogData, PortfolioSummary, ProfileData, WalletData } from "./types";

type View = "bidder" | "creator" | "agent";

/** Refresh interval while a bid or registration is still confirming on Arc. */
const POLL_MS = 15_000;
/**
 * Stop auto-refreshing after this long. Confirmations take seconds; a row stuck for
 * longer is finished by the 10-minute sweep, and an open tab polling forever would
 * keep reading the database for nothing.
 */
const POLL_MAX_MS = 10 * 60_000;

export function DashboardClient({
  wallet,
  profile,
  bidderConfig,
  bids,
  summary,
  logs,
  userId,
  userRole,
  now,
  networkLabel,
  policy,
  onboarding,
}: {
  wallet: WalletData | null;
  profile: ProfileData | null;
  bidderConfig: BidderConfigData | null;
  bids: BidData[];
  summary: PortfolioSummary;
  logs: LogData[];
  userId: string;
  userRole: string;
  /** Server render time; every relative time uses it so server and browser agree. */
  now: number;
  networkLabel: string;
  policy: AgentPolicyInfo;
  onboarding: {
    showWelcome: boolean;
    checklistDismissed: boolean;
    checklist: { steps: ChecklistStep[]; done: number; total: number; complete: boolean };
    isTestnet: boolean;
  };
}) {
  const router = useRouter();
  const [provisioning, setProvisioning] = React.useState(!wallet);

  const placed = React.useMemo(() => bids.filter((b) => b.bidderUserId === userId), [bids, userId]);
  const received = React.useMemo(() => bids.filter((b) => b.creatorUserId === userId), [bids, userId]);
  const openPositions = placed.filter((b) => b.status === "placing" || b.status === "pending" || b.status === "counter_offered").length;
  const inboxCount = received.filter((b) => b.status === "pending" || b.status === "counter_offered").length;

  const [view, setView] = React.useState<View>(() =>
    inboxCount > 0 || userRole === "creator" ? "creator" : "bidder",
  );

  // First-run guide. The welcome shows until it's closed once (stored server-side);
  // Help reopens it. Dismissing the checklist is optimistic, then saved.
  const [welcomeOpen, setWelcomeOpen] = React.useState(onboarding.showWelcome);
  const [welcomeFirstVisit, setWelcomeFirstVisit] = React.useState(onboarding.showWelcome);
  const [checklistDismissed, setChecklistDismissed] = React.useState(onboarding.checklistDismissed);
  const saveChecklist = (action: "dismiss-checklist" | "show-checklist") =>
    fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
  const closeWelcome = (role?: OnboardingRole) => {
    setWelcomeOpen(false);
    setWelcomeFirstVisit(false);
    if (role) {
      if (role === "creator") setView("creator");
      else if (role === "bidder") setView("bidder");
      router.refresh(); // the checklist depends on the role
    }
  };

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
  const inFlight =
    profile?.registration === "registering" ||
    bids.some((b) => b.status === "placing" || (!!b.settlementTxHash && (b.status === "pending" || b.status === "counter_offered")));
  // Bumped by the "Refresh" button to restart polling after it timed out.
  const [pollRound, setPollRound] = React.useState(0);
  const [pollTimedOut, setPollTimedOut] = React.useState(false);
  React.useEffect(() => {
    setPollTimedOut(false);
    if (!inFlight) return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        clearInterval(t);
        setPollTimedOut(true);
        return;
      }
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [inFlight, pollRound, router]);

  if (provisioning) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-arc-bg-0 px-4">
        <div className="text-center" role="status">
          <BrandMark className="mx-auto mb-4 h-12 w-auto animate-pulse" />
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
            <HelpMenu
              isTestnet={onboarding.isTestnet}
              checklistHidden={checklistDismissed && !onboarding.checklist.complete}
              onOpenGuide={() => {
                setWelcomeFirstVisit(false);
                setWelcomeOpen(true);
              }}
              onShowChecklist={() => {
                setChecklistDismissed(false);
                void saveChecklist("show-checklist");
              }}
            />
            {wallet && <WalletDialog address={wallet.address} balanceUsdc={summary.walletUsdc} isTestnet={onboarding.isTestnet} />}
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

        {!checklistDismissed && !onboarding.checklist.complete && (
          <GettingStarted
            steps={onboarding.checklist.steps}
            done={onboarding.checklist.done}
            total={onboarding.checklist.total}
            walletAddress={wallet?.address ?? null}
            handle={profile?.handle ?? null}
            isTestnet={onboarding.isTestnet}
            onOpenView={setView}
            onDismiss={() => {
              setChecklistDismissed(true);
              void saveChecklist("dismiss-checklist");
              toast({ title: "Checklist hidden", description: "Bring it back any time from Help (?) at the top." });
            }}
          />
        )}

        {inFlight && pollTimedOut && (
          <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-arc-bg-1 px-4 py-3 text-sm">
            <span className="text-text-secondary">Something is still confirming on Arc. Auto-refresh has paused.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                router.refresh();
                setPollRound((n) => n + 1);
              }}
            >
              Refresh
            </Button>
          </div>
        )}

        <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
          {view === "bidder" && (
            <BidderView bids={placed} summary={summary} bidderConfig={bidderConfig} now={now} onOpenAgent={() => setView("agent")} />
          )}
          {view === "creator" && (
            <CreatorView profile={profile} wallet={wallet} bids={received} summary={summary} now={now} isTestnet={onboarding.isTestnet} />
          )}
          {view === "agent" && <AgentConsole config={bidderConfig} bids={placed} logs={logs} summary={summary} now={now} policy={policy} />}
        </div>
      </main>

      <WelcomeDialog
        open={welcomeOpen}
        onClose={closeWelcome}
        currentRole={onboardingRole(userRole)}
        firstVisit={welcomeFirstVisit}
        minBid={policy.minBid}
        refundDays={policy.refundDays}
      />
    </div>
  );
}
