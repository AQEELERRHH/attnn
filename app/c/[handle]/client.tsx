"use client";

import * as React from "react";
import { useRequestId } from "@/app/dashboard/use-request-id";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Check, Copy, Lock, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  BidTicket,
  Change,
  CreatorAvatar,
  MarketTable,
  Money,
  Num,
  OrderBook,
  Panel,
  PriceChart,
  StatInline,
  StatusChip,
  Tag,
  type MarketColumn,
  type OrderBookBid,
} from "@/components/market";
import { cn } from "@/lib/cn";
import { formatChange, formatDuration, shortAddress, timeAgo } from "@/lib/format";
import { verificationHref, verificationLabel, type PublicVerification } from "@/lib/social-verify-rules";
import { ratingShare } from "@/lib/reply-rules";

export interface CreatorFill {
  id: string;
  agent: string;
  amountUsdc: string;
  settledAt: string;
  replyMs: number;
  txHash: string;
  txHref: string;
  /** Template/AI auto-reply; null when unknown (older fills). */
  autoReply: boolean | null;
  /** Bidder's rating: 1 worth it, -1 not, null unrated. */
  rating: number | null;
}

export interface CreatorMarketProps {
  handle: string;
  avatarUrl: string | null;
  /** The creator's verified social accounts (lib/social-verify.ts). */
  verifications: PublicVerification[];
  tags: string[];
  paused: boolean;
  registeredOnChain: boolean;
  stats: {
    floorUsdc: string;
    topBidUsdc: string | null;
    lastClearedUsdc: string | null;
    prevClearedUsdc: string | null;
    volume7dUsdc: string;
    replyRate: number | null;
    medianReplyMs: number | null;
    openBids: number;
    hasHistory: boolean;
    ratingsUp: number;
    ratingsDown: number;
    repliesKnown: number;
    autoReplies: number;
  };
  book: OrderBookBid[];
  fills: CreatorFill[];
  viewer: { signedIn: boolean; isOwner: boolean; biddingAs: string };
  details: { unlocked: boolean; bio: string | null; openTo: string[]; availabilityStatus: string | null };
  escrowAddress: string | null;
  escrowHref: string | null;
  apiPath: string;
  /** Server render time, used for every relative time so server and browser agree. */
  now?: number;
}

const AVAILABILITY: Record<string, { label: string; tone: "success" | "pending" | "danger" }> = {
  available: { label: "Accepting bids", tone: "success" },
  limited: { label: "Limited availability", tone: "pending" },
  not_accepting: { label: "Not accepting bids", tone: "danger" },
};

export function CreatorMarket(props: CreatorMarketProps) {
  const { handle, stats, viewer, details, paused } = props;
  const router = useRouter();
  const [now] = React.useState(() => props.now ?? Date.now());
  const [tab, setTab] = React.useState<"book" | "fills">("book");
  const bidRequest = useRequestId();

  const disabledReason = !viewer.signedIn
    ? null // handled below with a sign-in link
    : viewer.isOwner
      ? "This is your market. Bids come from other users and agents."
      : paused
        ? "This creator isn't accepting bids right now."
        : null;

  async function placeBid(amountUsdc: string, message: string, code?: string) {
    const res = await fetch("/api/bid/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorHandle: handle,
        amountUsdc,
        message,
        isPrivate: false,
        // Same bid retried → same id → the server returns the bid it already recorded.
        requestId: bidRequest.idFor(`bid:${amountUsdc}:${message}`),
        ...(code ? { code } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.needsCode) return { ok: false, needsCode: String(data.sentTo ?? "your email"), error: data.error as string | undefined };
    if (data.restart) bidRequest.done();
    if (res.ok && data.success) {
      bidRequest.done();
      router.refresh();
      return { ok: true };
    }
    return { ok: false, error: data.error ?? "Could not place bid." };
  }

  const fillColumns: MarketColumn<CreatorFill>[] = [
    { key: "amount", label: "Cleared at", align: "right", render: (f) => <Money atomic={f.amountUsdc} tone="success" className="font-medium" /> },
    { key: "agent", label: "Bidder agent", render: (f) => <span className="font-medium">{f.agent}</span> },
    { key: "reply", label: "Reply time", render: (f) => <Num>{formatDuration(f.replyMs)}</Num> },
    { key: "quality", label: "Reply", render: (f) => <ReplyQuality fill={f} /> },
    { key: "when", label: "Settled", render: (f) => <Num className="text-text-secondary">{timeAgo(f.settledAt, now)}</Num> },
    {
      key: "tx",
      label: "Transaction",
      render: (f) => (
        <a href={f.txHref} target="_blank" rel="noopener noreferrer" className="num text-[13px] text-arc-lavender link-u">
          {shortAddress(f.txHash, 4, 4)} ↗
        </a>
      ),
    },
  ];

  const tabBtn = (id: "book" | "fills", label: string, count: number) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={cn(
        "focus-ring relative -mb-px inline-flex h-11 items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors",
        tab === id ? "border-arc-gold text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary",
      )}
    >
      {label}
      <Num className={cn("rounded px-1.5 py-px text-[11px]", tab === id ? "bg-arc-gold/15 text-arc-gold" : "bg-arc-bg-3 text-text-secondary")}>{count}</Num>
    </button>
  );

  const avail = details.availabilityStatus ? AVAILABILITY[details.availabilityStatus] : null;
  const rated = ratingShare(stats.ratingsUp, stats.ratingsDown);

  return (
    <main className="mx-auto max-w-[1320px] px-4 pb-6 pt-5 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-[13px] text-text-secondary">
        <Link href="/creators" className="focus-ring rounded transition-colors hover:text-text-primary">
          Markets
        </Link>
        <span aria-hidden className="text-text-dim">/</span>
        <span className="text-text-primary">@{handle}</span>
      </nav>

      {/* Market header */}
      <section aria-label={`@${handle} market`} className="panel relative overflow-hidden">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-arc-gold/50 to-transparent" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 flex-[1_1_320px] items-center gap-4">
            <CreatorAvatar handle={handle} src={props.avatarUrl} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.035em]">@{handle}</h1>
                {paused ? (
                  <StatusChip tone="danger" dot>
                    {props.registeredOnChain ? "Not accepting bids" : "Not registered yet"}
                  </StatusChip>
                ) : (
                  <StatusChip tone="success" dot>
                    Accepting bids
                  </StatusChip>
                )}
                {!stats.hasHistory && <StatusChip tone="neutral">New market</StatusChip>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                {props.verifications.length > 0 && (
                  <ul aria-label="Verified accounts" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                    {props.verifications.map((v) => {
                      const href = verificationHref(v);
                      return (
                        <li key={v.provider} className="inline-flex items-center gap-1">
                          <BadgeCheck aria-hidden className="h-3.5 w-3.5 text-green" />
                          <span className="sr-only">Verified:</span>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="focus-ring rounded text-text-primary link-u">
                              {verificationLabel(v)}
                            </a>
                          ) : (
                            verificationLabel(v)
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {props.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {props.tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <dl className="grid flex-[1_1_360px] grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border min-[440px]:grid-cols-3 max-[439px]:[&>*:last-child]:col-span-2">
            <div className="min-w-0 bg-arc-bg-0 px-4 py-3">
              <dt className="eyebrow">Floor</dt>
              <dd className="mt-1 text-xl font-medium tracking-[-0.02em]">
                <Money atomic={stats.floorUsdc} />
              </dd>
            </div>
            <div className="min-w-0 bg-arc-bg-0 px-4 py-3">
              <dt className="eyebrow">Top bid</dt>
              <dd className="mt-1 text-xl font-medium tracking-[-0.02em]">
                <Money atomic={stats.topBidUsdc} tone="gold" />
              </dd>
            </div>
            <div className="min-w-0 bg-arc-bg-0 px-4 py-3">
              <dt className="eyebrow">Last cleared</dt>
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xl font-medium tracking-[-0.02em]">
                <Money atomic={stats.lastClearedUsdc} tone={stats.lastClearedUsdc ? "success" : "default"} />
                {stats.prevClearedUsdc && <Change value={formatChange(BigInt(stats.lastClearedUsdc!), BigInt(stats.prevClearedUsdc))} />}
              </dd>
            </div>
          </dl>
        </div>
        <StatInline
          className="border-t border-border bg-arc-bg-0/40 px-5 py-4 sm:px-6 [&_dd]:text-base"
          items={[
            { label: "7d volume", value: <Money atomic={stats.hasHistory ? stats.volume7dUsdc : null} /> },
            { label: "Reply rate", value: <Num>{stats.replyRate === null ? "—" : `${Math.round(stats.replyRate * 100)}%`}</Num> },
            { label: "Median reply", value: <Num>{formatDuration(stats.medianReplyMs)}</Num> },
            {
              label: "Rated worth it",
              value: <Num>{rated === null ? "—" : `${Math.round(rated * 100)}%`}</Num>,
              sub:
                stats.ratingsUp + stats.ratingsDown > 0 ? (
                  <span className="text-xs text-text-secondary" title="Bidder ratings of paid replies, last 30 days">
                    (<Num>{stats.ratingsUp + stats.ratingsDown}</Num>)
                  </span>
                ) : undefined,
            },
            {
              label: "Auto-replies",
              value: (
                <Num title="Paid replies sent from a template or written by the creator's AI agent, last 30 days">
                  {stats.repliesKnown ? `${stats.autoReplies} of ${stats.repliesKnown}` : "—"}
                </Num>
              ),
            },
            { label: "Open bids", value: <Num className={stats.openBids > 0 ? "text-arc-gold" : undefined}>{stats.openBids}</Num> },
          ]}
        />
      </section>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        {/* Main column */}
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          <Panel
            title="Attention price"
            description="Cleared bids over the last 30 days. The dashed line is the creator's floor."
            actions={<span className="num rounded-md border border-border px-2 py-0.5 text-[11px] text-text-secondary">30D</span>}
          >
            <PriceChart points={props.fills.map((f) => ({ at: f.settledAt, amountUsdc: f.amountUsdc }))} floorUsdc={stats.floorUsdc} now={now} />
          </Panel>

          <Panel padded={false}>
            <div role="tablist" aria-label="Bids" className="flex gap-6 border-b border-border px-5">
              {tabBtn("book", "Order book", props.book.length)}
              {tabBtn("fills", "Recent fills", props.fills.length)}
            </div>
            {tab === "book" ? (
              <>
                <OrderBook bids={props.book} floorUsdc={stats.floorUsdc} now={now} />
                <p className="flex items-center gap-2 border-t border-border bg-arc-bg-0/40 px-5 py-3 text-xs text-text-secondary">
                  <Lock aria-hidden className="h-3.5 w-3.5 flex-none text-arc-gold" />
                  Every open bid is USDC escrowed on Arc. If the creator doesn&apos;t reply within 3 days, the bidder gets a full refund.
                </p>
              </>
            ) : (
              <MarketTable
                caption="Recent fills"
                columns={fillColumns}
                rows={props.fills}
                rowKey={(f) => f.id}
                minWidth={600}
                empty="No cleared bids yet."
                mobileCard={(f) => (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{f.agent}</div>
                      <div className="text-xs text-text-secondary">
                        <Num>{timeAgo(f.settledAt, now)}</Num> · replied in <Num>{formatDuration(f.replyMs)}</Num> · <ReplyQuality fill={f} /> ·{" "}
                        <a href={f.txHref} target="_blank" rel="noopener noreferrer" className="text-arc-lavender link-u">
                          tx ↗
                        </a>
                      </div>
                    </div>
                    <Money atomic={f.amountUsdc} tone="success" className="font-medium" />
                  </div>
                )}
              />
            )}
          </Panel>

          <section aria-label="About this creator" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            <Panel
              className={details.unlocked ? "col-span-full" : undefined}
              title={
                <span className="flex items-center gap-2">
                  Agent endpoint
                  <span className="num rounded-md border border-arc-gold/30 bg-arc-gold/[0.07] px-1.5 py-px text-[11px] font-normal text-arc-gold">$0.001 · x402</span>
                </span>
              }
              description="External agents can read this market over x402."
            >
              <EndpointField path={props.apiPath} />
            </Panel>
            {details.unlocked && (
              <>
                <Panel title="About">
                  <p className="text-[13px] leading-relaxed text-text-secondary">{details.bio || "No bio yet."}</p>
                  {avail && (
                    <p className="mt-3">
                      <StatusChip tone={avail.tone} dot>
                        {avail.label}
                      </StatusChip>
                    </p>
                  )}
                </Panel>
                <Panel title="Open to">
                  {details.openTo.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {details.openTo.map((o) => (
                        <Tag key={o}>{o}</Tag>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-text-secondary">Not specified.</p>
                  )}
                </Panel>
              </>
            )}
          </section>
        </div>

        {/* Right rail */}
        <aside aria-label="Place a bid" className="flex min-w-0 max-w-[420px] flex-[1_1_340px] flex-col gap-4 lg:sticky lg:top-20">
          <BidTicket
            floorUsdc={stats.floorUsdc}
            openBidAmounts={props.book.map((b) => b.amountUsdc)}
            biddingAs={viewer.signedIn ? viewer.biddingAs : ""}
            escrowAddress={props.escrowAddress}
            escrowHref={props.escrowHref}
            onSubmit={placeBid}
            disabledReason={disabledReason ?? (viewer.signedIn ? null : "Sign in to place a bid.")}
          />
          {!viewer.signedIn && (
            <Link href={`/register?callbackUrl=/c/${handle}`} className="focus-ring btn-secondary -mt-1 h-11">
              Sign in to bid
            </Link>
          )}

          {!details.unlocked && (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Lock aria-hidden className="h-4 w-4 text-text-secondary" /> Private details
                </span>
              }
              description="Availability, bio and what they're open to."
            >
              <p className="text-[13px] text-text-secondary">
                Free when you&apos;re signed in. AI agents can pay <Num className="text-text-primary">$0.001</Num> USDC over x402 at the endpoint above.
              </p>
            </Panel>
          )}

          <Panel title="How this market settles">
            <ol className="relative flex flex-col gap-3 text-[13px] text-text-secondary">
              {[
                { t: "Your bid's USDC moves into escrow on Arc.", c: "bg-arc-gold" },
                { t: "The creator's agent scores it: accept, review or decline.", c: "bg-arc-lavender" },
                { t: "Reply → USDC is released to the creator.", c: "bg-green" },
                { t: "No reply in 3 days → full refund to you.", c: "bg-arc-coral" },
              ].map((s, i) => (
                <li key={s.t} className="flex gap-3">
                  <Num className="flex h-5 w-5 flex-none items-center justify-center rounded border border-border-bright bg-arc-bg-0 text-[11px] text-text-primary">
                    {i + 1}
                  </Num>
                  <span className="flex-1 leading-snug">{s.t}</span>
                  <span aria-hidden className={cn("mt-1.5 h-1.5 w-1.5 flex-none rounded-full", s.c)} />
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
    </main>
  );
}

/** The x402 endpoint, with a copy button. */
function EndpointField({ path }: { path: string }) {
  const [copied, setCopied] = React.useState(false);
  const text = `GET attnn.xyz${path}`;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-arc-bg-0 py-1.5 pl-2.5 pr-1.5">
      <code className="num min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-text-primary [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="text-green">GET</span> attnn.xyz{path}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="focus-ring inline-flex h-7 flex-none items-center gap-1 rounded px-2 text-[11px] text-text-secondary transition-colors hover:bg-arc-bg-3 hover:text-text-primary"
      >
        {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-green" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** "Written" or "Auto-reply", plus the bidder's 👍/👎 if they rated it. */
function ReplyQuality({ fill }: { fill: CreatorFill }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {fill.autoReply === null ? (
        <span className="text-text-secondary">—</span>
      ) : fill.autoReply ? (
        <span className="text-text-secondary">Auto-reply</span>
      ) : (
        <span className="text-text-primary">Written</span>
      )}
      {fill.rating === 1 && <ThumbsUp aria-label="Bidder rated it worth it" className="h-3.5 w-3.5 text-green" />}
      {fill.rating === -1 && <ThumbsDown aria-label="Bidder rated it not worth it" className="h-3.5 w-3.5 text-arc-coral" />}
    </span>
  );
}
