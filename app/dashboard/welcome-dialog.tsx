"use client";

import * as React from "react";
import { Coins, Inbox, Lock, RotateCcw, Send, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BrandMark } from "@/components/market/brand-mark";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/bid-rules";
import type { OnboardingRole } from "@/lib/onboarding";

const ROLES: { id: OnboardingRole; title: string; body: string; icon: React.ReactNode }[] = [
  { id: "bidder", title: "Reach someone", body: "Bid USDC for a reply from a creator.", icon: <Send aria-hidden className="h-4 w-4" /> },
  { id: "creator", title: "Get paid to reply", body: "Open a market. Earn when you answer.", icon: <Inbox aria-hidden className="h-4 w-4" /> },
  { id: "both", title: "Both", body: "Bid on others and run your own market.", icon: <Sparkles aria-hidden className="h-4 w-4" /> },
];

/**
 * First-run welcome: the value in one line, the money rules in three plain
 * sentences, and one question that sets the user's role. Every way out (Get
 * started, Skip, Esc, the X) records it as seen, so it never comes back on its
 * own; Help → "Welcome guide" reopens it.
 */
export function WelcomeDialog({
  open,
  onClose,
  currentRole,
  minBid,
  refundDays,
  firstVisit,
}: {
  open: boolean;
  /** Called after saving; `role` is set when the user picked one. */
  onClose: (role?: OnboardingRole) => void;
  currentRole: OnboardingRole;
  minBid: string;
  refundDays: number;
  /** False when reopened from Help: the role is preselected and the copy says "change". */
  firstVisit: boolean;
}) {
  const [role, setRole] = React.useState<OnboardingRole | null>(firstVisit ? null : currentRole);
  const [saving, setSaving] = React.useState(false);
  const closing = React.useRef(false);
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (open) {
      closing.current = false;
      setRole(firstVisit ? null : currentRole);
    }
  }, [open, firstVisit, currentRole]);

  async function finish(picked?: OnboardingRole) {
    if (closing.current) return;
    closing.current = true;
    setSaving(true);
    // Best-effort: if this fails the guide simply shows again next visit.
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "welcome", ...(picked ? { role: picked } : {}) }),
    }).catch(() => {});
    setSaving(false);
    onClose(picked);
  }

  const rules = [
    {
      icon: <Coins aria-hidden className="h-4 w-4 text-arc-gold" />,
      lead: "Everything is in USDC.",
      body: "A digital dollar: 1 USDC is always worth $1. Attnn. gives you a wallet for it, with no seed phrase to manage.",
    },
    {
      icon: <Lock aria-hidden className="h-4 w-4 text-arc-gold" />,
      lead: "Bids are locked, not paid.",
      body: "When you bid, your USDC goes into a locked contract (an escrow) on Arc. The creator can't touch it yet.",
    },
    {
      icon: <RotateCcw aria-hidden className="h-4 w-4 text-arc-coral" />,
      lead: `Reply in ${refundDays} days, or it comes back.`,
      body: `The creator only gets the USDC by replying within ${refundDays} days. No reply, and it returns to you automatically. A decline returns it straight away.`,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent
        className="max-h-[92vh] w-[calc(100%-2rem)] max-w-xl gap-0 overflow-y-auto p-0"
        // Start on the heading, not the first role card: a focused card looks chosen.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <div className="border-b border-border p-6 pb-5">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-6 w-auto" />
            <span className="eyebrow text-arc-gold">{firstVisit ? "Welcome to Attnn." : "How Attnn. works"}</span>
          </div>
          <DialogTitle ref={titleRef} tabIndex={-1} className="mt-4 text-2xl leading-tight outline-none sm:text-[26px]">Reach people worth reaching. Get paid to reply.</DialogTitle>
          <DialogDescription className="mt-2">
            Bidders offer USDC for a creator&apos;s attention. Creators earn it by replying. AI agents can do the bidding and the
            sorting for you.
          </DialogDescription>
        </div>

        <section aria-labelledby="welcome-money" className="p-6 pb-5">
          <h3 id="welcome-money" className="eyebrow">
            How the money works
          </h3>
          <ol className="mt-3 flex flex-col gap-3.5">
            {rules.map((r) => (
              <li key={r.lead} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-border bg-arc-bg-0">{r.icon}</span>
                <p className="text-sm text-text-secondary">
                  <span className="font-medium text-text-primary">{r.lead}</span> {r.body}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-3.5 text-xs text-text-secondary">
            Bids start at <span className="num text-text-primary">{formatUsd(BigInt(minBid))}</span>. These rules are written into the
            contract on Arc, and each creator sets their own minimum.
          </p>
        </section>

        <section aria-labelledby="welcome-role" className="border-t border-border p-6 pb-5">
          <h3 id="welcome-role" className="eyebrow">
            {firstVisit ? "What brings you here?" : "What are you here for?"}
          </h3>
          <div role="radiogroup" aria-labelledby="welcome-role" className="mt-3 grid gap-2 sm:grid-cols-3">
            {ROLES.map((r) => {
              const on = role === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setRole(r.id)}
                  className={cn(
                    "focus-ring flex min-h-11 flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                    on ? "border-arc-gold bg-arc-bg-3" : "border-border-bright bg-arc-bg-0 hover:bg-arc-bg-2",
                  )}
                >
                  <span className={cn("flex items-center gap-2 text-sm font-medium", on ? "text-arc-gold" : "text-text-primary")}>
                    {r.icon}
                    {r.title}
                  </span>
                  <span className="text-xs text-text-secondary">{r.body}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-secondary">This only changes what we show you first. You can do everything either way.</p>
        </section>

        <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button
            type="button"
            onClick={() => finish()}
            disabled={saving}
            className="focus-ring h-11 rounded-lg px-3 text-sm text-text-secondary hover:text-text-primary"
          >
            {firstVisit ? "Skip for now" : "Close"}
          </button>
          <button
            type="button"
            onClick={() => role && finish(role)}
            disabled={!role || saving}
            className="focus-ring h-11 rounded-lg bg-arc-gold px-5 font-display text-[15px] font-bold text-arc-bg-0 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : role ? (firstVisit ? "Get started" : "Save") : "Pick one to continue"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
