"use client";
import { Bot, Clock3, Inbox, Lock } from "lucide-react";
import { Stage, type LookTokens } from "@/components/stageshow/kit/stage";
import type { Act } from "@/components/stageshow/kit/act";
import type { Rect } from "@/components/stageshow/kit/measure";
import { Count } from "@/components/stageshow/kit/motion/Count";
import { Roll } from "@/components/stageshow/kit/motion/Roll";
import { Check } from "@/components/stageshow/kit/parts/Check";
import { CreatorAvatar } from "./primitives";
import { cn } from "@/lib/cn";
import "./bid-lifecycle.css";

/**
 * "How a bid settles", acted out once as it scrolls into view: a bidder's
 * agent escrows $25, the money waits in AttnnEscrow, the creator's agent
 * scores the bid, the creator replies and the escrow releases it. The refund
 * rule is the closing note. Built on the Stageshow kit (components/stageshow).
 *
 * Under reduced motion (and for crawlers) it shows the finished frame.
 * It is an illustration: the handle and amount are examples, not market data.
 */

type S = { step: number };
const START: S = { step: 0 };
const END: S = { step: 8 };

const BID = 25;
const CREATOR = "@mara";
const money = (n: number) => `$${n.toFixed(2)}`;

// Beats, in order (see the script):
// 1 the agent's "Escrow" button presses      2 $25 travels into the escrow, which counts up
// 3 the bid lands in the creator's inbox     4 the creator's reply is written
// 5 Reply is pressed                         6 $25 travels to the creator, the escrow counts down
// 7 paid: the creator's earnings roll up     8 the refund rule lands as the closing note
const script = async (a: Act<S>) => {
  const beats = [500, 450, 1200, 1300, 1100, 350, 900, 1000];
  for (let i = 0; i < beats.length; i++) {
    await a.wait(beats[i]!);
    a.put({ step: i + 1 });
  }
};

/** The stage reads Attnn's own colours, so the kit's parts match the site. */
const TOKENS: LookTokens = {
  "--ss-success": "rgb(var(--up))",
  "--ss-well": "rgb(var(--ink-0))",
  "--ss-text-strong": "rgb(var(--cream))",
  "--ss-font": "var(--font-sans)",
};

export function BidLifecycle() {
  return (
    <Stage<S>
      width={1240}
      height={330}
      compact={{ below: 900, width: 358, height: 760 }}
      initial={START}
      poster={END}
      play="once"
      script={script}
      theme="dark"
      tokens={TOKENS}
      className="bid-life"
    >
      {(s, rect, layout) => <Scene s={s} rect={rect} compact={layout === "compact"} />}
    </Stage>
  );
}

function Scene({ s, rect, compact }: { s: S; rect: (name: string) => Rect; compact: boolean }) {
  const step = s.step;
  const b = rect("bidder");
  const e = rect("escrow");
  const c = rect("creator");
  const ready = b.width > 0 && e.width > 0 && c.width > 0;

  // The two legs the money travels, in stage coordinates.
  const leg1 = compact
    ? { from: { x: b.x + b.width / 2, y: b.y + b.height }, to: { x: e.x + e.width / 2, y: e.y } }
    : { from: { x: b.x + b.width, y: e.y + e.height / 2 }, to: { x: e.x, y: e.y + e.height / 2 } };
  const leg2 = compact
    ? { from: { x: e.x + e.width / 2, y: e.y + e.height }, to: { x: c.x + c.width / 2, y: c.y } }
    : { from: { x: e.x + e.width, y: e.y + e.height / 2 }, to: { x: c.x, y: e.y + e.height / 2 } };

  const escrowed = step >= 2 && step < 6 ? BID : 0;
  const paid = step >= 7;

  return (
    <div className={cn("absolute inset-0 flex", compact ? "flex-col items-stretch gap-10 px-4 py-4" : "items-center justify-between px-2")}>
      {ready && (
        <>
          <Track leg={leg1} lit={step >= 2} compact={compact} />
          <Track leg={leg2} lit={step >= 6} compact={compact} />
          {/* The money itself: out of the agent's wallet, into the escrow, then on to the creator. */}
          <Coin at={step >= 2 ? leg1.to : leg1.from} show={step >= 1 && step < 3} />
          <Coin at={step >= 6 ? leg2.to : leg2.from} show={step >= 5 && step < 7} />
        </>
      )}

      {/* Bidder: the agent picks a creator and escrows a bid */}
      <div data-target="bidder" className={cn("bl-card relative z-10 p-5", compact ? "w-full" : "w-[340px]")}>
        <div className="flex items-center gap-2.5">
          <span className="bl-icon"><Bot className="h-4 w-4 text-arc-gold" /></span>
          <span className="text-sm font-medium text-text-primary">Your bidder agent</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <CreatorAvatar handle={CREATOR} size={32} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">{CREATOR}</div>
            <div className="text-xs text-text-secondary">Fits your goal</div>
          </div>
          <span className="num ml-auto text-2xl font-medium tracking-[-0.02em] text-text-primary">{money(BID)}</span>
        </div>
        {!compact && (
          <div className="mt-4 space-y-[7px]" aria-hidden>
            <span className="bl-bar w-[86%]" />
            <span className="bl-bar w-[58%]" />
          </div>
        )}
        <div className="bl-button mt-4" data-pressed={step === 1 || undefined} data-done={step >= 2 || undefined}>
          {step >= 2 ? (
            <span className="inline-flex items-center gap-1.5">
              <Check on size={14} /> Escrowed on Arc
            </span>
          ) : (
            <>Escrow {money(BID)}</>
          )}
        </div>
      </div>

      {/* The escrow: the hero object. Money waits here, and only a reply or the refund timer moves it. */}
      <div
        data-target="escrow"
        className={cn("bl-card bl-escrow relative z-10 p-6", compact ? "w-full" : "w-[400px]")}
        data-holding={(step >= 2 && step < 7) || undefined}
      >
        <div className="flex items-center gap-2.5">
          <span className="bl-icon"><Lock className="h-4 w-4 text-arc-gold" /></span>
          <span className="text-sm font-medium text-text-primary">AttnnEscrow</span>
          <span className="num ml-auto text-xs text-text-secondary">on Arc</span>
        </div>
        <Count
          className={cn("num mt-4 block text-[44px] font-medium leading-none tracking-[-0.03em]", escrowed ? "text-arc-gold" : "text-text-secondary")}
          value={escrowed}
          duration={850}
          format={money}
        />
        <div className="mt-2 text-sm text-text-secondary">
          <Roll variant="fade">{step < 2 ? "Waiting for a bid" : step < 6 ? "Held until the creator replies" : step < 7 ? "Releasing to the creator" : `Released to ${CREATOR}`}</Roll>
        </div>
        <div className={cn("bl-refund mt-4 flex items-center gap-2 text-[13px]", paid ? "text-text-secondary" : "text-arc-coral")} data-in={step >= 2 || undefined}>
          <Clock3 className="h-3.5 w-3.5 flex-none" />
          <Roll variant="fade">{paid ? "Paid on reply. Nothing to refund." : "Refunds to the bidder in 2d 23h"}</Roll>
        </div>
      </div>

      {/* Creator: the bid lands in the inbox, the agent scores it, the creator replies and collects */}
      <div data-target="creator" className={cn("bl-card relative z-10 p-5", compact ? "w-full" : "w-[380px]")}>
        <div className="flex items-center gap-2.5">
          <span className="bl-icon"><Inbox className="h-4 w-4 text-green" /></span>
          <span className="text-sm font-medium text-text-primary">{CREATOR}&apos;s inbox</span>
          <span className="ml-auto text-right">
            <span className="block text-[11px] uppercase tracking-[0.08em] text-text-secondary">Earned</span>
            <Count className={cn("num text-base font-medium", paid ? "text-green" : "text-text-primary")} value={paid ? BID : 0} duration={850} format={money} />
          </span>
        </div>
        <div className="bl-row mt-4" data-in={step >= 3 || undefined}>
          <div className="flex items-center gap-2.5">
            <span className="num text-xs text-text-secondary">#1</span>
            <span className="num text-lg font-medium text-arc-gold">{money(BID)}</span>
            <span className="bl-score ml-auto text-xs text-text-secondary" data-in={step >= 3 || undefined}>
              Agent score <span className="num text-green">9/10</span>
            </span>
          </div>
          <div className="mt-3 space-y-[7px]" aria-hidden>
            <span className="bl-bar bl-grow w-[92%]" data-in={step >= 4 || undefined} />
            <span className="bl-bar bl-grow w-[64%]" data-in={step >= 4 || undefined} style={{ transitionDelay: step >= 4 ? "180ms" : "0ms" }} />
          </div>
          <div className="bl-button bl-button--reply mt-4" data-pressed={step === 5 || undefined} data-done={paid || undefined}>
            {paid ? (
              <span className="inline-flex items-center gap-1.5">
                <Check on size={14} /> Paid {money(BID)}
              </span>
            ) : (
              <>Reply · collect {money(BID)}</>
            )}
          </div>
        </div>
      </div>

      {/* The other ending, said once the happy path has played */}
      <div
        className={cn("bl-note z-10 flex items-center gap-2 text-[13px] text-text-secondary", compact ? "justify-center" : "absolute")}
        data-in={step >= 8 || undefined}
        style={compact || !ready ? undefined : { left: e.x, top: e.y + e.height + 18, width: e.width }}
      >
        <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-arc-coral" />
        No reply within 3 days? The full {money(BID)} goes back.
      </div>
    </div>
  );
}

function Track({ leg, lit, compact }: { leg: { from: { x: number; y: number }; to: { x: number; y: number } }; lit: boolean; compact: boolean }) {
  const style = compact
    ? { left: leg.from.x - 1, top: leg.from.y, width: 2, height: Math.max(0, leg.to.y - leg.from.y) }
    : { left: leg.from.x, top: leg.from.y - 1, width: Math.max(0, leg.to.x - leg.from.x), height: 2 };
  return <span aria-hidden className="bl-track absolute z-0" data-dir={compact ? "v" : "h"} data-lit={lit || undefined} style={style} />;
}

function Coin({ at, show }: { at: { x: number; y: number }; show: boolean }) {
  return (
    <span
      aria-hidden
      className="bl-coin num absolute left-0 top-0 z-20"
      data-show={show || undefined}
      style={{ transform: `translate(${at.x - 34}px, ${at.y - 13}px)` }}
    >
      {money(BID)}
    </span>
  );
}
