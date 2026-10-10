"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money, Num, Panel } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { atomicToDollarInput, dollarsToAtomic, formatMoney, shortAddress } from "@/lib/format";
import { fieldClass } from "./creator-setup-form";
import type { AgentPolicyInfo } from "./types";

/** Kept back for the transfer's own network fee (matches AGENT_WALLET_GAS_RESERVE). */
const GAS_RESERVE = BigInt(50_000);

async function post(body: unknown) {
  const res = await fetch("/api/wallet/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error ?? "Something went wrong");
  return data;
}

/**
 * The bidder agent's own wallet: it bids only from here, so it can never spend
 * more than the user moved in. Create it, move USDC in, move it back.
 */
export function AgentWalletCard({ policy }: { policy: AgentPolicyInfo }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "create" | "fund" | "withdraw">(null);
  const [amount, setAmount] = React.useState("");
  const agent = policy.agentWallet;

  async function create() {
    setBusy("create");
    try {
      await post({ action: "create" });
      toast({ title: "Agent wallet created", description: "Move some USDC into it so your agent can bid.", variant: "success" });
      router.refresh();
    } catch (err) {
      toast({ title: "Couldn't create the agent wallet", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function move(action: "fund" | "withdraw") {
    setBusy(action);
    try {
      await post({ action, amount });
      toast({
        title: action === "fund" ? `Moving ${formatMoney(dollarsToAtomic(amount) ?? BigInt(0))} to your agent` : "Moving USDC back to your wallet",
        description: "Balances update in a few seconds.",
        variant: "success",
      });
      setAmount("");
      setTimeout(() => router.refresh(), 5000);
    } catch (err) {
      toast({ title: "Couldn't move USDC", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (!agent) {
    return (
      <Panel title="Agent wallet" description="Your agent bids only from its own wallet, so it can never spend more than you put in it.">
        <Button onClick={create} disabled={busy === "create"}>
          {busy === "create" ? "Creating…" : "Create agent wallet"}
        </Button>
        <p className="mt-3 text-xs text-text-secondary">Your agent won&apos;t bid until it has a wallet with USDC in it. Bids you place yourself still use your main wallet.</p>
      </Panel>
    );
  }

  const agentUsdc = agent.usdc === null ? null : BigInt(agent.usdc);
  const mainUsdc = policy.mainWalletUsdc === null ? null : BigInt(policy.mainWalletUsdc);
  const parsed = dollarsToAtomic(amount);
  const valid = parsed !== null && parsed > BigInt(0);
  const maxOf = (b: bigint | null) => (b !== null && b > GAS_RESERVE ? b - GAS_RESERVE : BigInt(0));

  return (
    <Panel
      title="Agent wallet"
      description="Your agent bids only from this wallet. Move in what you're happy for it to spend; move the rest back any time."
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">In agent wallet</p>
          <Money atomic={agentUsdc} className="text-2xl font-medium" />
          <a
            href={agent.href}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring mt-1 flex items-center gap-1 rounded text-xs text-arc-lavender hover:underline"
          >
            <Num>{shortAddress(agent.address)}</Num> on Arc <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        </div>
        <div className="text-right text-xs text-text-secondary">
          Main wallet <Money atomic={mainUsdc} className="text-text-primary" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="agent-amount" className="sr-only">
          Amount in USDC
        </label>
        <span className="relative min-w-0 flex-[1_1_140px]">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">
            $
          </span>
          <input
            id="agent-amount"
            inputMode="decimal"
            placeholder="25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${fieldClass} num pl-7`}
          />
        </span>
        <Button onClick={() => move("fund")} disabled={!valid || !!busy}>
          {busy === "fund" ? "Moving…" : "Move to agent"}
        </Button>
        <Button variant="outline" onClick={() => move("withdraw")} disabled={!valid || !!busy}>
          {busy === "withdraw" ? "Moving…" : "Move back"}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <button type="button" className="focus-ring rounded text-arc-lavender hover:underline" onClick={() => setAmount(atomicToDollarInput(maxOf(mainUsdc)))}>
          Max to agent
        </button>
        <button type="button" className="focus-ring rounded text-arc-lavender hover:underline" onClick={() => setAmount(atomicToDollarInput(maxOf(agentUsdc)))}>
          Max back
        </button>
        <span className="text-text-secondary">A few cents stay behind to pay the network fee.</span>
      </div>
    </Panel>
  );
}
