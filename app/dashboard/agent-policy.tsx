import { Check, ExternalLink, Lock, X } from "lucide-react";
import { Money, Num, Panel } from "@/components/market";
import { shortAddress } from "@/lib/format";
import type { AgentPolicyInfo, BidderConfigData } from "./types";

/**
 * What the bidder agent can and can't do with the user's USDC, with live values.
 *
 * Every line here must stay true to the code: limits are enforced in
 * lib/agent.ts + lib/bids.ts (createBidIntent) before anything is sent, and the
 * escrow rules by contracts/src/AttnnEscrow.sol on Arc. Change them together.
 */
export function AgentPolicy({ config, spent, policy }: { config: BidderConfigData; spent: bigint; policy: AgentPolicyInfo }) {
  const budget = BigInt(config.dailyBudget);
  const left = budget > spent ? budget - spent : BigInt(0);
  const cap = BigInt(config.maxBidPerCreator) < BigInt(policy.maxBid) ? config.maxBidPerCreator : policy.maxBid;

  return (
    <Panel
      title="Spending policy"
      description="What your agent can and can't do with your USDC. These limits apply to every bid, whatever the AI suggests."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <section aria-labelledby="policy-limits">
          <h3 id="policy-limits" className="eyebrow">
            Your limits
          </h3>
          <p className="mt-1 text-xs text-text-secondary">Checked by Attnn. before any transaction is sent.</p>
          <ul className="mt-3 flex flex-col gap-2.5 text-[13px]">
            <Rule kind="limit">
              {policy.agentWallet ? (
                <>
                  Spends only from its own wallet: <Money atomic={policy.agentWallet.usdc} /> in it now
                </>
              ) : (
                "Spends only from its own agent wallet (create it above)"
              )}
            </Rule>
            <Rule kind="limit">
              Daily budget <Money atomic={budget} />, <Money atomic={left} /> left today
            </Rule>
            <Rule kind="limit">
              Each bid between the creator&apos;s floor and <Money atomic={cap} />, counter-offers included
            </Rule>
            <Rule kind="limit">One bid per creator per day, plus one re-bid if they counter</Rule>
            <Rule kind="limit">Paused means paused: no new bids, no counter-offers accepted</Rule>
            <Rule kind="limit">Only creators registered on Arc, never paused markets</Rule>
            <Rule kind="limit">
              Fit score of at least <Num>{config.minFitScore}/10</Num>. If the AI can&apos;t score a creator, no bid
            </Rule>
          </ul>
        </section>

        <section aria-labelledby="policy-escrow">
          <h3 id="policy-escrow" className="eyebrow">
            Locked in the escrow contract
          </h3>
          <p className="mt-1 text-xs text-text-secondary">Enforced on Arc. Nobody can override these, including Attnn.</p>
          <ul className="mt-3 flex flex-col gap-2.5 text-[13px]">
            <Rule kind="locked">
              Bids from <Money atomic={policy.minBid} /> to <Money atomic={policy.maxBid} />
            </Rule>
            <Rule kind="locked">Only the creator can release your USDC, by replying within {policy.refundDays} days</Rule>
            <Rule kind="locked">No reply in {policy.refundDays} days: the refund can only go back to your wallet</Rule>
            <Rule kind="locked">A declined bid is refunded to you straight away</Rule>
          </ul>
        </section>
      </div>

      <section aria-labelledby="policy-never" className="mt-5 border-t border-border pt-4">
        <h3 id="policy-never" className="eyebrow">
          Your agent can never
        </h3>
        <ul className="mt-3 grid gap-2.5 text-[13px] md:grid-cols-3">
          <Rule kind="never">Touch your main wallet, or send USDC anywhere but the escrow. Only you can move money</Rule>
          <Rule kind="never">Approve more than the bid it&apos;s placing, or approve anything but the escrow</Rule>
          <Rule kind="never">Release your escrowed USDC to a creator</Rule>
        </ul>
      </section>

      <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-4 text-xs text-text-secondary">
        {policy.escrowAddress && policy.escrowHref && (
          <a href={policy.escrowHref} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded text-arc-lavender hover:underline">
            Escrow contract <Num>{shortAddress(policy.escrowAddress)}</Num> <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        )}
        {(policy.agentWallet?.href ?? policy.walletHref) && (
          <a href={(policy.agentWallet?.href ?? policy.walletHref)!} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded text-arc-lavender hover:underline">
            Every transaction from your {policy.agentWallet ? "agent " : ""}wallet <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        )}
      </p>
    </Panel>
  );
}

function Rule({ children, kind }: { children: React.ReactNode; kind: "limit" | "locked" | "never" }) {
  const Icon = kind === "never" ? X : kind === "locked" ? Lock : Check;
  const tone = kind === "never" ? "text-arc-coral" : kind === "locked" ? "text-arc-gold" : "text-green";
  return (
    <li className="flex items-start gap-2">
      <Icon aria-hidden className={`mt-0.5 h-3.5 w-3.5 flex-none ${tone}`} />
      <span className="min-w-0 text-text-primary">{children}</span>
    </li>
  );
}
