import { auth } from "@/lib/auth";
import Link from "next/link";
import { Bot, Lock, Wallet } from "lucide-react";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/market/site-header";
import { arc } from "@/lib/chain";
import RegisterForm from "./register-form";

export const metadata = { title: "Sign in · Attnn." };

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-arc-bg-0">
      {/* No "Get started" button here: this is where it leads. */}
      <SiteHeader networkLabel={arc.chain.name} actions={<></>} />
      <main className="relative isolate">
        <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 -z-10" />
        <div className="mx-auto grid max-w-[1080px] items-center gap-12 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <div>
            <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.04em]">Sign in to Attnn.</h1>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              New here? Signing in creates your account and a Circle wallet on {arc.chain.name}. No seed phrase, no extension.
            </p>
            <div className="mt-6">
              <RegisterForm />
            </div>
            <p className="mt-4 text-xs text-text-secondary">One account works on both sides: bid on creators and run your own market.</p>
            <p className="mt-3 text-xs text-text-secondary">
              By continuing you agree to our{" "}
              <Link href="/terms" className="text-arc-lavender hover:underline">
                terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-arc-lavender hover:underline">
                privacy policy
              </Link>
              .
            </p>
          </div>

          <aside aria-label="What you get" className="hidden lg:block">
            <div className="panel-raised overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <span className="text-sm font-medium">What signing in sets up</span>
                <span className="num inline-flex items-center gap-1.5 text-xs text-text-secondary">
                  <span aria-hidden className="live-dot text-green" />
                  {arc.chain.name}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {[
                  { icon: Wallet, title: "A Circle wallet", body: "Created for you on Arc. USDC is the gas token, so fees are in dollars." },
                  { icon: Lock, title: "Escrowed bids", body: "Your USDC waits in the AttnnEscrow contract until the creator replies, declines or 3 days pass." },
                  { icon: Bot, title: "Your own agents", body: "A bidder agent with a budget you set, and a creator agent that triages your inbox." },
                ].map((f) => (
                  <li key={f.title} className="flex gap-4 px-5 py-4">
                    <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border-bright bg-arc-bg-2">
                      <f.icon aria-hidden className="h-4 w-4 text-arc-gold" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{f.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-text-secondary">{f.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
