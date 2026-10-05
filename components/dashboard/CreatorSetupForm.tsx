"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

interface ProfileData {
  id: string; handle: string; minBid: string; tags: string[]; bio: string | null;
  autoAcceptThreshold: number | null; autoReplyTemplate: string | null;
  isActive: boolean; availabilityStatus: string; openTo: string[];
}

export function CreatorSetupForm({
  existingProfile,
  onComplete,
  onCancel,
}: {
  existingProfile: ProfileData | null;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const isEdit = !!existingProfile;
  const [handle, setHandle] = useState(existingProfile?.handle ?? "");
  const [minBid, setMinBid] = useState(
    existingProfile ? (Number(BigInt(existingProfile.minBid || "0")) / 1_000_000).toString() : "5",
  );
  const [tags, setTags] = useState(existingProfile?.tags?.join(", ") ?? "");
  const [bio, setBio] = useState(existingProfile?.bio ?? "");
  const [autoReplyTemplate, setAutoReplyTemplate] = useState(
    existingProfile?.autoReplyTemplate ??
    "Thanks for reaching out! I've reviewed your bid and I'm happy to connect."
  );
  const [availabilityStatus, setAvailabilityStatus] = useState(existingProfile?.availabilityStatus ?? "available");
  const [openTo, setOpenTo] = useState(existingProfile?.openTo?.join(", ") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const minBidRaw = (parseFloat(minBid) * 1_000_000).toString();
      const tagsArr = tags.split(",").map(t => t.trim()).filter(Boolean);

      if (isEdit) {
        const res = await fetch("/api/profile/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle, minBid: minBidRaw, tags: tagsArr, bio: bio || null,
            autoReplyTemplate: autoReplyTemplate || null, availabilityStatus,
            openTo: openTo.split(",").map((t: string) => t.trim()).filter(Boolean),
          }),
        });
        const data = await res.json();
        if (data.success) {
          toast({ title: "Profile updated!", variant: "success" });
          onComplete();
        } else {
          setError(data.error ?? "Failed to update profile");
        }
      } else {
        const res = await fetch("/api/profile/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle, minBid: minBidRaw, tags: tagsArr, bio: bio || null,
            autoReplyTemplate: autoReplyTemplate || null, availabilityStatus,
            openTo: openTo.split(",").map((t: string) => t.trim()).filter(Boolean),
          }),
        });
        const data = await res.json();
        if (data.success) {
          const activateRes = await fetch("/api/profile/activate", { method: "POST" });
          const activateData = await activateRes.json();
          if (activateData.success) {
            toast({ title: "Creator profile created!", description: "Registered on-chain", variant: "success" });
            onComplete();
          } else {
            setError("Profile saved but on-chain registration failed: " + (activateData.error ?? "Unknown error"));
          }
        } else {
          setError(data.error ?? "Failed to create profile");
        }
      }
    } catch {
      setError("Something went wrong");
    }
    setLoading(false);
    router.refresh();
  };

  return (
    <Card className="p-8">
      <h3 className="font-display font-bold text-lg mb-2">
        {isEdit ? "Edit Creator Profile" : "Create Creator Profile"}
      </h3>
      <p className="text-sm text-text-secondary mb-6">
        {isEdit
          ? "Update your profile details. Changes are reflected immediately."
          : "Set up your profile to start receiving bids on your attention."}
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Handle</label>
          <Input placeholder="your-handle" value={handle} onChange={e => setHandle(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Min Bid (USDC)</label>
          <Input type="number" step="0.01" min="5" max="1000" placeholder="5" value={minBid} onChange={e => setMinBid(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Tags (comma-separated)</label>
          <Input placeholder="ai, crypto, design" value={tags} onChange={e => setTags(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Bio</label>
          <Input placeholder="Tell the world what you do" value={bio} onChange={e => setBio(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Availability Status</label>
          <select
            value={availabilityStatus}
            onChange={e => setAvailabilityStatus(e.target.value)}
            className="w-full bg-arc-bg-1 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-arc-gold"
          >
            <option value="available">Available for new opportunities</option>
            <option value="limited">Limited availability</option>
            <option value="not_accepting">Not accepting offers</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Open To (comma-separated)</label>
          <Input placeholder="Partnerships, Developer work, Research, Speaking" value={openTo} onChange={e => setOpenTo(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block">Auto-Reply Template</label>
          <textarea
            className="w-full rounded-lg border border-border bg-arc-bg-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-arc-gold resize-none"
            rows={3}
            placeholder="Message sent automatically when a bid is auto-accepted…"
            value={autoReplyTemplate}
            onChange={e => setAutoReplyTemplate(e.target.value)}
          />
          <p className="text-xs text-text-dim mt-1">Sent when a bid scores above your auto-accept threshold.</p>
        </div>
        {error && <p className="text-sm text-arc-coral">{error}</p>}
        <div className="flex gap-3">
          {onCancel && (
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          )}
          <Button type="submit" className={onCancel ? "flex-1" : "w-full"} disabled={loading}>
            {loading ? "Saving…" : isEdit ? "Save Changes" : "Create & Register on-chain"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
