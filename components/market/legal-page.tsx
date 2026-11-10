import type * as React from "react";
import Link from "next/link";
import { SiteHeader } from "./site-header";

/** Where people write to about privacy, the terms or their account. One place to change it. */
export const LEGAL_CONTACT = "asmau@attnn.xyz";

/** Shared layout for /privacy and /terms: plain reading column, no sideways scroll at 320 px. */
export function LegalPage({
  title,
  updated,
  networkLabel,
  intro,
  children,
}: {
  title: string;
  updated: string;
  networkLabel: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-arc-bg-0">
      <SiteHeader networkLabel={networkLabel} />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <p className="eyebrow">Last updated {updated}</p>
        <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{title}</h1>
        <div className="mt-4 text-[15px] leading-relaxed text-text-secondary">{intro}</div>
        <div className="mt-10 flex flex-col gap-10">{children}</div>
        <nav aria-label="Legal" className="mt-14 flex flex-wrap gap-4 border-t border-border pt-6 text-sm text-text-secondary">
          <Link href="/privacy" className="focus-ring rounded hover:text-text-primary">
            Privacy
          </Link>
          <Link href="/terms" className="focus-ring rounded hover:text-text-primary">
            Terms
          </Link>
          <Link href="/about" className="focus-ring rounded hover:text-text-primary">
            How it works
          </Link>
          <a href={`mailto:${LEGAL_CONTACT}`} className="focus-ring rounded break-all hover:text-text-primary">
            {LEGAL_CONTACT}
          </a>
        </nav>
      </main>
    </div>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <h2 id={`${id}-title`} className="font-display text-xl font-bold text-text-primary">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-text-secondary [&_li]:pl-1 [&_strong]:text-text-primary [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
