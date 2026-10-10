"use client";

import type * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
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
    <header className="border-b border-border bg-arc-bg-1">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-md text-text-primary">
          <BrandMark className="h-7 w-auto" />
          <span className="font-display text-xl font-extrabold tracking-tight">attnn.</span>
        </Link>
        <nav aria-label="Main" className="order-3 flex w-full gap-1 sm:order-none sm:w-auto">
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href === "/creators" && pathname.startsWith("/c/"));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring rounded-lg px-3 py-2 text-sm",
                  active ? "bg-arc-bg-2 font-medium text-text-primary" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-border-bright px-2.5 py-1 text-xs text-arc-lavender sm:inline-flex">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
            {networkLabel}
          </span>
          {actions ?? (status === "authenticated" ? (
            <Link href="/dashboard" className="focus-ring rounded-lg border border-border-bright px-3.5 py-2 text-sm font-medium hover:bg-arc-bg-2">
              Dashboard
            </Link>
          ) : (
            <Link
              href="/register"
              className="focus-ring rounded-lg bg-arc-gold px-3.5 py-2 font-display text-sm font-bold text-arc-bg-0 hover:brightness-110"
            >
              Get started
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
