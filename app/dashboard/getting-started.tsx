"use client";

import * as React from "react";
import Link from "next/link";
import { Copy, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/cn";
import type { ChecklistStep } from "@/lib/onboarding";

type View = "bidder" | "creator" | "agent";

/**
 * "Get started": what's left for this user to do, in order. Steps tick themselves
 * off from real data (lib/onboarding.ts), so a finished step simply disappears;
 * the count and bar show how far they've come. Hidden for good once everything
 * required is done, or when dismissed (Help can bring it back).
 */
export function GettingStarted({
  steps,
  done,
  total,
  walletAddress,
  handle,
  isTestnet,
  onOpenView,
  onDismiss,
}: {
  steps: ChecklistStep[];
  done: number;
  total: number;
  walletAddress: string | null;
  handle: string | null;
  isTestnet: boolean;
  onOpenView: (v: View) => void;
  onDismiss: () => void;
}) {
  const remaining = steps.filter((s) => !s.done);
  const next = remaining.find((s) => !s.optional && s.state !== "waiting") ?? remaining[0];

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    toast({ title: `${what} copied`, variant: "success" });
  };

  function actions(step: ChecklistStep, primary: boolean) {
    const variant = primary ? "default" : "outline";
    switch (step.id) {
      case "fund":
        return (
          <>
            {walletAddress && (
              <Button size="sm" variant={variant} onClick={() => copy(walletAddress, "Wallet address")}>
                <Copy aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                Copy wallet address
              </Button>
            )}
            {isTestnet && (
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-arc-lavender hover:underline"
              >
                Get free test USDC <ExternalLink aria-hidden className="h-3 w-3" />
                <span className="sr-only">(opens Circle&apos;s faucet in a new tab)</span>
              </a>
            )}
          </>
        );
      case "first-bid":
        return (
          <>
            <Button size="sm" variant={variant} asChild>
              <Link href="/creators">Browse markets</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenView("agent")}>
              Use an agent
            </Button>
          </>
        );
      case "market":
        return (
          <Button size="sm" variant={variant} onClick={() => onOpenView("creator")}>
            Open my market
          </Button>
        );
      case "registered":
        return step.state === "waiting" ? null : (
          <Button size="sm" variant={variant} onClick={() => onOpenView("creator")}>
            {step.state === "failed" ? "See what happened" : "Go live"}
          </Button>
        );
      case "photo":
        return (
          <Button size="sm" variant={variant} onClick={() => onOpenView("creator")}>
            Add photo
          </Button>
        );
      case "first-reply":
        return (step.waiting ?? 0) > 0 ? (
          <Button size="sm" variant={variant} onClick={() => onOpenView("creator")}>
            Open inbox
          </Button>
        ) : handle && steps.some((x) => x.id === "registered" && x.done) ? (
          <Button size="sm" variant={variant} onClick={() => copy(`${window.location.origin}/c/${handle}`, "Market link")}>
            <Copy aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Copy market link
          </Button>
        ) : null;
      default:
        return null;
    }
  }

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <section aria-labelledby="gs-title" className="panel-raised mb-5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow text-arc-gold">Get started</div>
          <h2 id="gs-title" className="mt-1 font-display text-lg font-bold">
            <Num>{done}</Num> of <Num>{total}</Num> done
          </h2>
          <div
            className="mt-2.5 h-1.5 max-w-sm overflow-hidden rounded-full bg-arc-bg-3"
            role="progressbar"
            aria-label="Getting started progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
          >
            <div className="h-full rounded-full bg-arc-gold transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="focus-ring -mr-1 -mt-1 inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg text-text-secondary hover:bg-arc-bg-2 hover:text-text-primary"
        >
          <X aria-hidden className="h-4 w-4" />
          <span className="sr-only">Hide the getting-started checklist</span>
        </button>
      </div>

      <ol className="mt-4 flex flex-col divide-y divide-border">
        {remaining.map((s) => {
          const isNext = s.id === next?.id;
          return (
            <li key={s.id} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[11px]",
                    s.state === "failed"
                      ? "border-arc-coral/60 text-arc-coral"
                      : isNext
                        ? "border-arc-gold text-arc-gold"
                        : "border-border-bright text-text-secondary",
                  )}
                >
                  {s.state === "waiting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Num>{steps.indexOf(s) + 1}</Num>}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {s.title}
                    {s.optional && <span className="ml-1.5 text-xs font-normal text-text-secondary">optional</span>}
                    {s.state === "waiting" && <span className="ml-1.5 text-xs font-normal text-arc-gold">confirming</span>}
                  </p>
                  <p className={cn("mt-0.5 text-xs", s.state === "failed" ? "text-arc-coral" : "text-text-secondary")}>{s.detail}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-9 sm:flex-none sm:pl-0">{actions(s, isNext)}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
