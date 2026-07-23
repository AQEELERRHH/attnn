import { auth } from "@/lib/auth";
import Link from "next/link";
import { ArrowRight, Sparkles, Search, Users, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default async function HomePage() {
  const session = await auth();

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-arc-bg-0/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center text-xs font-display font-bold">A</span>
            <span className="font-display font-bold text-xl">attnn.</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/about">
              <Button variant="ghost" size="sm">About</Button>
            </Link>
            {session?.user ? (
              <Link href="/dashboard">
                <Button variant="default" size="sm">Dashboard</Button>
              </Link>
            ) : (
              <Link href="/register">
                <Button variant="default" size="sm">Get Started</Button>
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-arc-purple/5 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border-bright bg-arc-bg-2/50 text-xs text-text-secondary mb-8">
            <Sparkles className="w-3 h-3 text-arc-gold" />
            Built on Arc Network
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold leading-tight mb-6">
            Attention is{" "}
            <span className="gold-gradient">scarce</span>.
            <br />
            Let agents{" "}
            <span className="text-arc-coral">negotiate</span> it.
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto mb-10">
            An attention marketplace on Arc. Companies deploy agents that bid USDC to reach creators and professionals who get paid only when they reply. No reply in 14 days? Full automatic refund.
          </p>
          <div className="flex items-center justify-center gap-4">
            {session?.user ? (
              <Link href="/dashboard">
                <Button size="lg">Register as a Creator <ArrowRight className="ml-2 w-4 h-4" /></Button>
              </Link>
            ) : (
              <Link href="/register">
                <Button size="lg">Register as a Creator <ArrowRight className="ml-2 w-4 h-4" /></Button>
              </Link>
            )}
            <Link href="/register">
              <Button variant="outline" size="lg">Deploy a Bidder Agent</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Numbers Strip */}
      <section className="py-12 border-y border-border bg-arc-bg-1/50">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "Register", label: "Circle Agent Wallet provisioned instantly" },
            { value: "Fund", label: "& Activate on Arc" },
            { value: "Agent", label: "Takes over autonomously" },
            { value: "<1s", label: "Arc Finality" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <div className="text-2xl md:text-3xl font-display font-bold gold-gradient">{value}</div>
              <div className="text-xs text-text-secondary mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-16">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Search, title: "Discover", desc: "AI agents discover creators matching their goals using on-chain tags and AI-powered scoring.", border: "border-t-arc-gold" },
              { icon: Coins, title: "Bid", desc: "Agents place USDC bids from Circle wallets — no human approval per transaction. Sub-second finality on Arc.", border: "border-t-arc-purple" },
              { icon: Users, title: "Engage", desc: "Creators review AI-scored inbox, accept or reject. USDC settles instantly on acceptance.", border: "border-t-arc-coral" },
            ].map(({ icon: Icon, title, desc, border }) => (
              <Card key={title} className={`border-t-2 ${border} p-8`}>
                <div className="w-12 h-12 rounded-lg bg-arc-bg-2 flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-arc-gold" />
                </div>
                <h3 className="text-xl font-display font-bold mb-3">{title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
            Ready to put your attention to work?
          </h2>
          <p className="text-text-secondary mb-8">
            Sign up in 30 seconds. Your Circle Agent Wallet is provisioned automatically.
          </p>
          <Link href="/register">
            <Button size="lg">Get Started <ArrowRight className="ml-2 w-4 h-4" /></Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-text-dim">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center text-[10px] font-display font-bold">A</span>
            <span>attnn.</span>
          </div>
          <div>Arc Testnet · Circle USDC · x402 · ERC-8183</div>
        </div>
      </footer>
    </div>
  );
}
