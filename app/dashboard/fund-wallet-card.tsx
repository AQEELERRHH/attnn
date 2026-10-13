"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/format";

const ONE_USDC = BigInt(1_000_000);

/** Circle returns balances as decimal strings ("12.345678"); convert without floats, truncating past 6 dp. */
function decimalToAtomic(s: unknown): bigint | null {
  const m = typeof s === "string" ? s.trim().match(/^(\d+)(?:\.(\d+))?$/) : null;
  if (!m) return null;
  return BigInt(m[1]!) * ONE_USDC + BigInt((m[2] ?? "").slice(0, 6).padEnd(6, "0"));
}

export function FundWalletCard({ address, onFunded, isTestnet }: { address: string; onFunded: () => void; isTestnet: boolean }) {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    toast({ title: "Address copied" });
    setTimeout(() => setCopied(false), 2000);
  };

  // Soft check so creators aren't sent to a registration that will fail.
  // The server enforces the same $1 minimum in /api/profile/activate.
  const checkAndContinue = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/wallet/balance");
      const data = await res.json();
      const balance = decimalToAtomic(data?.balance ?? "0");
      if (res.ok && balance !== null && balance < ONE_USDC) {
        toast({
          title: "Add at least $1 USDC to activate",
          description: `Your wallet has ${formatMoney(balance)}. Faucet funds can take a minute to arrive.`,
          variant: "destructive",
        });
        return;
      }
      onFunded();
    } catch {
      onFunded(); // balance service down: let them continue; activation re-checks
    } finally {
      setChecking(false);
    }
  };

  const steps = [
    { n: "01", label: "Wallet ready", cls: "border-green/40 text-green" },
    { n: "02", label: "Fund wallet", cls: "border-arc-gold/60 text-arc-gold" },
    { n: "03", label: "Register on Arc", cls: "border-border-bright text-text-secondary" },
  ];

  return (
    <Panel raised>
      <div className="eyebrow text-arc-gold">Open your creator market</div>
      <h2 className="mt-2 font-display text-2xl font-bold">Add USDC to your wallet</h2>
      <p className="mt-2 max-w-[65ch] text-sm text-text-secondary">
        Add at least $1 USDC to go live. Your wallet pays the tiny network fees on Arc (in USDC) for registering your market and replying to
        bids. USDC is a digital dollar: 1 USDC is always worth $1.
      </p>

      <ol className="mt-5 flex flex-wrap gap-2">
        {steps.map((s) => (
          <li key={s.n} className={`num rounded-full border px-3 py-1 text-xs ${s.cls}`}>
            {s.n} {s.label}
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-lg border border-border bg-arc-bg-0 p-4">
        <div className="eyebrow">Your wallet</div>
        <div className="num mt-2 break-all text-sm">{address}</div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={copyAddress}>
            <Copy aria-hidden className="mr-1.5 h-3 w-3" />
            {copied ? "Copied" : "Copy address"}
          </Button>
          {isTestnet && (
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring inline-flex items-center gap-1 rounded text-sm text-arc-lavender hover:underline"
            >
              Get free test USDC <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {isTestnet ? (
        <ol className="mt-5 list-decimal space-y-1.5 pl-5 text-sm text-text-secondary">
          <li>Copy your wallet address above</li>
          <li>Go to faucet.circle.com</li>
          <li>Select Arc Testnet</li>
          <li>Paste your address and request USDC (at least $1)</li>
          <li>Come back and press the button below</li>
        </ol>
      ) : (
        <ol className="mt-5 list-decimal space-y-1.5 pl-5 text-sm text-text-secondary">
          <li>Copy your wallet address above</li>
          <li>From an exchange or wallet that supports Arc, send at least $1 of USDC on the Arc network to it</li>
          <li>Come back and press the button below</li>
          <li className="list-none text-arc-coral">Only send USDC on Arc. USDC sent from another network may be lost.</li>
        </ol>
      )}

      <Button onClick={checkAndContinue} disabled={checking} className="mt-6 w-full">
        {checking ? "Checking balance…" : "I've added at least $1 USDC, continue"}
      </Button>
    </Panel>
  );
}
