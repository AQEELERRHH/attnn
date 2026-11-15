"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { ESCROW_MAX_BID, creatorFloor, formatUsd } from "@/lib/bid-rules";
import { glossary } from "@/lib/glossary";
import { FieldHint } from "./field-hint";
import { SecurityCodeField, isSecurityCode } from "./security-code-field";
import { atomicToDollarInput, dollarsToAtomic, shortAddress } from "@/lib/format";

export interface BidTicketProps {
  /** Creator floor, atomic USDC. */
  floorUsdc: string;
  /** Amounts of open (escrowed) bids, atomic USDC — for "Match top" and queue position. */
  openBidAmounts: string[];
  /** Shown as "Bidding as …". */
  biddingAs: string;
  escrowAddress?: string | null;
  /** Explorer URL for the escrow contract. */
  escrowHref?: string | null;
  /**
   * Called with the atomic amount, message and (when asked for) the emailed code.
   * Resolve { ok: true } once the bid is queued (it shows as "placing" until it
   * confirms on Arc), or { ok: false, needsCode: maskedEmail } when the bid is over the
   * 24-hour allowance and needs the code to go ahead.
   */
  onSubmit: (amountUsdc: string, message: string, code?: string) => Promise<{ ok: boolean; error?: string; needsCode?: string }>;
  /** When set, the ticket is shown but disabled with this explanation. */
  disabledReason?: string | null;
  className?: string;
}

/** The bid form on a creator market: amount, quick picks, message, escrow summary. */
export function BidTicket({
  floorUsdc,
  openBidAmounts,
  biddingAs,
  escrowAddress,
  escrowHref,
  onSubmit,
  disabledReason,
  className,
}: BidTicketProps) {
  const floor = creatorFloor(floorUsdc);
  const open = openBidAmounts.map((a) => BigInt(a));
  const top = open.reduce((m, a) => (a > m ? a : m), BigInt(0));
  const defaultAmount = top > floor ? top : floor;

  const [amountInput, setAmountInput] = React.useState(atomicToDollarInput(defaultAmount));
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  /** Masked email once a code was sent for this exact amount. */
  const [codeSentTo, setCodeSentTo] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");

  const amount = dollarsToAtomic(amountInput);
  const belowFloor = amount !== null && amount < floor;
  const aboveMax = amount !== null && amount > ESCROW_MAX_BID;
  const valid = amount !== null && amount > BigInt(0) && !belowFloor && !aboveMax;
  const queue = amount !== null ? open.filter((a) => a > amount).length + 1 : null;

  const quick = [
    { label: "Floor", value: floor },
    ...(top > BigInt(0) ? [{ label: "Match top", value: top }] : []),
    ...(top > BigInt(0) ? [{ label: "Top +10%", value: (top * BigInt(110) + BigInt(99)) / BigInt(100) }] : []),
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || amount === null || disabledReason) return;
    if (codeSentTo && !isSecurityCode(code)) return;
    setSubmitting(true);
    setResult(null);
    try {
      const r = await onSubmit(amount.toString(), message.trim(), codeSentTo ? code.trim() : undefined);
      if (r.needsCode) {
        setCodeSentTo(r.needsCode);
        setResult({ ok: false, text: r.error ?? "This bid is over your 24-hour allowance. Enter the code from your email to approve it." });
        return;
      }
      setResult(
        r.ok
          ? { ok: true, text: "Bid submitted. It shows as “Confirming on Arc” until the USDC is escrowed." }
          : { ok: false, text: r.error ?? "Could not place bid." },
      );
      if (r.ok) {
        setMessage("");
        setCodeSentTo(null);
        setCode("");
      }
    } catch {
      setResult({ ok: false, text: "Something went wrong. Nothing was charged." });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldBase =
    "w-full rounded-lg border border-border-bright bg-arc-bg-0 text-text-primary placeholder:text-text-dim transition-colors hover:border-text-primary/20 focus:border-arc-lavender/60 focus:outline-none focus:ring-2 focus:ring-arc-lavender/20";

  return (
    <form onSubmit={submit} className={cn("panel-raised relative flex flex-col gap-4 p-5", className)} aria-describedby="ticket-terms">
      <span aria-hidden className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-arc-gold/60 to-transparent" />
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em]">Place bid</h2>
        <span className="num inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-secondary">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#2775CA]" />
          USDC · Arc
        </span>
      </div>

      <div>
        <label htmlFor="bid-amount" className="mb-1.5 block text-xs font-medium text-text-secondary">
          Bid amount
        </label>
        <div
          className={cn(
            "flex h-14 items-center gap-2 rounded-lg border bg-arc-bg-0 px-4 transition-colors focus-within:border-arc-lavender/60 focus-within:ring-2 focus-within:ring-arc-lavender/20",
            belowFloor || aboveMax ? "border-arc-coral/50" : "border-border-bright hover:border-text-primary/20",
          )}
        >
          <span className="num text-2xl text-text-dim">$</span>
          <input
            id="bid-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amountInput}
            onChange={(e) => {
              setAmountInput(e.target.value);
              setResult(null);
              // A code approves one exact amount: a new amount starts over.
              setCodeSentTo(null);
              setCode("");
            }}
            aria-invalid={belowFloor || aboveMax || amount === null}
            aria-describedby="bid-amount-hint"
            className="num min-w-0 flex-1 bg-transparent text-[26px] font-medium tracking-[-0.02em] text-text-primary outline-none"
          />
          <span className="num text-xs text-text-secondary">USDC</span>
        </div>
        <div className={cn("mt-2 grid gap-1.5", quick.length === 3 ? "grid-cols-3" : quick.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
          {quick.map((q) => {
            const on = amount !== null && amount === q.value;
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => setAmountInput(atomicToDollarInput(q.value))}
                aria-pressed={on}
                className={cn(
                  "focus-ring min-h-11 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                  on ? "border-arc-gold/70 bg-arc-gold/[0.07]" : "border-border-bright bg-arc-bg-0 hover:border-text-primary/20 hover:bg-arc-bg-2",
                )}
              >
                <span className={cn("block text-[11px]", on ? "text-arc-gold" : "text-text-secondary")}>{q.label}</span>
                <span className="num block text-[13px]">{formatUsd(q.value)}</span>
              </button>
            );
          })}
        </div>
        {belowFloor && (
          <p role="alert" className="mt-2 text-xs text-arc-coral">
            Below this creator&apos;s {formatUsd(floor)} floor. Raise it to place a bid.
          </p>
        )}
        {aboveMax && (
          <p role="alert" className="mt-2 text-xs text-arc-coral">
            The maximum bid is {formatUsd(ESCROW_MAX_BID)}.
          </p>
        )}
        {amount === null && amountInput.trim() !== "" && (
          <p role="alert" className="mt-2 text-xs text-arc-coral">
            Enter an amount like 25 or 25.50.
          </p>
        )}
        {!belowFloor && !aboveMax && (amount !== null || amountInput.trim() === "") && (
          <FieldHint id="bid-amount-hint" className="mt-2" more={glossary.bidFloor}>
            Minimum bid here: <span className="num text-text-primary">{formatUsd(floor)}</span> USDC (1 USDC = $1).
          </FieldHint>
        )}
      </div>

      <div>
        <label htmlFor="bid-message" className="mb-1.5 block text-xs font-medium text-text-secondary">
          Message
        </label>
        <textarea
          id="bid-message"
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What do you want their attention for?"
          className={cn(fieldBase, "resize-y px-3 py-2.5 text-[13px] leading-relaxed")}
        />
      </div>

      {codeSentTo && (
        <SecurityCodeField
          id="bid-code"
          sentTo={codeSentTo}
          value={code}
          onChange={setCode}
          reason="At most $500 can leave your wallet in any 24 hours without your approval."
        />
      )}

      {biddingAs && (
        <p className="flex items-center gap-2 text-xs text-text-secondary">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
          Bidding as <span className="font-medium text-text-primary">{biddingAs}</span>
        </p>
      )}

      <dl id="ticket-terms" className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 rounded-lg border border-border bg-arc-bg-0 px-3.5 py-3 text-[13px]">
        <dt className="text-text-secondary">You escrow</dt>
        <dd className="num text-right font-medium text-arc-gold">{valid && amount !== null ? formatUsd(amount) : "—"}</dd>
        <dt className="text-text-secondary">Queue position</dt>
        <dd className="num text-right">{queue ? `#${queue} of ${open.length + 1}` : "—"}</dd>
        <dt className="text-text-secondary">No reply in</dt>
        <dd className="num text-right text-arc-coral/90">3 days → full refund</dd>
      </dl>
      <FieldHint className="-mt-1.5" more={`${glossary.escrow} ${glossary.refund(3)}`}>
        Locked, not paid: the creator only gets it by replying.
      </FieldHint>

      <button
        type="submit"
        disabled={!valid || submitting || !!disabledReason || (!!codeSentTo && !isSecurityCode(code))}
        className="focus-ring btn-primary h-12 text-[15px] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] disabled:cursor-not-allowed"
      >
        {submitting
          ? "Submitting…"
          : valid && amount !== null
            ? `${codeSentTo ? "Approve & place bid" : "Place bid"} · ${formatUsd(amount)}`
            : "Enter an amount"}
      </button>

      {disabledReason && <p className="text-xs text-text-secondary">{disabledReason}</p>}
      {result && (
        <p role="status" className={cn("text-xs", result.ok ? "text-green" : "text-arc-coral")}>
          {result.text}
        </p>
      )}

      {escrowAddress && (
        <p className="text-xs text-text-secondary">
          Held by AttnnEscrow on Arc, not by Attnn.{" "}
          {escrowHref ? (
            <a href={escrowHref} target="_blank" rel="noopener noreferrer" className="num text-arc-lavender hover:underline">
              {shortAddress(escrowAddress)} ↗
            </a>
          ) : (
            <span className="num">{shortAddress(escrowAddress)}</span>
          )}
        </p>
      )}
    </form>
  );
}
