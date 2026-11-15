"use client";

import * as React from "react";
import type { RunView } from "@/lib/decision-history";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Bot, Coins, Inbox, LogOut } from "lucide-react";
import { SiteHeader } from "@/components/market/site-header";
import { Num } from "@/components/market";
import { BrandMark } from "@/components/market/brand-mark";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { PROVIDER_LABEL, isSocialProvider, verifyErrorMessage } from "@/lib/social-verify-rules";
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
  history,
  userId,
  userRole,
  now,
  networkLabel,
  policy,
  onboarding,
  verifyResult = { verified: null, error: null, live: null },
}: {
  /** Result of a social-account verification, from the callback's redirect query (live: going live afterwards). */
  verifyResult?: { verified: string | null; error: string | null; live?: string | null };
  wallet: WalletData | null;
  profile: ProfileData | null;
  bidderConfig: BidderConfigData | null;
  bids: BidData[];
  summary: PortfolioSummary;
  logs: LogData[];
  /** The bidder agent's runs, grouped (lib/decision-history.ts). */
  history: RunView[];
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
    /** Circle Onramp widget origin when card funding is configured (ONRAMP_API_KEY), else null. */
    onrampWidgetUrl: string | null;
    /** Attnn. covers this creator's first network fee (lib/sponsorship.ts). */
    gasSponsored: boolean;
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
  // Bumped to ask the Creator tab to open its photo uploader.
  const [photoRequest, setPhotoRequest] = React.useState(0);
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

  // Back from verifying an X / LinkedIn account: say how it went, open the Creator tab
  // and drop the query so a refresh doesn't repeat the message.
  React.useEffect(() => {
    if (!verifyResult.verified && !verifyResult.error) return;
    setView("creator");
    if (verifyResult.error) {
      toast({ title: "Account not verified", description: verifyErrorMessage(verifyResult.error) ?? undefined, variant: "destructive" });
    } else if (isSocialProvider(verifyResult.verified)) {
      const label = PROVIDER_LABEL[verifyResult.verified];
      const live = verifyResult.live;
      toast(
        live === "going"
          ? { title: `${label} account verified`, description: "Your market is going live on Arc. This usually takes under a minute.", variant: "success" }
          : live === "funds"
            ? { title: `${label} account verified`, description: "To go live, add a little USDC to your wallet for the network fee, then press Go live." }
            : live === "retry"
              ? { title: `${label} account verified`, description: "Your market couldn't go live just now. Press Go live to try again." }
              : { title: `${label} account verified`, description: "It now shows on your market page.", variant: "success" },
      );
    }
    router.replace("/dashboard", { scroll: false });
    // Runs once per redirect back from the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="relative isolate flex min-h-screen items-center justify-center bg-arc-bg-0 px-4">
        <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 -z-10" />
        <div className="panel-raised w-full max-w-sm px-6 py-8 text-center" role="status">
          <BrandMark className="mx-auto mb-5 h-10 w-auto animate-pulse" />
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Setting up your wallet</h1>
          <p className="mt-1.5 text-sm text-text-secondary">Creating a Circle wallet on {networkLabel}…</p>
          <div aria-hidden className="mx-auto mt-6 h-1 w-40 overflow-hidden rounded-full bg-arc-bg-3">
            <div className="h-full w-1/3 rounded-full bg-arc-gold" style={{ animation: "attnn-progress 1.2s ease-in-out infinite alternate" }} />
          </div>
          <style>{`@keyframes attnn-progress { from { transform: translateX(-100%); } to { transform: translateX(300%); } }`}</style>
        </div>
      </div>
    );
  }

  const views: { id: View; label: string; icon: React.ReactNode; count?: number; badge?: boolean }[] = [
    { id: "bidder", label: "Bidding", icon: <Coins aria-hidden className="hidden h-4 w-4 sm:block" />, count: openPositions },
    { id: "creator", label: "Creator", icon: <Inbox aria-hidden className="hidden h-4 w-4 sm:block" />, count: inboxCount, badge: inboxCount > 0 },
    { id: "agent", label: "Agent", icon: <Bot aria-hidden className="hidden h-4 w-4 sm:block" />, badge: bidderConfig?.isActive ?? false },
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
            {wallet && <WalletDialog address={wallet.address} balanceUsdc={summary.walletUsdc} isTestnet={onboarding.isTestnet} onrampWidgetUrl={onboarding.onrampWidgetUrl} />}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              title="Sign out"
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-arc-bg-2 hover:text-text-primary"
            >
              <LogOut aria-hidden className="h-4 w-4" />
              <span className="sr-only">Sign out</span>
            </button>
          </>
        }
      />

      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow flex items-center gap-2">
              <span aria-hidden className="live-dot text-green" />
              {networkLabel} · USDC
            </p>
            <h1 className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.04em]">Portfolio</h1>
            <p className="mt-2 text-text-secondary">Your bids, your market and your agents, settled in USDC on Arc.</p>
          </div>
          <div role="tablist" aria-label="Portfolio view" className="flex w-full rounded-xl border border-border bg-arc-bg-1 p-1 shadow-raised sm:w-auto">
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
                  "focus-ring relative inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors sm:flex-none sm:gap-2 sm:px-4",
                  view === v.id ? "bg-arc-bg-3 text-text-primary shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {v.icon}
                {v.label}
                {v.count !== undefined && v.count > 0 ? (
                  <Num
                    className={cn(
                      "min-w-5 rounded-full px-1.5 py-px text-center text-[11px]",
                      v.badge ? "bg-arc-gold font-semibold text-[#130B00]" : "bg-arc-bg-2 text-text-secondary",
                    )}
                  >
                    {v.count}
                  </Num>
                ) : (
                  v.id === "agent" &&
                  v.badge && (
                    <span title="Agent is on" className="text-green">
                      <span aria-hidden className="live-dot" />
                      <span className="sr-only">(on)</span>
                    </span>
                  )
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
            onOpenPhoto={() => {
              setView("creator");
              setPhotoRequest((n) => n + 1);
            }}
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
            <CreatorView profile={profile} wallet={wallet} bids={received} summary={summary} now={now} isTestnet={onboarding.isTestnet} onrampWidgetUrl={onboarding.onrampWidgetUrl} gasSponsored={onboarding.gasSponsored} photoRequest={photoRequest} />
          )}
          {view === "agent" && <AgentConsole config={bidderConfig} bids={placed} logs={logs} history={history} summary={summary} now={now} policy={policy} />}
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
