"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { CreatorAvatar, Money, Num, Panel, StatStrip, StatusChip, Tag } from "@/components/market";
import { AvatarEditor } from "@/components/market/avatar-editor";
import { toast } from "@/hooks/use-toast";
import { bidDisplay } from "@/lib/bid-display";
import { ESCROW_MAX_BID, ESCROW_MIN_BID } from "@/lib/bid-rules";
import { cn } from "@/lib/cn";
import { atomicToDollarInput, dollarsToAtomic, formatDuration, formatMoney, refundCountdown, shortAddress, timeAgo } from "@/lib/format";
import { CreatorSetupForm, fieldClass, labelClass } from "./creator-setup-form";
import { FundWalletCard } from "./fund-wallet-card";
import { ReplySourceTag } from "./reply-rating";
import { REPLY_MAX_CHARS, REPLY_MIN_CHARS } from "@/lib/reply-rules";
import type { BidData, PortfolioSummary, ProfileData, WalletData } from "./types";

/** Statuses of a re-bid that still stands in for the countered bid it replaces. */
const LIVE_REBID = new Set(["placing", "pending", "counter_offered", "accepted"]);

const AVAILABILITY: Record<string, { label: string; tone: "success" | "pending" | "danger" }> = {
  available: { label: "Accepting bids", tone: "success" },
  limited: { label: "Limited availability", tone: "pending" },
  not_accepting: { label: "Paused", tone: "danger" },
};

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.success !== false, data };
}

export function CreatorView({
  profile,
  wallet,
  bids,
  summary,
  hasGooglePhoto,
  now,
}: {
  profile: ProfileData | null;
  wallet: WalletData | null;
  /** Only bids sent to this creator. */
  bids: BidData[];
  summary: PortfolioSummary;
  hasGooglePhoto: boolean;
  now: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  // Read after mount: localStorage isn't available during the server render.
  const [funded, setFunded] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!wallet) return setFunded(true);
    try {
      setFunded(!!localStorage.getItem("attnn:funded:" + wallet.address));
    } catch {
      setFunded(true);
    }
  }, [wallet]);

  if (!profile || editing) {
    if (!profile && !editing && wallet && funded === false) {
      return (
        <FundWalletCard
          address={wallet.address}
          onFunded={() => {
            try {
              localStorage.setItem("attnn:funded:" + wallet.address, "1");
            } catch {}
            setFunded(true);
          }}
        />
      );
    }
    return (
      <CreatorSetupForm
        existingProfile={profile}
        onComplete={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={profile ? () => setEditing(false) : undefined}
      />
    );
  }

  return <CreatorMarketDesk profile={profile} bids={bids} summary={summary} hasGooglePhoto={hasGooglePhoto} now={now} onEdit={() => setEditing(true)} />;
}

function CreatorMarketDesk({
  profile,
  bids,
  summary,
  hasGooglePhoto,
  now,
  onEdit,
}: {
  profile: ProfileData;
  bids: BidData[];
  summary: PortfolioSummary;
  hasGooglePhoto: boolean;
  now: number;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [activating, setActivating] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [threshold, setThreshold] = React.useState(profile.autoAcceptThreshold ?? 0);
  const c = summary.creator;

  const inbox = bids
    .filter((b) => b.status === "pending" || b.status === "counter_offered")
    .sort((a, b) => {
      const d = BigInt(b.amountUsdc) - BigInt(a.amountUsdc);
      return d > BigInt(0) ? 1 : d < BigInt(0) ? -1 : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const recent = bids
    .filter((b) => b.status === "accepted" || b.status === "rejected" || b.status === "refunded")
    .sort((a, b) => new Date(b.settledAt ?? b.createdAt).getTime() - new Date(a.settledAt ?? a.createdAt).getTime())
    .slice(0, 8);

  const paused = profile.availabilityStatus === "not_accepting";
  const registering = profile.registration === "registering";
  const avail = profile.isActive
    ? AVAILABILITY[profile.availabilityStatus] ?? AVAILABILITY.available!
    : registering
      ? { label: "Registering on Arc…", tone: "pending" as const }
      : { label: "Not registered on Arc", tone: "danger" as const };

  async function activate() {
    setActivating(true);
    try {
      const res = await fetch("/api/profile/activate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast(
          data.status === "active"
            ? { title: "Registered on Arc", description: "Your market is live.", variant: "success" }
            : { title: "Registering on Arc", description: "Your market goes live as soon as Arc confirms it, usually within a minute." },
        );
        router.refresh();
      } else {
        toast({ title: "Activation failed", description: data.error ?? "Try again", variant: "destructive" });
      }
    } catch {
      toast({ title: "Activation failed", description: "Network error", variant: "destructive" });
    } finally {
      setActivating(false);
    }
  }

  async function togglePause() {
    setToggling(true);
    const { ok, data } = await postJson("/api/profile/update", { availabilityStatus: paused ? "available" : "not_accepting" }).catch(() => ({
      ok: false,
      data: {},
    }));
    setToggling(false);
    if (ok) {
      toast({ title: paused ? "Market resumed" : "Market paused", description: paused ? "You're accepting bids again." : "New bids are refused until you resume.", variant: "success" });
      router.refresh();
    } else {
      toast({ title: "Couldn't update", description: data.error ?? "Try again", variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <CreatorAvatar handle={profile.handle} src={profile.avatarUrl} size={48} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-display text-xl font-bold tracking-tight">@{profile.handle}</h2>
                <StatusChip tone={avail.tone} dot>
                  {avail.label}
                </StatusChip>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
                {profile.tags.slice(0, 4).map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
                <Link href={`/c/${profile.handle}`} className="focus-ring inline-flex items-center gap-1 rounded text-arc-lavender hover:underline">
                  View market <ExternalLink aria-hidden className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!profile.isActive && !registering && (
              <Button size="sm" onClick={activate} disabled={activating}>
                {activating ? "Registering…" : profile.registration === "failed" ? "Retry registration" : "Activate on Arc"}
              </Button>
            )}
            {profile.isActive && (
              <Button size="sm" variant="outline" onClick={togglePause} disabled={toggling}>
                {toggling ? "Saving…" : paused ? "Resume market" : "Pause market"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onEdit}>
              Edit market
            </Button>
          </div>
        </div>
        {registering && (
          <p role="status" className="mt-3 text-[13px] text-text-secondary">
            Waiting for Arc to confirm your registration. Your market goes live as soon as it does, usually within a minute.
          </p>
        )}
        {profile.registration === "failed" && (
          <p role="alert" className="mt-3 text-[13px] text-arc-coral">
            Registration didn&apos;t go through: {profile.registrationError}. Check your wallet has at least $1 USDC, then press Retry registration.
          </p>
        )}
        {profile.registration === "none" && (
          <p className="mt-3 text-[13px] text-arc-gold">
            Not live yet. Add at least $1 USDC to your wallet, then press Activate on Arc. It covers the small network fees for registering and replying.
          </p>
        )}
      </Panel>

      <StatStrip
        items={[
          {
            label: "Earned",
            value: <Money atomic={c.earnedAllTimeUsdc} tone="success" />,
            sub: (
              <>
                <Money atomic={c.earned7d.usdc} className="text-text-secondary" /> in the last 7d · paid on Arc
              </>
            ),
          },
          {
            label: "Waiting in escrow",
            value: <Money atomic={c.waiting.usdc} tone="gold" />,
            sub: `${c.waiting.count} bid${c.waiting.count === 1 ? "" : "s"} to answer`,
          },
          { label: "Floor", value: <Money atomic={profile.minBid} />, sub: "Lowest bid you accept" },
          {
            label: "Reply rate · 30d",
            value: <Num>{c.replyRate === null ? "—" : `${Math.round(c.replyRate * 100)}%`}</Num>,
            sub: "Paid replies ÷ (paid + expired)",
          },
          { label: "Median reply", value: <Num>{formatDuration(c.medianReplyMs)}</Num>, sub: "Bid to paid reply, 30d" },
        ]}
      />

      <Panel
        padded={false}
        title={
          <span className="flex items-center gap-2">
            Inbox <Num className="text-sm text-text-secondary">{inbox.length}</Num>
          </span>
        }
        description="Escrowed bids, highest first. Reply to collect the USDC; anything unanswered for 3 days refunds the bidder."
      >
        {inbox.length === 0 ? (
          <p className="border-t border-border px-5 py-10 text-center text-sm text-text-secondary">
            No bids waiting. Share your market:{" "}
            <Link href={`/c/${profile.handle}`} className="num text-arc-gold hover:underline">
              attnn.xyz/c/{profile.handle}
            </Link>
          </p>
        ) : (
          <ol className="border-t border-border">
            {inbox.map((bid, i) => (
              <InboxRow
                key={bid.id}
                bid={bid}
                rank={i + 1}
                now={now}
                template={profile.autoReplyTemplate}
                rebid={bids.find((b) => b.replacesBidId === bid.id && LIVE_REBID.has(b.status)) ?? null}
                replaces={bid.replacesBidId ? (bids.find((b) => b.id === bid.replacesBidId) ?? null) : null}
              />
            ))}
          </ol>
        )}
      </Panel>

      {recent.length > 0 && (
        <Panel padded={false} title="Recently settled">
          <ul className="border-t border-border">
            {recent.map((b) => {
              const d = bidDisplay(b, "creator");
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-5 py-3 text-sm last:border-b-0">
                  <Money atomic={b.amountUsdc} tone={b.status === "accepted" && b.settlementTxHref ? "success" : "muted"} className="w-20 font-medium" />
                  <StatusChip tone={d.tone}>{d.label}</StatusChip>
                  <span className="order-last min-w-0 basis-full truncate text-xs text-text-secondary sm:order-none sm:basis-auto sm:flex-1 sm:text-sm">{b.agentName ?? shortAddress(b.bidderAddress)}</span>
                  {b.status === "accepted" && (b.replySource === "template" || b.replySource === "ai") && <ReplySourceTag source={b.replySource} />}
                  {b.replyRating !== null && (
                    <span className={cn("inline-flex items-center gap-1 text-xs", b.replyRating > 0 ? "text-green" : "text-arc-coral")}>
                      {b.replyRating > 0 ? <ThumbsUp aria-hidden className="h-3.5 w-3.5" /> : <ThumbsDown aria-hidden className="h-3.5 w-3.5" />}
                      {b.replyRating > 0 ? "Bidder found it worth it" : "Bidder didn't find it worth it"}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3">
                    <Num className="text-xs text-text-secondary">{timeAgo(b.settledAt ?? b.createdAt, now)}</Num>
                    {b.settlementTxHref && (
                      <a href={b.settlementTxHref} target="_blank" rel="noopener noreferrer" className="text-[13px] text-arc-lavender hover:underline">
                        Settlement ↗
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Panel>
          <AvatarEditor handle={profile.handle} initialUrl={profile.avatarUrl} hasGooglePhoto={hasGooglePhoto} />
        </Panel>
        <Panel
          title="Your agent's standards"
          description="How picky your creator agent should be when it scores incoming bids. Bids it scores 8 or higher are accepted for you with your reply template, or a reply its AI writes for that bid. Bidders see these labelled as auto-replies."
        >
          <div className="flex items-center gap-4">
            <Slider
              aria-label="Agent standards"
              defaultValue={[threshold]}
              max={10}
              step={1}
              onValueChange={(v) => setThreshold(v[0] ?? 0)}
              onValueCommit={async (v) => {
                const value = v[0] ?? 0;
                setThreshold(value);
                const { ok } = await postJson("/api/profile/update", { autoAcceptThreshold: value }).catch(() => ({ ok: false }));
                if (!ok) toast({ title: "Couldn't save", variant: "destructive" });
              }}
              className="flex-1"
            />
            <Num className="w-10 text-right text-2xl text-arc-gold">{threshold}</Num>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function InboxRow({
  bid,
  rank,
  now,
  template,
  rebid,
  replaces,
}: {
  bid: BidData;
  rank: number;
  now: number;
  template: string | null;
  /** A live bid the bidder placed at this bid's counter price, if any. */
  rebid: BidData | null;
  /** For a re-bid: the countered bid it replaces. */
  replaces: BidData | null;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"idle" | "reply" | "counter">("idle");
  const [reply, setReply] = React.useState("");
  const [counter, setCounter] = React.useState("");
  const [busy, setBusy] = React.useState<null | "accept" | "reject" | "counter">(null);
  const replyRef = React.useRef<HTMLTextAreaElement>(null);

  const d = bidDisplay(bid, "creator");
  const settling = !!bid.settlementTxHash;
  const countered = bid.status === "counter_offered";
  const refund = refundCountdown(bid.createdAt, now);
  const windowPassed = refund.due;
  const trimmed = reply.trim();
  const replyValid = trimmed.length >= REPLY_MIN_CHARS && trimmed.length <= REPLY_MAX_CHARS;

  const counterAtomic = dollarsToAtomic(counter);
  const counterError =
    counter.trim() === ""
      ? null
      : counterAtomic === null
        ? "Enter an amount like 50."
        : counterAtomic <= BigInt(bid.amountUsdc)
          ? `Must be more than ${formatMoney(bid.amountUsdc)}.`
          : counterAtomic < ESCROW_MIN_BID || counterAtomic > ESCROW_MAX_BID
            ? "Between $5.00 and $1,000.00."
            : null;

  React.useEffect(() => {
    if (mode === "reply") replyRef.current?.focus();
  }, [mode]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (!replyValid) return;
    setBusy("accept");
    const { ok, data } = await postJson("/api/bid/accept", { bidId: bid.id, reply: trimmed }).catch(() => ({ ok: false, data: {} }));
    setBusy(null);
    if (ok) {
      // Still pending until acceptBid completes on Arc; the row shows "Paying out".
      toast({ title: "Reply sent", description: `Releasing ${formatMoney(bid.amountUsdc)} on Arc. Earnings update once it confirms.`, variant: "success" });
      setMode("idle");
      setReply("");
      router.refresh();
    } else {
      toast({ title: "Couldn't accept", description: data.error ?? "Try again", variant: "destructive" });
    }
  }

  async function decline() {
    setBusy("reject");
    const { ok, data } = await postJson("/api/bid/reject", { bidId: bid.id }).catch(() => ({ ok: false, data: {} }));
    setBusy(null);
    if (ok) {
      toast({ title: "Declining", description: "Refunding the bidder on Arc. This updates once it confirms.", variant: "success" });
      router.refresh();
    } else {
      toast({ title: "Couldn't decline", description: data.error ?? "Try again", variant: "destructive" });
    }
  }

  async function sendCounter(e: React.FormEvent) {
    e.preventDefault();
    if (counterError || counterAtomic === null) return;
    setBusy("counter");
    const { ok, data } = await postJson("/api/bid/counter", { bidId: bid.id, counterOfferAmount: counterAtomic.toString() }).catch(() => ({
      ok: false,
      data: {},
    }));
    setBusy(null);
    if (ok) {
      toast({ title: "Counter sent", description: "The bidder's agent will decide whether to bid again at your price.", variant: "success" });
      setMode("idle");
      setCounter("");
      router.refresh();
    } else {
      toast({ title: "Couldn't counter", description: data.error ?? "Try again", variant: "destructive" });
    }
  }

  const who = bid.agentName ?? "Manual bid";

  return (
    <li className="border-b border-border px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <Num className="w-6 pt-1 text-text-secondary">#{rank}</Num>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Money atomic={bid.amountUsdc} tone="gold" className="text-lg font-medium" />
            <StatusChip tone={d.tone} dot>
              {d.label}
            </StatusChip>
            {bid.score != null && (
              <span className="text-xs text-text-secondary">
                Agent score <Num className={cn(bid.score >= 8 ? "text-green" : bid.score >= 5 ? "text-text-primary" : "text-arc-coral")}>{bid.score}/10</Num>
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            <span className="text-text-primary">{who}</span> · <span className="num">{shortAddress(bid.bidderAddress)}</span> · placed{" "}
            <Num>{timeAgo(bid.createdAt, now)}</Num> ·{" "}
            <span className="text-arc-coral">
              {windowPassed ? "reply window closed, refund due" : <>refunds <Num>{refund.label}</Num></>}
            </span>
          </p>
          {bid.message && <p className="mt-2 max-w-[75ch] whitespace-pre-line text-sm text-text-primary">{bid.message}</p>}
          {countered && bid.counterOfferAmount && (
            <p className="mt-2 text-xs text-arc-lavender">
              {rebid ? (
                <>
                  They re-bid at your price: <Money atomic={rebid.amountUsdc} className="text-arc-lavender" />.{" "}
                  {rebid.status === "placing" ? "This bid is released back to them once that's escrowed." : "This bid is being released back to them automatically."}
                </>
              ) : (
                <>
                  You asked for <Money atomic={bid.counterOfferAmount} className="text-arc-lavender" />. If their agent bids that, this one is released
                  automatically. You can still accept it at <Money atomic={bid.amountUsdc} className="text-arc-lavender" /> until then.
                </>
              )}
            </p>
          )}
          {replaces && (
            <p className="mt-2 text-xs text-arc-lavender">
              Re-bid at your counter price. Replaces their <Money atomic={replaces.amountUsdc} className="text-arc-lavender" /> bid.
            </p>
          )}
          {d.note && !countered && <p className="mt-1 text-xs text-text-secondary">{d.note}</p>}
        </div>
        {!settling && mode === "idle" && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {!rebid && (
              <Button size="sm" onClick={() => setMode("reply")} disabled={windowPassed || !!busy} title={windowPassed ? "The 3-day reply window has passed" : undefined}>
                Reply · collect {formatMoney(bid.amountUsdc)}
              </Button>
            )}
            {!countered && !replaces && !windowPassed && (
              <Button size="sm" variant="outline" onClick={() => setMode("counter")} disabled={!!busy}>
                Counter
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={decline} disabled={!!busy} className="text-arc-coral hover:text-arc-coral">
              {busy === "reject" ? "Declining…" : "Decline"}
            </Button>
          </div>
        )}
      </div>

      {mode === "reply" && (
        <form onSubmit={accept} className="mt-4 rounded-lg border border-border-bright bg-arc-bg-0 p-4 sm:ml-10">
          <label htmlFor={`reply-${bid.id}`} className={labelClass}>
            Your reply
          </label>
          <textarea
            id={`reply-${bid.id}`}
            ref={replyRef}
            rows={4}
            maxLength={REPLY_MAX_CHARS}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Answer their question, share a contact, or say what happens next."
            className={cn(fieldClass, "resize-y bg-arc-bg-1")}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
            <span>
              <Num className={trimmed.length > 0 && trimmed.length < REPLY_MIN_CHARS ? "text-arc-coral" : undefined}>{trimmed.length}</Num> / {REPLY_MAX_CHARS} · at least{" "}
              {REPLY_MIN_CHARS} characters. Give them a real answer: the bidder sees this when the payment clears and can rate it on your market.
            </span>
            {template && (
              <button type="button" onClick={() => setReply(template)} title="Replies sent from your template are labelled as auto-replies" className="focus-ring rounded text-arc-lavender hover:underline">
                Use my template
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={!replyValid || busy === "accept"}>
              {busy === "accept" ? "Sending…" : `Send reply & collect ${formatMoney(bid.amountUsdc)}`}
            </Button>
            <Button type="button" variant="outline" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <Dialog open={mode === "counter"} onOpenChange={(o) => !o && setMode("idle")}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>Counter {formatMoney(bid.amountUsdc)}</DialogTitle>
            <DialogDescription>
              Ask for more. The bidder&apos;s agent decides whether to place a new bid at your price. This bid stays escrowed until you decline it or it refunds.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={sendCounter} className="flex flex-col gap-3">
            <div>
              <label htmlFor={`counter-${bid.id}`} className={labelClass}>
                Your price (USDC)
              </label>
              <input
                id={`counter-${bid.id}`}
                inputMode="decimal"
                autoComplete="off"
                value={counter}
                onChange={(e) => setCounter(e.target.value)}
                placeholder={atomicToDollarInput((BigInt(bid.amountUsdc) * BigInt(3)) / BigInt(2))}
                className={cn(fieldClass, "num")}
                aria-invalid={!!counterError}
              />
              {counterError && <p className="mt-1 text-xs text-arc-coral">{counterError}</p>}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setMode("idle")}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={!!counterError || counterAtomic === null || busy === "counter"}>
                {busy === "counter" ? "Sending…" : counterAtomic && !counterError ? `Ask ${formatMoney(counterAtomic)}` : "Send counter"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </li>
  );
}
