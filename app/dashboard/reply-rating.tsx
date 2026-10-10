"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Tag } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/cn";
import type { BidData } from "./types";

const SOURCE_LABEL: Record<NonNullable<BidData["replySource"]>, string | null> = {
  creator: null, // the normal case: no tag
  template: "Auto-reply · template",
  ai: "Auto-reply · AI drafted",
};

/** Small "Auto-reply" tag for replies the creator didn't write themselves. */
export function ReplySourceTag({ source }: { source: BidData["replySource"] }) {
  const label = source ? SOURCE_LABEL[source] : null;
  return label ? <Tag>{label}</Tag> : null;
}

/**
 * 👍 / 👎 on a reply the bidder paid for. Only for bids that cleared on Arc.
 * Clicking the active button again clears the rating.
 */
export function ReplyRating({ bid }: { bid: BidData }) {
  const router = useRouter();
  const [rating, setRating] = React.useState<number | null>(bid.replyRating);
  const [saving, setSaving] = React.useState(false);

  if (bid.status !== "accepted" || !bid.settlementOnChainTxHash) return null;

  async function rate(next: "up" | "down") {
    const value = next === "up" ? 1 : -1;
    const send = rating === value ? null : next;
    const previous = rating;
    setRating(send === null ? null : value);
    setSaving(true);
    try {
      const res = await fetch("/api/bid/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId: bid.id, rating: send }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Try again");
      router.refresh();
    } catch (err) {
      setRating(previous);
      toast({ title: "Couldn't save your rating", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const btn = (kind: "up" | "down") => {
    const active = rating === (kind === "up" ? 1 : -1);
    const Icon = kind === "up" ? ThumbsUp : ThumbsDown;
    return (
      <button
        type="button"
        onClick={() => rate(kind)}
        disabled={saving}
        aria-pressed={active}
        aria-label={kind === "up" ? "This reply was worth it" : "This reply wasn't worth it"}
        className={cn(
          "focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border",
          active
            ? kind === "up"
              ? "border-green/50 bg-green/10 text-green"
              : "border-arc-coral/50 bg-arc-coral/10 text-arc-coral"
            : "border-border-bright text-text-secondary hover:text-text-primary",
        )}
      >
        <Icon aria-hidden className="h-3.5 w-3.5" />
      </button>
    );
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-text-secondary">{rating === null ? "Worth it?" : "Rated"}</span>
      {btn("up")}
      {btn("down")}
    </span>
  );
}
