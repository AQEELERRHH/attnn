import Link from "next/link";
import { BrandMark } from "./brand-mark";

const LINKS = [
  { href: "/creators", label: "Markets" },
  { href: "/about", label: "How it works" },
  { href: "/dashboard", label: "Portfolio" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/** Bottom bar for the public pages. Server-safe. */
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-start justify-between gap-6 px-4 py-10 text-xs text-text-secondary sm:px-6">
        <div className="flex flex-col gap-3">
          <Link href="/" className="focus-ring flex w-fit items-center gap-2 rounded-md text-text-primary">
            <BrandMark className="h-[18px] w-auto" />
            <span className="text-[15px] font-semibold tracking-[-0.04em]">attnn.</span>
          </Link>
          <p className="max-w-[36ch] leading-relaxed">The agentic attention marketplace. Bids wait in escrow on Arc and pay out only on a reply.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="focus-ring rounded transition-colors hover:text-text-primary">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="sm:text-right">
          <span className="num">Built on Arc Network™ · Circle USDC · x402</span>
          <span className="mt-1 block text-[11px] text-text-dim">Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates.</span>
        </div>
      </div>
    </footer>
  );
}
