"use client";

import type * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { BrandMark } from "./brand-mark";

const NAV = [
  { href: "/creators", label: "Markets" },
  { href: "/dashboard", label: "Portfolio" },
  { href: "/about", label: "How it works" },
];

/** Top bar shared by the market screens. `actions` replaces the sign-in / dashboard button. */
export function SiteHeader({ networkLabel, actions }: { networkLabel: string; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useSession();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-arc-bg-0/80 backdrop-blur-md supports-[backdrop-filter]:bg-arc-bg-0/70">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 sm:h-14 sm:flex-nowrap sm:px-6 sm:py-0">
        <Link href="/" className="focus-ring -ml-1 flex items-center gap-2 rounded-md px-1 text-text-primary">
          <BrandMark className="h-[22px] w-auto" />
          <span className="text-[17px] font-semibold tracking-[-0.04em]">attnn.</span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-border-bright sm:block" />
        <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-0.5 sm:order-none sm:mx-0 sm:w-auto">
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href === "/creators" && pathname.startsWith("/c/"));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring relative rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  active ? "bg-arc-bg-2 text-text-primary" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span
            title={`Connected to ${networkLabel}`}
            className="num hidden h-8 items-center gap-2 rounded-full border border-border bg-arc-bg-1 px-3 text-xs text-text-secondary md:inline-flex"
          >
            <span aria-hidden className="live-dot text-green" />
            {networkLabel}
          </span>
          {actions ?? (status === "loading" ? (
            // Session still loading: hold the space instead of flashing "Get started" at signed-in users.
            <span aria-hidden className="h-9 w-[104px] animate-pulse rounded-lg bg-arc-bg-2" />
          ) : status === "authenticated" ? (
            <Link
              key="portfolio"
              href="/dashboard"
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-bright bg-arc-bg-1 px-3.5 text-[13px] font-medium transition-colors hover:bg-arc-bg-2"
            >
              Portfolio
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5 text-text-secondary" />
            </Link>
          ) : (
            <Link key="get-started" href="/register" className="focus-ring btn-primary h-9 px-4 text-[13px]">
              Get started
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
