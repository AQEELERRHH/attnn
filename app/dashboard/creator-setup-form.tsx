"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/market";
import { toast } from "@/hooks/use-toast";
import { ESCROW_MAX_BID, ESCROW_MIN_BID } from "@/lib/bid-rules";
import { atomicToDollarInput, dollarsToAtomic } from "@/lib/format";
import type { ProfileData } from "./types";

export const fieldClass =
  "focus-ring w-full rounded-lg border border-border-bright bg-arc-bg-0 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-dim";
export const labelClass = "mb-1.5 block text-xs text-arc-lavender";

const DEFAULT_TEMPLATE =
  "Thanks for reaching out! I've reviewed your bid and I'm happy to connect. Looking forward to hearing more — reach out on WhatsApp: +2319023XXXXXXX";

const splitList = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

/** Create (then register on Arc) or edit a creator market. */
export function CreatorSetupForm({
  existingProfile,
  onComplete,
  onCancel,
}: {
  existingProfile: ProfileData | null;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const isEdit = !!existingProfile;
  const [handle, setHandle] = React.useState(existingProfile?.handle ?? "");
  const [minBid, setMinBid] = React.useState(
    existingProfile ? atomicToDollarInput(BigInt(existingProfile.minBid || "0")) : "5.00",
  );
  const [tags, setTags] = React.useState(existingProfile?.tags?.join(", ") ?? "");
  const [bio, setBio] = React.useState(existingProfile?.bio ?? "");
  const [autoReplyTemplate, setAutoReplyTemplate] = React.useState(existingProfile?.autoReplyTemplate ?? DEFAULT_TEMPLATE);
  const [availabilityStatus, setAvailabilityStatus] = React.useState(existingProfile?.availabilityStatus ?? "available");
  const [openTo, setOpenTo] = React.useState(existingProfile?.openTo?.join(", ") ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const floor = dollarsToAtomic(minBid);
  const floorError =
    floor === null
      ? "Enter an amount like 5 or 12.50."
      : floor < ESCROW_MIN_BID
        ? "The lowest floor is $5.00."
        : floor > ESCROW_MAX_BID
          ? "The highest floor is $1,000.00."
          : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (floorError || floor === null) return;
    setLoading(true);
    setError("");
    const payload = {
      handle: handle.trim(),
      minBid: floor.toString(),
      tags: splitList(tags),
      bio: bio || null,
      autoReplyTemplate: autoReplyTemplate || null,
      availabilityStatus,
      openTo: splitList(openTo),
    };
    try {
      if (isEdit) {
        // Profile edits are DB-only; no on-chain re-registration needed.
        const res = await fetch("/api/profile/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          toast({ title: "Market updated", variant: "success" });
          onComplete();
        } else {
          setError(data.error ?? "Failed to update profile");
        }
      } else {
        const res = await fetch("/api/profile/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.success) {
          setError(data.error ?? "Failed to create profile");
          return;
        }
        const activateRes = await fetch("/api/profile/activate", { method: "POST" });
        const activateData = await activateRes.json().catch(() => ({}));
        if (activateData.success) {
          toast({ title: "Market open", description: "Registered on Arc", variant: "success" });
          onComplete();
        } else {
          // The profile row exists now, so close the form: the market card shows
          // "Activate on Arc" and the reason stays visible in the toast.
          toast({
            title: "Profile saved, not registered yet",
            description:
              activateData.code === "INSUFFICIENT_FUNDS"
                ? activateData.error + " Then press Activate on Arc."
                : "On-chain registration failed: " + (activateData.error ?? "Unknown error"),
            variant: "destructive",
          });
          onComplete();
        }
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      raised
      title={isEdit ? "Edit your market" : "Open your creator market"}
      description={
        isEdit
          ? "Changes show on your market page right away."
          : "Bidders escrow USDC to reach you. You earn it by replying; no reply in 3 days refunds them."
      }
    >
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cs-handle" className={labelClass}>
            Handle
          </label>
          <input id="cs-handle" className={fieldClass} placeholder="your-handle" value={handle} onChange={(e) => setHandle(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="cs-floor" className={labelClass}>
            Floor price (USDC)
          </label>
          <input
            id="cs-floor"
            inputMode="decimal"
            className={`${fieldClass} num`}
            placeholder="5.00"
            value={minBid}
            onChange={(e) => setMinBid(e.target.value)}
            aria-invalid={!!floorError}
            required
          />
          {floorError ? (
            <p className="mt-1 text-xs text-arc-coral">{floorError}</p>
          ) : (
            <p className="mt-1 text-xs text-text-secondary">The lowest bid you&apos;ll accept. $5.00 to $1,000.00.</p>
          )}
        </div>
        <div>
          <label htmlFor="cs-tags" className={labelClass}>
            Tags (comma-separated)
          </label>
          <input id="cs-tags" className={fieldClass} placeholder="ai, crypto, design" value={tags} onChange={(e) => setTags(e.target.value)} />
          <p className="mt-1 text-xs text-text-secondary">Bidder agents discover you by these.</p>
        </div>
        <div>
          <label htmlFor="cs-avail" className={labelClass}>
            Availability
          </label>
          <select id="cs-avail" value={availabilityStatus} onChange={(e) => setAvailabilityStatus(e.target.value)} className={fieldClass}>
            <option value="available">Accepting bids</option>
            <option value="limited">Limited availability</option>
            <option value="not_accepting">Not accepting bids (market paused)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="cs-bio" className={labelClass}>
            Bio
          </label>
          <input id="cs-bio" className={fieldClass} placeholder="What you do, in one line" value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="cs-open" className={labelClass}>
            Open to (comma-separated)
          </label>
          <input
            id="cs-open"
            className={fieldClass}
            placeholder="Partnerships, Developer work, Research, Speaking"
            value={openTo}
            onChange={(e) => setOpenTo(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="cs-template" className={labelClass}>
            Reply template
          </label>
          <textarea
            id="cs-template"
            rows={3}
            className={`${fieldClass} resize-y`}
            placeholder="Sent when your agent accepts a bid for you"
            value={autoReplyTemplate}
            onChange={(e) => setAutoReplyTemplate(e.target.value)}
          />
          <p className="mt-1 text-xs text-text-secondary">
            Sent on your behalf when your agent accepts a bid, and offered as a starting point when you reply yourself.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-arc-coral sm:col-span-2">
            {error}
          </p>
        )}
        <div className="flex gap-3 sm:col-span-2">
          {onCancel && (
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={loading || !!floorError}>
            {loading ? "Saving…" : isEdit ? "Save changes" : "Create & register on Arc"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
