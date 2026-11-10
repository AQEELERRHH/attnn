import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT, LegalPage, LegalSection } from "@/components/market/legal-page";
import { ESCROW_MAX_BID, ESCROW_MIN_BID, REFUND_PERIOD_MS, formatUsd } from "@/lib/bid-rules";
import { REPLY_MIN_CHARS } from "@/lib/reply-rules";
import { DAILY_ALLOWANCE } from "@/lib/withdrawals";
import { arc } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Terms · Attnn.",
  description: "The rules for using Attnn.: bids, replies, refunds, agents and your responsibilities.",
};

/*
 * Numbers come from the same constants the code enforces. Keep the rest true to
 * lib/bids.ts, lib/agent.ts, lib/withdrawals.ts and contracts/src/AttnnEscrow.sol.
 * Needs legal review before Attnn. is incorporated; then name the company in section 1.
 */
export default function TermsPage() {
  const days = Math.round(REFUND_PERIOD_MS / (24 * 60 * 60 * 1000));
  const testnet = arc.network === "testnet";
  return (
    <LegalPage
      title="Terms of use"
      updated="10 November 2026"
      networkLabel={arc.chain.name}
      intro={
        <p>
          These are the rules for using Attnn. By creating an account or placing a bid you agree to them. They&apos;re written to be read, so please do. If something here is unclear, email{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="text-arc-lavender hover:underline">
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      }
    >
      <LegalSection id="service" title="1. What Attnn. is">
        <p>
          Attnn. (&quot;we&quot;) is a marketplace for attention. Bidders put USDC into an escrow contract on the Arc blockchain to get a reply from a creator. Creators earn the bid by replying.
          If there&apos;s no reply in {days} days, the bidder gets it back. Software agents can do this for either side.
        </p>
        <p>
          {testnet
            ? "This site currently runs on Arc Testnet: its USDC has no value and is only for trying things out."
            : "This site runs on Arc mainnet with real USDC. Bids move real money."}{" "}
          USDC is issued by Circle and is meant to be worth $1, but neither we nor Circle can promise that.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Who can use it">
        <ul>
          <li>You must be 18 or over and able to enter a binding agreement.</li>
          <li>You must not be in a country, or on a list, that sanctions laws stop us from serving, and you must follow the laws that apply to you, including on taxes.</li>
          <li>One account per person. Keep your email account secure: it&apos;s how you sign in and how we send security codes.</li>
        </ul>
      </LegalSection>

      <LegalSection id="wallets" title="3. Your wallets">
        <p>
          When you sign up we create USDC wallets for you through Circle. <strong>Attnn. holds the keys to these wallets</strong> and signs transactions for you when you ask, or when your agent
          acts within the limits you set. The escrow contract is what limits where escrowed USDC can go.
        </p>
        <ul>
          <li>
            Money leaving your wallets (sends, bids you place by hand and top-ups of your agent wallet) shares one allowance of {formatUsd(DAILY_ALLOWANCE)} per 24 hours. Going over it, sending
            to a new address, or raising your agent&apos;s limits needs a code we email you.
          </li>
          <li>Sending USDC to the wrong address or network can&apos;t be undone. Check the address before you send.</li>
          <li>Network fees on Arc are paid in USDC from your wallet.</li>
        </ul>
      </LegalSection>

      <LegalSection id="bids" title="4. How bids work">
        <ul>
          <li>
            A bid is between {formatUsd(ESCROW_MIN_BID)} and {formatUsd(ESCROW_MAX_BID)}, and at least the creator&apos;s minimum. When it&apos;s placed, the USDC is locked in the escrow contract.
          </li>
          <li>
            <strong>Reply:</strong> the creator replies within {days} days and the bid is paid to them. A reply must be at least {REPLY_MIN_CHARS} characters.
          </li>
          <li>
            <strong>Decline:</strong> the bid goes straight back to the bidder.
          </li>
          <li>
            <strong>No reply in {days} days:</strong> the bid can only go back to the bidder&apos;s wallet. We claim the refund for you automatically; outside agents claim their own.
          </li>
          <li>
            <strong>Counter-offer:</strong> a creator can ask for more. The original bid stays locked until it&apos;s replaced, settled or refunded.
          </li>
        </ul>
        <p>
          A bid pays for a reply, nothing more. It doesn&apos;t buy a meeting, a deal, an endorsement or any particular answer. Once a bid is paid out it can&apos;t be reversed, so we can&apos;t
          refund a reply you didn&apos;t like. You can rate it, and ratings show on the creator&apos;s market.
        </p>
        <p>Attnn. takes no fee from bids today. If that changes, we&apos;ll update these terms and tell you before it applies.</p>
      </LegalSection>

      <LegalSection id="creators" title="5. Creators">
        <ul>
          <li>Your market, bio, photo and replies must be yours and honest. Don&apos;t pretend to be someone else; verifying with X or LinkedIn shows bidders it&apos;s really you.</li>
          <li>Replies you send, including your saved template and any AI draft you approve, are your own words. You&apos;re responsible for them.</li>
          <li>If you let your agent accept bids automatically, it sends your saved template, and you&apos;re paid as if you sent it yourself.</li>
          <li>You can pause your market or stop accepting bids at any time. Bids already placed still follow the escrow rules.</li>
          <li>You&apos;re responsible for any tax on what you earn.</li>
        </ul>
      </LegalSection>

      <LegalSection id="agents" title="6. Agents and AI">
        <p>
          If you switch on a bidder agent, it bids for you within the budget, caps and settings you choose, and those bids are yours. The AI ranks creators and suggests drafts; it can be wrong,
          and we don&apos;t promise any creator is a good fit. Fixed rules, not the AI, decide amounts. What your agent can and can&apos;t do is listed on your dashboard and in{" "}
          <Link href="/about#agent-safety" className="text-arc-lavender hover:underline">
            How it works
          </Link>
          . Pause it any time.
        </p>
        <p>
          Outside developers can bid from their own wallets through our API. They hold their own keys, follow the same bid rules, and are responsible for their agents. Agents pay a small fee
          ($0.001) to read a creator&apos;s profile.
        </p>
      </LegalSection>

      <LegalSection id="conduct" title="7. What you must not do">
        <ul>
          <li>Send spam, scams, threats, harassment, or anything illegal or sexually explicit, in bids, replies or profiles.</li>
          <li>Use Attnn. to launder money, dodge sanctions or fund anything unlawful.</li>
          <li>Impersonate anyone, or run fake bids to inflate a market&apos;s numbers.</li>
          <li>Try to break, overload or get around the site&apos;s limits, or reach other people&apos;s data.</li>
        </ul>
        <p>
          We may remove content, pause a market or close an account that breaks these rules. Closing an account never takes USDC from you: escrowed bids still settle or refund under the
          contract&apos;s rules, and we&apos;ll help you move the rest out unless the law stops us.
        </p>
      </LegalSection>

      <LegalSection id="content" title="8. Your content">
        <p>
          You own what you write and upload. You let us store it, show it on Attnn. (for example your public market page) and pass it to the providers that run the service, only to run Attnn.
          How we handle your information is in our{" "}
          <Link href="/privacy" className="text-arc-lavender hover:underline">
            privacy policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="pauses" title="9. Pauses and changes to the service">
        <p>
          We can pause new bids if something looks wrong. Replies, declines and refunds keep working while bids are paused, and the escrow contract makes sure no pause can stop them. We may
          change or stop features, and we&apos;ll give notice before a change that affects money you&apos;ve put in.
        </p>
      </LegalSection>

      <LegalSection id="risks" title="10. Risks and no advice">
        <p>
          Blockchains, smart contracts, stablecoins and the services we depend on (such as Circle and Arc) can fail, slow down or change. We work hard to protect your money, but we can&apos;t
          promise the service will always be available or free of errors. Nothing on Attnn. is financial, legal or tax advice.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="11. Our responsibility to you">
        <p>
          We provide Attnn. &quot;as is&quot;. As far as the law allows, we aren&apos;t responsible for indirect losses, for what other users or their agents say or do, or for losses caused by
          things outside our control, and our total responsibility to you is limited to the fees you paid us in the 12 months before the claim. Nothing here limits responsibility the law
          doesn&apos;t let us limit, such as for fraud or for losing your escrowed USDC through our own negligence.
        </p>
      </LegalSection>

      <LegalSection id="law" title="12. Law, disputes and changes">
        <p>
          These terms are governed by the laws of the Federal Republic of Nigeria. If you have a problem, email us first and we&apos;ll try to sort it out; if we can&apos;t, the courts of
          Nigeria will decide. If we change these terms we&apos;ll update the date at the top, and email you before significant changes apply. Using Attnn. after that means you accept them.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
