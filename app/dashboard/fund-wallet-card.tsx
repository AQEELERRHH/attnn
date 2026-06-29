"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function FundWalletCard({
  address,
  onFunded,
}: {
  address: string;
  onFunded: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast({ title: "Address copied", variant: "success" });
    setTimeout(() => setCopied(false), 2000);
  };

  const FAUCET_URL = "https://faucet.circle.com";

  return (
    <Card className="p-8">
      <div className="text-xs uppercase tracking-wider text-arc-gold mb-2">
        Creator Registration
      </div>
      <h2 className="text-2xl font-display font-bold mb-2">
        Your inbox, priced and ranked.
      </h2>
      <p className="text-sm text-text-secondary mb-8">
        Register once. Your Circle Agent Wallet handles everything autonomously.
      </p>

      <div className="flex items-center gap-2 mb-8">
        <div className="px-3 py-1 rounded-full border border-green/40 text-green text-xs font-mono">
          01 Register
        </div>
        <div className="px-3 py-1 rounded-full border border-arc-gold/60 text-arc-gold text-xs font-mono">
          02 Fund wallet
        </div>
        <div className="px-3 py-1 rounded-full border border-border text-text-dim text-xs font-mono">
          03 Go on-chain
        </div>
      </div>

      <h3 className="text-xl font-display font-bold mb-2">Fund your Agent Wallet</h3>
      <p className="text-sm text-text-secondary mb-6">
        Your wallet needs testnet USDC to pay gas fees on Arc.
      </p>

      <div className="rounded-lg border border-border bg-arc-bg-2/50 p-4 mb-6">
        <div className="text-xs uppercase tracking-wider text-text-secondary mb-2">
          Your Circle Agent Wallet
        </div>
        <div className="font-mono text-sm break-all mb-3">{address}</div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" type="button" onClick={copyAddress}>
            <Copy className="w-3 h-3 mr-2" />
            {copied ? "Copied" : "Copy address"}
          </Button>
          
            href={FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-arc-gold text-sm flex items-center gap-1 hover:underline"
          >
            Get testnet USDC
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <ol className="text-sm text-text-secondary space-y-2 mb-8 list-decimal pl-5">
        <li>Copy your wallet address above</li>
        <li>
          Go to{" "}
          
            href={FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-arc-gold hover:underline"
          >
            faucet.circle.com
          </a>
        </li>
        <li>
          Select <span className="text-arc-gold">Arc Testnet</span>
        </li>
        <li>Paste your address and request USDC</li>
        <li>Come back and click the button below</li>
      </ol>

      <Button type="button" onClick={onFunded} className="w-full">
        I have funded my wallet, Activate on Arc
      </Button>
    </Card>
  );
}
