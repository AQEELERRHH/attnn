"use client";

import { useState } from "react";
import Link from "next/link";
import { Wallet, Copy, LogOut, Search, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/cn";

interface WalletData {
  id: string;
  address: string;
  circleWalletId: string;
  blockchain: string;
  state: string;
}

interface TopBarProps {
  wallet: WalletData | null;
  userRole: string;
  pendingOfferCount?: number;
}

export function TopBar({ wallet, userRole, pendingOfferCount = 0 }: TopBarProps) {
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendLoading, setSendLoading] = useState(false);

  const fetchBalance = async () => {
    if (walletBalance !== null) return;
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/wallet/balance");
      const data = await res.json();
      if (data.success) setWalletBalance(data.balance);
    } catch { /* silent */ }
    finally { setBalanceLoading(false); }
  };

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      toast({ title: "Address copied", variant: "success" });
    }
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/";
  };

  // Shared send form used in both desktop dropdown and mobile sheet
  const SendForm = (
    <div className="space-y-2 pt-2 border-t border-border">
      <input
        type="text"
        placeholder="Recipient (0x…)"
        value={sendTo}
        onChange={e => setSendTo(e.target.value)}
        className="w-full text-xs px-2.5 py-2.5 rounded-lg border border-border bg-arc-bg-2 text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold"
      />
      <input
        type="number"
        placeholder="Amount (USDC)"
        value={sendAmount}
        onChange={e => setSendAmount(e.target.value)}
        min="0.01"
        step="0.01"
        className="w-full text-xs px-2.5 py-2.5 rounded-lg border border-border bg-arc-bg-2 text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold"
      />
      <button
        disabled={sendLoading || !sendTo || !sendAmount}
        onClick={async () => {
          setSendLoading(true);
          try {
            const res = await fetch("/api/wallet/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ to: sendTo, amount: sendAmount }),
            });
            const data = await res.json();
            if (data.success) {
              toast({ title: "Sent!", description: `${sendAmount} USDC sent`, variant: "success" });
              setSendTo(""); setSendAmount(""); setShowSend(false); setWalletOpen(false);
              setWalletBalance(null);
            } else {
              toast({ title: "Failed", description: data.error ?? "Send failed", variant: "destructive" });
            }
          } catch { toast({ title: "Error", variant: "destructive" }); }
          finally { setSendLoading(false); }
        }}
        className="w-full text-sm py-2.5 rounded-lg bg-arc-gold text-arc-bg-0 font-medium hover:opacity-90 transition-opacity disabled:opacity-50 min-h-[44px]"
      >
        {sendLoading ? "Sending…" : "Confirm Send"}
      </button>
    </div>
  );

  // Wallet panel content (shared between desktop dropdown and mobile sheet)
  const WalletPanel = (
    <>
      <div className="text-xs text-text-dim uppercase tracking-wider mb-1">USDC Balance</div>
      <div className="text-2xl font-display font-bold text-arc-gold mb-1">
        {balanceLoading ? "—" : walletBalance !== null ? `$${parseFloat(walletBalance).toFixed(2)}` : "—"}
      </div>
      {wallet && <div className="text-xs text-text-dim font-mono break-all mb-4">{wallet.address}</div>}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => { copyAddress(); setWalletOpen(false); }}
          className="flex items-center justify-center gap-1.5 text-xs py-2.5 rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors min-h-[44px]"
        >
          <Copy className="w-3 h-3" /> Copy
        </button>
        <button
          onClick={() => setShowSend(!showSend)}
          className="flex items-center justify-center gap-1.5 text-xs py-2.5 rounded-lg border border-arc-gold/40 text-arc-gold hover:bg-arc-gold/10 transition-colors min-h-[44px]"
        >
          Send USDC
        </button>
      </div>

      {showSend && SendForm}
    </>
  );

  return (
    <>
      <header className="h-14 border-b border-border bg-arc-bg-0/80 backdrop-blur-xl sticky top-0 z-40 flex items-center px-4 md:px-5 gap-3 md:gap-4">
        {/* Mobile logo */}
        <Link href="/dashboard" className="md:hidden flex items-center gap-2 shrink-0">
          <img src="/attnn-logo.jpeg" alt="Attnn." className="w-7 h-7 rounded-lg object-cover" />
          <span className="font-display font-bold text-base">attnn.</span>
        </Link>

        {/* Search bar — desktop only */}
        <div className="flex-1 max-w-xs hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-arc-bg-1 text-sm text-text-dim">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span>Search creators, skills or interests…</span>
        </div>

        {/* Mobile search button */}
        <button className="md:hidden ml-auto p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-arc-bg-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Search">
          <Search className="w-4 h-4" />
        </button>

        <div className="md:ml-auto flex items-center gap-2 md:gap-3">
          {/* Notifications */}
          <button
            className="relative p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-arc-bg-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {pendingOfferCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-arc-gold" />
            )}
          </button>

          {/* Wallet trigger */}
          {wallet && (
            <button
              onClick={() => { setWalletOpen(!walletOpen); fetchBalance(); }}
              className={cn(
                "flex items-center gap-2 px-2.5 md:px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors min-h-[44px]",
                walletOpen
                  ? "border-arc-gold/60 bg-arc-bg-2 text-text-primary"
                  : "border-border bg-arc-bg-1 text-text-secondary hover:text-text-primary hover:border-border-bright"
              )}
            >
              <Wallet className="w-3 h-3 shrink-0" />
              <span className="hidden sm:inline">{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</span>
              <span className="sm:hidden">Wallet</span>
            </button>
          )}

          {/* Role badge — desktop only */}
          <Badge variant="gold" className="text-xs hidden md:flex">{userRole}</Badge>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            aria-label="Sign out"
            className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-arc-bg-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Desktop wallet dropdown */}
      {walletOpen && wallet && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setWalletOpen(false)} />
          <div className="fixed right-4 top-[3.75rem] w-72 rounded-xl border border-border-bright bg-arc-bg-1 shadow-2xl z-50 p-4 hidden md:block">
            {WalletPanel}
          </div>
        </>
      )}

      {/* Mobile wallet bottom sheet */}
      {walletOpen && wallet && (
        <>
          <div className="fixed inset-0 z-40 bg-arc-bg-0/70 backdrop-blur-sm md:hidden" onClick={() => setWalletOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden rounded-t-2xl border-t border-border bg-arc-bg-1 p-5 pb-8 shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5" />
            <div className="flex items-center justify-between mb-4">
              <span className="font-display font-bold text-base">Wallet</span>
              <button onClick={() => setWalletOpen(false)} className="p-2 text-text-secondary min-h-[44px] min-w-[44px] flex items-center justify-center">✕</button>
            </div>
            {WalletPanel}
          </div>
        </>
      )}
    </>
  );
}
