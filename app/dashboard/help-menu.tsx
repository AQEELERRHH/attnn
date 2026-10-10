"use client";

import Link from "next/link";
import { BookOpen, CircleHelp, Droplets, ListChecks, ShieldCheck } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Header "?" menu: reopen the welcome guide or the checklist, and the plain-English explainers. */
export function HelpMenu({
  onOpenGuide,
  onShowChecklist,
  checklistHidden,
  isTestnet,
}: {
  onOpenGuide: () => void;
  onShowChecklist: () => void;
  /** Dismissed but not finished: offer to bring it back. */
  checklistHidden: boolean;
  isTestnet: boolean;
}) {
  const item = "gap-2.5 py-2 text-text-primary";
  const icon = "h-4 w-4 text-text-secondary";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-arc-bg-2 hover:text-text-primary data-[state=open]:bg-arc-bg-2">
        <CircleHelp aria-hidden className="h-4 w-4" />
        <span className="sr-only">Help</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium">Help</DropdownMenuLabel>
        <DropdownMenuItem className={item} onSelect={onOpenGuide}>
          <BookOpen aria-hidden className={icon} />
          Welcome guide
        </DropdownMenuItem>
        {checklistHidden && (
          <DropdownMenuItem className={item} onSelect={onShowChecklist}>
            <ListChecks aria-hidden className={icon} />
            Show getting-started checklist
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={item} asChild>
          <Link href="/about#agent-safety">
            <ShieldCheck aria-hidden className={icon} />
            How your money is kept safe
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem className={item} asChild>
          <Link href="/about">
            <CircleHelp aria-hidden className={icon} />
            How Attnn. works &amp; FAQ
          </Link>
        </DropdownMenuItem>
        {isTestnet && (
          <DropdownMenuItem className={item} asChild>
            <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
              <Droplets aria-hidden className={icon} />
              Get free test USDC
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
