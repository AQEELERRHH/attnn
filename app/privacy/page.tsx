import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT, LegalPage, LegalSection } from "@/components/market/legal-page";
import { arc } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Privacy · Attnn.",
  description: "What Attnn. collects, why, who else sees it, and what you can ask us to do with it.",
};

/*
 * Keep this page true to the code: lib/db/schema.ts (what is stored), lib/auth.ts (sign-in),
 * lib/ai.ts (what reaches the AI), lib/escrow.ts + AttnnEscrow.sol (what goes on-chain),
 * lib/social-verify.ts (verification), lib/onramp.ts (card purchases). Needs legal review
 * before Attnn. is incorporated; then name the company in "Who we are".
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="10 November 2026"
      networkLabel={arc.chain.name}
      intro={
        <p>
          This explains what Attnn. collects when you use attnn.xyz, why, who else sees it, and what you can ask us to do with it. Short version: we keep what we need to run your account and move your
          bids, we don&apos;t sell anything about you, and we don&apos;t use advertising or analytics trackers. Some things you do are recorded on a public blockchain, and those can&apos;t be deleted
          by anyone.
        </p>
      }
    >
      <LegalSection id="who" title="Who we are">
        <p>
          Attnn. is run from Nigeria by its founder. We decide how your information is used, so under Nigeria&apos;s Data Protection Act 2023 we are the data controller. Questions or requests:{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="text-arc-lavender hover:underline">
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <ul>
          <li>
            <strong>Your account.</strong> Your email address, and your name and profile picture if you sign in with Google. Sign-in sessions, and the role you pick when you start (bidder,
            creator or both).
          </li>
          <li>
            <strong>Your wallets.</strong> We create USDC wallets for you through Circle and record their addresses. We read their balances from the blockchain.
          </li>
          <li>
            <strong>Your creator market</strong>, if you open one: handle, bio, tags, what you&apos;re open to, your minimum bid, market photo, reply template and auto-accept setting.
          </li>
          <li>
            <strong>Account verification</strong>, if you verify with X or LinkedIn: the account&apos;s id and its username (X) or name (LinkedIn). We use the sign-in once to read that and then
            throw the access token away.
          </li>
          <li>
            <strong>Bids and replies.</strong> Amounts, messages, replies, counter-offers, ratings, their status and the transactions behind them. For a creator, any reply the AI drafted for
            you.
          </li>
          <li>
            <strong>Your bidder agent</strong>, if you use it: its settings (budget, caps, tags, goal, minimum score) and a record of every decision it made and why.
          </li>
          <li>
            <strong>Money leaving your wallet.</strong> Sends, the addresses you send to, top-ups of your agent wallet, and security codes (stored only as a scrambled hash, valid 10 minutes).
          </li>
          <li>
            <strong>Paid profile reads.</strong> When a software agent pays $0.001 to read a creator&apos;s profile, we keep the payment receipt, including the paying wallet.
          </li>
          <li>
            <strong>Abuse protection.</strong> Counts of requests per account or per internet address, so we can slow down anyone hammering the site. Server logs our hosting provider keeps for
            a short time.
          </li>
        </ul>
        <p>We don&apos;t collect card details. If you buy USDC with a card, that happens in Circle&apos;s checkout window, and Circle handles the payment and any identity checks.</p>
      </LegalSection>

      <LegalSection id="why" title="Why we use it">
        <ul>
          <li>To run your account, sign you in, and show you your portfolio, inbox and agent activity.</li>
          <li>To place, settle and refund bids, and to check every money movement against your limits (this is our contract with you).</li>
          <li>To send emails you need: sign-in links, security codes, and notices when money leaves your wallet or your agent is switched on.</li>
          <li>To keep the service safe: spotting fraud, enforcing spending limits, and checking that our records match the blockchain.</li>
          <li>
            To show your creator market publicly, if you open one. That&apos;s the point of a market, and you can pause it or stop accepting bids any time.
          </li>
        </ul>
        <p>We don&apos;t sell your information, and we don&apos;t use it for advertising.</p>
      </LegalSection>

      <LegalSection id="public" title="What is public">
        <p>
          <strong>Your creator market page</strong> (attnn.xyz/c/your-handle) shows your handle, bio, tags, photo, minimum bid, verification badge and market statistics such as reply rate and
          ratings. Software agents can read the same profile for a small fee.
        </p>
        <p>
          <strong>The blockchain.</strong> Bids are held by a smart contract on Arc, a public blockchain. Anyone can see wallet addresses, bid amounts, times, and whether a bid was accepted,
          declined or refunded. A creator&apos;s handle, tags and minimum bid are also stored there. Bid messages and replies are <em>not</em> written to the blockchain as text: only a
          fingerprint that proves which text was sent. Nothing on a blockchain can be changed or deleted, by us or anyone else.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="The AI">
        <p>
          Attnn.&apos;s agents use an AI model from AISA to score creators for bidders and to score and draft replies to bids for creators. To do that we send it the creator&apos;s handle, bio and
          tags, and for creators, the bid message. We don&apos;t send it your email, wallets or balances. The AI only gives a score or a draft: fixed rules, not the AI, decide whether money moves.
        </p>
      </LegalSection>

      <LegalSection id="share" title="Who else handles it">
        <p>We use these providers to run Attnn. They only get what they need for their part:</p>
        <ul>
          <li>
            <strong>Circle</strong>: creates and signs for your wallets, runs the payment network for profile reads, and runs card checkout.
          </li>
          <li>
            <strong>Supabase</strong>: our database and photo storage.
          </li>
          <li>
            <strong>Vercel</strong>: hosts the website.
          </li>
          <li>
            <strong>Inngest</strong>: runs background jobs such as placing bids and refunds.
          </li>
          <li>
            <strong>Resend</strong>: sends our emails.
          </li>
          <li>
            <strong>AISA</strong>: the AI model (see above).
          </li>
          <li>
            <strong>Google, X and LinkedIn</strong>: only if you choose to sign in or verify with them.
          </li>
        </ul>
        <p>
          Some of these providers store data outside Nigeria, mostly in the United States and the European Union. We pick providers that protect it, and we&apos;d tell a regulator or court only
          what the law requires us to.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies">
        <p>
          We use only the cookies the site needs to work: one that keeps you signed in, security cookies for sign-in, and a short-lived one (10 minutes) while you verify an X or LinkedIn
          account. Your browser also remembers one small note on your device about whether you&apos;ve funded your wallet. No advertising or analytics cookies.
        </p>
      </LegalSection>

      <LegalSection id="keep" title="How long we keep it">
        <p>
          We keep your account information while your account is open. Bid, payment and wallet records are kept after that for as long as we need them to settle disputes, prevent fraud and meet
          legal and accounting duties. Sign-in links expire after an hour and security codes after 10 minutes. Anything on the blockchain stays there permanently.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="Your rights">
        <p>Under the Nigeria Data Protection Act 2023 you can ask us to:</p>
        <ul>
          <li>tell you what we hold about you, and give you a copy;</li>
          <li>correct anything that&apos;s wrong;</li>
          <li>delete your information, apart from what we must keep (see above) and what is on the blockchain;</li>
          <li>stop or limit some uses of it, or move it to another service.</li>
        </ul>
        <p>
          Email{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="text-arc-lavender hover:underline">
            {LEGAL_CONTACT}
          </a>{" "}
          from the address on your account. Before closing an account, move your USDC out: once it&apos;s closed we can&apos;t help you reach those wallets. If you&apos;re unhappy with how we
          handled a request, you can complain to the Nigeria Data Protection Commission.
        </p>
      </LegalSection>

      <LegalSection id="safety" title="Keeping it safe">
        <p>
          Access to our database is restricted to the app itself, security codes are stored hashed, and money leaving a wallet is capped and checked. No system is perfectly secure, so please
          keep your email account safe: it&apos;s how you sign in. How our agents are limited is explained in{" "}
          <Link href="/about#agent-safety" className="text-arc-lavender hover:underline">
            How it works
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="age" title="Age">
        <p>Attnn. is for people 18 and over. We don&apos;t knowingly collect information from anyone younger; if you think we have, tell us and we&apos;ll delete it.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>If we change this policy we&apos;ll update the date at the top, and for significant changes we&apos;ll email you before they apply.</p>
      </LegalSection>
    </LegalPage>
  );
}
