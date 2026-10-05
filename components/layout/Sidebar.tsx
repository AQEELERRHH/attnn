"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, Bot, MessageCircle, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/creators", icon: Compass, label: "Discover" },
  { href: "/dashboard?tab=bidder", icon: Bot, label: "My Agents" },
  { href: "/dashboard?tab=offers", icon: MessageCircle, label: "Messages" },
  { href: "/dashboard?tab=bids", icon: ArrowLeftRight, label: "Transactions" },
];

export function Sidebar({ pendingOfferCount = 0 }: { pendingOfferCount?: number }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 min-h-screen border-r border-border bg-arc-bg-1/60 sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-border">
        <img src="/attnn-logo.jpeg" alt="Attnn." className="w-7 h-7 rounded-lg object-cover" />
        <span className="font-display font-bold text-lg tracking-tight">attnn.</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href.split("?")[0] || (href.includes("tab=") && typeof window !== "undefined" && window.location.href.includes(href.split("?")[1] ?? ""));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative",
                isActive
                  ? "bg-arc-bg-3 text-text-primary"
                  : "text-text-secondary hover:text-text-primary hover:bg-arc-bg-2/60"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
              {label === "Messages" && pendingOfferCount > 0 && (
                <span className="ml-auto bg-arc-gold text-arc-bg-0 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {pendingOfferCount > 9 ? "9+" : pendingOfferCount}
                </span>
              )}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-arc-gold rounded-r-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="text-xs text-text-dim text-center">Arc Testnet</div>
      </div>
    </aside>
  );
}
