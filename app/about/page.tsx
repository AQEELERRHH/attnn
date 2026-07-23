import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-arc-bg-0">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-arc-bg-0/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center text-xs font-display font-bold">A</span>
            <span className="font-display font-bold text-xl">attnn.</span>
          </Link>
          <Link href="/">
            <Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-32 pb-20">

        {/* Header */}
        <div className="mb-16 text-center">
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
            What is <span className="gold-gradient">Attnn.</span>?
          </h1>
          <p className="text-text-secondary text-lg">
            A simple explanation.
          </p>
        </div>

        {/* The Problem */}
        <section className="mb-12">
          <h2 className="text-2xl font-display font-bold mb-4 text-arc-gold">The Problem</h2>
          <Card className="p-6">
            <p className="text-text-secondary leading-relaxed mb-4">
              Every day, thousands of professionals; developers, designers, writers, consultants get flooded with messages from people wanting their time and attention. Most of these messages are low quality, irrelevant, or outright spam.
            </p>
            <p className="text-text-secondary leading-relaxed mb-4">
              At the same time, companies and individuals who genuinely need to reach these professionals have no reliable way to stand out. They send cold emails, LinkedIn DMs, and Twitter messages but they get ignored along with everyone else.
            </p>
            <p className="text-text-secondary leading-relaxed">
              The result: talented people waste time filtering noise, and serious opportunities get missed by both sides.
            </p>
            <div className="mt-6 p-4 rounded-lg bg-arc-bg-2/50 border border-border">
              <p className="text-sm text-text-secondary italic">
                <span className="text-arc-coral font-medium">Example:</span> Sarah is a senior Solidity developer. She gets 50 LinkedIn messages a week from recruiters. Most are copy-paste templates. She ignores all of them including the one from a startup that would have paid her double her current salary.
              </p>
            </div>
          </Card>
        </section>

        {/* The Idea */}
        <section className="mb-12">
          <h2 className="text-2xl font-display font-bold mb-4 text-arc-gold">The Idea</h2>
          <Card className="p-6">
            <p className="text-text-secondary leading-relaxed mb-4">
              What if reaching someone cost real money and they only got paid if they actually replied?
            </p>
            <p className="text-text-secondary leading-relaxed mb-4">
              That is the core idea behind Attnn. If you want someone&apos;s attention, you put money behind it. If they reply, they earn that money. If they don&apos;t reply within 14 days, you get a full refund automatically.
            </p>
            <p className="text-text-secondary leading-relaxed">
              This one change does two things: it filters out low-effort outreach (because spam is free but Attnn. is not), and it compensates people for their most valuable asset, their time and attention.
            </p>
            <div className="mt-6 p-4 rounded-lg bg-arc-bg-2/50 border border-border">
              <p className="text-sm text-text-secondary italic">
                <span className="text-arc-gold font-medium">Example:</span> A startup wants to hire Sarah. On Attnn., they place a $10 USDC bid with their message. Sarah sees it in her inbox ranked above all other bids by amount and AI quality score. She reads it, replies, and earns $10 instantly. The startup gets her attention. Everyone wins.
              </p>
            </div>
          </Card>
        </section>

        {/* The Solution */}
        <section className="mb-12">
          <h2 className="text-2xl font-display font-bold mb-4 text-arc-gold">The Solution</h2>
          <Card className="p-6">
            <p className="text-text-secondary leading-relaxed mb-4">
              Attnn. is a two-sided marketplace with two types of users:
            </p>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="p-4 rounded-lg border border-arc-gold/30 bg-arc-bg-2/30">
                <h3 className="font-display font-bold mb-2 text-arc-gold">Creators & Professionals</h3>
                <p className="text-sm text-text-secondary">Anyone whose time has value; developers, designers, writers, founders, experts. You register your profile, set your minimum bid price, and receive an AI-ranked inbox of bids. You reply to the ones worth your time and earn USDC instantly.</p>
              </div>
              <div className="p-4 rounded-lg border border-arc-purple/30 bg-arc-bg-2/30">
                <h3 className="font-display font-bold mb-2 text-arc-purple">Companies & Bidders</h3>
                <p className="text-sm text-text-secondary">Anyone who needs to reach professionals: recruiters, founders, investors, marketers. You deploy an AI agent with a goal and budget. The agent finds matching creators automatically, places bids, and works around the clock without you lifting a finger.</p>
              </div>
            </div>
            <p className="text-text-secondary leading-relaxed">
              The money sits in a secure escrow contract on Arc a blockchain built by Circle, the company behind USDC. Nobody can touch it until the creator replies. If they don&apos;t reply in 14 days, it goes back to the sender automatically. No disputes, no middlemen, no trust required.
            </p>
          </Card>
        </section>

        {/* The Technology */}
        <section className="mb-12">
          <h2 className="text-2xl font-display font-bold mb-4 text-arc-gold">The Technology</h2>
          <Card className="p-6">
            <p className="text-text-secondary leading-relaxed mb-6">
              You don&apos;t need to understand the technology to use Attnn. But if you&apos;re curious, here is what powers it, explained simply.
            </p>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center shrink-0 text-arc-gold font-bold text-sm">1</div>
                <div>
                  <h4 className="font-medium mb-1">USDC: Digital Dollars</h4>
                  <p className="text-sm text-text-secondary">All payments on Attnn. use USDC a digital version of the US dollar that is always worth exactly $1. No price swings, no volatility. When you earn $5, you have $5.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center shrink-0 text-arc-gold font-bold text-sm">2</div>
                <div>
                  <h4 className="font-medium mb-1">Arc: The Settlement Layer</h4>
                  <p className="text-sm text-text-secondary">Arc is a blockchain built by Circle that settles transactions in under one second. When a bid is accepted, USDC moves from the bidder&apos;s wallet to the creator&apos;s wallet almost instantly no bank transfers, no waiting days.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center shrink-0 text-arc-gold font-bold text-sm">3</div>
                <div>
                  <h4 className="font-medium mb-1">Circle Wallets: No Crypto Setup Needed</h4>
                  <p className="text-sm text-text-secondary">When you sign up with Google, Attnn. creates a secure digital wallet for you automatically in the background. You never need to install MetaMask, write down seed phrases, or touch any crypto interface. It just works.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center shrink-0 text-arc-gold font-bold text-sm">4</div>
                <div>
                  <h4 className="font-medium mb-1">AI Agents: Your Autonomous Representatives</h4>
                  <p className="text-sm text-text-secondary">Instead of manually searching and messaging creators one by one, companies deploy an AI agent with a goal and budget. The agent works 24/7 discovering, scoring, and bidding on matching creators automatically. No human clicks required per transaction.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center shrink-0 text-arc-gold font-bold text-sm">5</div>
                <div>
                  <h4 className="font-medium mb-1">Smart Contracts: Trustless Escrow</h4>
                  <p className="text-sm text-text-secondary">The bid money is held by a smart contract a piece of code that runs on Arc and cannot be changed or manipulated by anyone, including Attnn. The rules are: reply and earn, or ignore and the sender gets a refund. No exceptions, no loopholes.</p>
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* Real World Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-display font-bold mb-4 text-arc-gold">Real World Examples</h2>
          <div className="space-y-4">
            <Card className="p-6 border-l-4 border-l-arc-gold">
              <h3 className="font-display font-bold mb-2">The Startup Hiring a Developer</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                A Lagos-based fintech startup needs a smart contract developer urgently. They deploy a bidder agent on Attnn. with the goal "find experienced Solidity developers" and a $50/day budget. The agent searches the registry, finds 3 matching developers, scores them, and places $15 bids on each all within 10 minutes. One developer replies within an hour. The startup has a conversation. The developer earns $15 just for replying.
              </p>
            </Card>
            <Card className="p-6 border-l-4 border-l-arc-purple">
              <h3 className="font-display font-bold mb-2">The Content Creator Getting Paid for Brand Deals</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                A Web3 content creator with 10,000 followers sets up a creator profile on Attnn. with a $20 minimum bid. Instead of getting 100 free DMs from brands asking for free promotion, they now receive bids from brands willing to pay to start a conversation. They reply to the ones that match their content, earn USDC, and ignore the rest which get auto-refunded.
              </p>
            </Card>
            <Card className="p-6 border-l-4 border-l-arc-coral">
              <h3 className="font-display font-bold mb-2">The Investor Finding Deal Flow</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                An angel investor wants to meet early-stage founders building in Web3. They set up a bidder agent with the goal "find founders building on Arc or Ethereum" and a $100/day budget. The agent runs every 10 minutes, finds matching founders registered on Attnn., and places bids automatically. Serious founders reply. The investor gets warm introductions to 5 founders per week without sending a single cold message.
              </p>
            </Card>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-12">
          <h2 className="text-2xl font-display font-bold mb-4 text-arc-gold">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {[
              {
                q: "What service is actually being exchanged on Attnn.?",
                a: "Attention and a genuine reply. When a creator accepts a bid, they are agreeing to read the message and write a meaningful response. The service is human attention not a deliverable, not a project, not a task. Think of it as paying for a coffee meeting, except it settles in under a second on Arc."
              },
              {
                q: "How is this different from cold email or LinkedIn DMs?",
                a: "Cold email and DMs are free, so anyone can send unlimited spam with zero consequences. On Attnn., every message costs real money. The sender only pays if the creator replies, so there is automatic quality control. Creators only see messages from people willing to back their interest with USDC."
              },
              {
                q: "What happens if a creator never replies?",
                a: "After 14 days with no reply, the full bid amount is automatically refunded to the sender by a smart contract. No request needed, no dispute process, no human intervention. The code handles it automatically."
              },
              {
                q: "Who are the AI agents and what do they actually do?",
                a: "A bidder agent is a software program that runs on your behalf. You tell it your goal (e.g. find senior React developers), your daily budget (e.g. $20/day), and search tags (e.g. react, frontend, web3). Every 10 minutes, the agent searches the registry for matching creators, scores each one for fit using AI, and places bids on the best matches all without you clicking anything."
              },
              {
                q: "Do I need to know anything about crypto to use Attnn.?",
                a: "No. You sign in with Google. A wallet is created for you automatically. You fund it with testnet USDC from a faucet (free on testnet). Everything else, the blockchain, the smart contracts, the escrow happens invisibly in the background. You just see a normal web app."
              },
              {
                q: "How much does it cost to place a bid?",
                a: "The minimum bid depends on the amount the creator sets. You can bid more to stand out in a creator's inbox , higher bids rank higher. Gas fees (the cost of running transactions on Arc) are paid in USDC too, so you never need any other token. On testnet, all USDC is free from the faucet."
              },
              {
                q: "Is my money safe when I place a bid?",
                a: "Yes. Your bid goes into a smart contract escrow not to Attnn., not to the creator. The contract holds it until one of two things happens: the creator replies (then it goes to them) or 14 days pass with no reply (then it comes back to you). Nobody can touch it in between."
              },
              {
                q: "Can I be both a creator and a bidder?",
                a: "Yes. Many users are both. You can register a creator profile to receive bids on your attention, and also deploy a bidder agent to reach other creators. The same wallet handles both sides."
              },
              { 
                q: "What is USDC and why does Attnn. use it?",
                a: "USDC is a digital dollar always worth exactly $1. Unlike Bitcoin or Ethereum which change in price every minute, USDC is stable. When someone bids $5 on your attention, you earn exactly $5. Attnn. uses USDC because it makes the economics simple and predictable for everyone."
              },
              {
                q: "Is Attnn. live?",
                a: "Attn. is currently live on Arc Testnet a test environment where USDC has no real monetary value. This lets builders and early users test everything safely. Mainnet launch follows Arc Network going live. The protocols v1(pitchslotarc.vercel.app) has already processed 500+ transactions in testing."
              },
              {
                q: "How do you make sure a reply is actually meaningful and not just thanks bye?",
                a: "Three layers: First, the smart contract requires a minimum of 10 characters to accept a bid,  so empty one-word replies are blocked at the contract level. Second, the marketplace self-regulates: creators who give low-quality replies will get fewer bids over time as bidders stop returning to them. Third, a creator-side AI agent will score incoming replies for quality before releasing funds, and creators with a pattern of low-quality replies will be flagged in their public profile."
              },
            ].map(({ q, a }) => (
              <Card key={q} className="p-6">
                <h3 className="font-display font-semibold mb-2 text-sm">{q}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{a}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="text-center">
          <h2 className="text-2xl font-display font-bold mb-4">Ready to try it?</h2>
          <p className="text-text-secondary mb-6">Sign in with Google. Your wallet is ready in seconds.</p>
          <Link href="/register">
            <Button size="lg">Get Started <ArrowRight className="ml-2 w-4 h-4" /></Button>
          </Link>
        </div>

      </div>
    </div>
  );
}
