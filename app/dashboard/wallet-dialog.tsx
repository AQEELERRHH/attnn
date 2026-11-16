"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { dollarsToAtomic, formatMoney, shortAddress } from "@/lib/format";
import { useRequestId } from "./use-request-id";
import { BuyUsdcButton } from "./buy-usdc-button";

const field =
  "focus-ring w-full rounded-lg border border-border-bright bg-arc-bg-0 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-dim";

/** Header wallet button: the main wallet's balance, address, how to add USDC, and Send USDC. */
export function WalletDialog({
  address,
  balanceUsdc,
  isTestnet,
  onrampWidgetUrl = null,
}: {
  address: string;
  balanceUsdc: string | null;
  isTestnet: boolean;
  /** Circle Onramp widget origin when card funding is on, else null. */
  onrampWidgetUrl?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [sending, setSending] = React.useState(false);
  /** Set once the server emailed a code for this (new) address: { masked email }. */
  const [codeSentTo, setCodeSentTo] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  /** USDC still sendable in the rolling 24 hours, from GET /api/wallet/send. */
  const [allowance, setAllowance] = React.useState<{ limit: string; remaining: string } | null>(null);
  const requestId = useRequestId();

  const atomic = dollarsToAtomic(amount);
  const validTo = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const overBalance = atomic !== null && balanceUsdc !== null && atomic > BigInt(balanceUsdc);
  const overAllowance = atomic !== null && allowance !== null && atomic > BigInt(allowance.remaining);
  const codeValid = /^\d{6}$/.test(code.trim());
  const canSend =
    validTo && atomic !== null && atomic > BigInt(0) && !overBalance && !overAllowance && !sending && (!codeSentTo || codeValid);

  const loadAllowance = React.useCallback(() => {
    fetch("/api/wallet/send")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && typeof d.remaining === "string" && setAllowance({ limit: d.limit, remaining: d.remaining }))
      .catch(() => {});
  }, []);
  React.useEffect(() => {
    if (open) loadAllowance();
  }, [open, loadAllowance]);
  // A different address or amount is a different request: start the code step again.
  React.useEffect(() => {
    setCodeSentTo(null);
    setCode("");
  }, [to, amount]);

  const copy = async () => {
    await navigator.clipboard.writeText(address).catch(() => {});
    toast({ title: "Address copied", variant: "success" });
  };

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend || atomic === null) return;
    setSending(true);
    try {
      const res = await fetch("/api/wallet/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          amount: amount.trim(),
          requestId: requestId.idFor(`send:${to.trim().toLowerCase()}:${amount.trim()}`),
          ...(codeSentTo ? { code: code.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 && data.needsCode) {
        setCodeSentTo(typeof data.sentTo === "string" ? data.sentTo : "your email");
        toast({ title: "Check your email", description: "We sent you a 6-digit code to confirm this new address." });
      } else if (res.ok && data.success) {
        requestId.done();
        toast({ title: "Transfer submitted", description: `${formatMoney(atomic)} to ${shortAddress(to.trim())}`, variant: "success" });
        setTo("");
        setAmount("");
        setCodeSentTo(null);
        setCode("");
        setOpen(false);
        router.refresh();
      } else {
        if (data.restart) requestId.done();
        toast({ title: "Send failed", description: data.error ?? "Try again", variant: "destructive" });
        loadAllowance();
      }
    } catch {
      toast({ title: "Send failed", description: "Network error. Nothing was sent.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-border-bright bg-arc-bg-1 pl-1.5 pr-3 text-xs text-text-secondary transition-colors hover:border-text-primary/25 hover:text-text-primary"
        >
          <AddressOrb address={address} />
          <span className="num hidden sm:inline">{shortAddress(address)}</span>
          <span aria-hidden className="hidden h-3.5 w-px bg-border-bright sm:block" />
          <Money atomic={balanceUsdc} tone="gold" className="font-medium" />
          <span className="sr-only">Open wallet</span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>Your wallet</DialogTitle>
          <DialogDescription>Your USDC wallet on Arc. It pays for your bids and the tiny USDC network fees, and creator earnings land here.</DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-lg border border-border bg-arc-bg-0 p-4">
          <span aria-hidden className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-arc-gold/50 to-transparent" />
          <div className="flex items-center justify-between">
            <div className="eyebrow">USDC balance</div>
            <AddressOrb address={address} size={22} />
          </div>
          <Money atomic={balanceUsdc} tone="gold" className="mt-1.5 block text-[32px] font-medium leading-none tracking-[-0.03em]" />
          {balanceUsdc === null && <p className="mt-1 text-xs text-text-secondary">Couldn&apos;t read the balance from Arc. Try again shortly.</p>}
          <p className="num mt-3 break-all text-xs text-text-secondary">{address}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy aria-hidden className="mr-1.5 h-3 w-3" /> Copy address
            </Button>
            {isTestnet && (
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-arc-lavender link-u"
              >
                Get free test USDC <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            )}
          </div>
          {onrampWidgetUrl && <BuyUsdcButton widgetBaseUrl={onrampWidgetUrl} className="mt-4" />}
          {!isTestnet && (
            <p className="mt-3 text-xs text-arc-coral">
              Only send USDC on the Arc network to this address. USDC sent from another network may be lost.
            </p>
          )}
        </div>

        <form onSubmit={send} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Send USDC</h3>
          <div>
            <label htmlFor="send-to" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Recipient address
            </label>
            <input id="send-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" autoComplete="off" className={`${field} num`} />
            {to.trim() !== "" && !validTo && <p className="mt-1 text-xs text-arc-coral">Enter a full 0x address (42 characters).</p>}
          </div>
          <div>
            <label htmlFor="send-amount" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Amount (USDC)
            </label>
            <input
              id="send-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10.00"
              autoComplete="off"
              className={`${field} num`}
            />
            {amount.trim() !== "" && atomic === null && <p className="mt-1 text-xs text-arc-coral">Enter an amount like 10 or 10.50.</p>}
            {overBalance && <p className="mt-1 text-xs text-arc-coral">That&apos;s more than your balance.</p>}
            {!overBalance && overAllowance && allowance && (
              <p className="mt-1 text-xs text-arc-coral">
                That&apos;s more than can leave your wallet right now: <Money atomic={allowance.remaining} /> left in the last 24 hours.
              </p>
            )}
            {allowance && (
              <p className="mt-1 text-xs text-text-secondary">
                For your safety, up to <Money atomic={allowance.limit} /> can leave your wallet in any 24 hours: sends, bids you place and moves
                to your agent together (<Money atomic={allowance.remaining} /> left). The first time you send to a new address, we email you a code
                to confirm it.
              </p>
            )}
          </div>
          {codeSentTo && (
            <div>
              <label htmlFor="send-code" className="mb-1.5 block text-xs font-medium text-text-secondary">
                Code from your email
              </label>
              <input
                id="send-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className={`${field} num tracking-widest`}
              />
              <p className="mt-1 text-xs text-text-secondary">
                We sent a 6-digit code to {codeSentTo}. It confirms you want to send to this new address and lasts 10 minutes. Only needed once
                per address.
              </p>
            </div>
          )}
          <Button type="submit" disabled={!canSend}>
            {sending
              ? "Sending…"
              : codeSentTo
                ? `Confirm & send ${atomic !== null ? formatMoney(atomic) : ""}`.trim()
                : atomic !== null && atomic > BigInt(0)
                  ? `Send ${formatMoney(atomic)}`
                  : "Send"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A small gradient orb derived from the wallet address, so a wallet is recognisable at a glance. */
function AddressOrb({ address, size = 22 }: { address: string; size?: number }) {
  const hex = address.replace(/^0x/, "").toLowerCase();
  const a = parseInt(hex.slice(0, 6) || "0", 16) % 360;
  const b = parseInt(hex.slice(-6) || "0", 16) % 360;
  return (
    <span
      aria-hidden
      className="inline-block flex-none rounded-full ring-1 ring-inset ring-border-bright"
      style={{ width: size, height: size, background: `conic-gradient(from ${a}deg, hsl(${a} 80% 60%), hsl(${b} 75% 45%), hsl(${(a + 120) % 360} 70% 55%), hsl(${a} 80% 60%))` }}
    />
  );
}
