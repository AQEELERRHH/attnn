"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
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

export interface CreatorFill {
  id: string;
  agent: string;
  amountUsdc: string;
  settledAt: string;
  replyMs: number;
  txHash: string;
  txHref: string;
}

export interface CreatorMarketProps {
  handle: string;
  avatarUrl: string | null;
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

  const disabledReason = !viewer.signedIn
    ? null // handled below with a sign-in link
    : viewer.isOwner
      ? "This is your market. Bids come from other users and agents."
      : paused
        ? "This creator isn't accepting bids right now."
        : null;

  async function placeBid(amountUsdc: string, message: string) {
    const res = await fetch("/api/bid/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creatorHandle: handle, amountUsdc, message, isPrivate: false }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      router.refresh();
      return { ok: true };
    }
    return { ok: false, error: data.error ?? "Could not place bid." };
  }

  const fillColumns: MarketColumn<CreatorFill>[] = [
    { key: "amount", label: "Cleared at", align: "right", render: (f) => <Money atomic={f.amountUsdc} tone="success" className="font-medium" /> },
    { key: "agent", label: "Bidder agent", render: (f) => <span className="font-medium">{f.agent}</span> },
    { key: "reply", label: "Reply time", render: (f) => <Num>{formatDuration(f.replyMs)}</Num> },
    { key: "when", label: "Settled", render: (f) => <Num className="text-text-secondary">{timeAgo(f.settledAt, now)}</Num> },
    {
      key: "tx",
      label: "Transaction",
      render: (f) => (
        <a href={f.txHref} target="_blank" rel="noopener noreferrer" className="num text-[13px] text-arc-lavender hover:underline">
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
        "focus-ring -mb-px h-10 border-b-2 px-3 text-sm font-medium",
        tab === id ? "border-arc-gold text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary",
      )}
    >
      {label} <Num className="text-xs text-text-secondary">{count}</Num>
    </button>
  );

  const avail = details.availabilityStatus ? AVAILABILITY[details.availabilityStatus] : null;

  return (
    <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-5 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-[13px] text-text-secondary">
        <Link href="/creators" className="hover:text-text-primary">
          Markets
        </Link>
        <span aria-hidden>/</span>
        <span className="text-text-primary">@{handle}</span>
      </nav>

      {/* Market header */}
      <Panel>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex min-w-0 flex-[1_1_300px] items-center gap-3.5">
            <CreatorAvatar handle={handle} src={props.avatarUrl} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl font-bold tracking-tight">@{handle}</h1>
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
              {props.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {props.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              )}
            </div>
          </div>
          <StatInline
            className="flex-[999_1_620px]"
            items={[
              { label: "Floor", value: <Money atomic={stats.floorUsdc} /> },
              { label: "Top bid", value: <Money atomic={stats.topBidUsdc} tone="gold" /> },
              {
                label: "Last cleared",
                value: <Money atomic={stats.lastClearedUsdc} />,
                sub: stats.prevClearedUsdc ? (
                  <Change value={formatChange(BigInt(stats.lastClearedUsdc!), BigInt(stats.prevClearedUsdc))} />
                ) : undefined,
              },
              { label: "7d volume", value: <Money atomic={stats.hasHistory ? stats.volume7dUsdc : null} /> },
              { label: "Reply rate", value: <Num>{stats.replyRate === null ? "—" : `${Math.round(stats.replyRate * 100)}%`}</Num> },
              { label: "Median reply", value: <Num>{formatDuration(stats.medianReplyMs)}</Num> },
              { label: "Open bids", value: <Num>{stats.openBids}</Num> },
            ]}
          />
        </div>
      </Panel>

      <div className="mt-5 flex flex-wrap items-start gap-5">
        {/* Main column */}
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
          <Panel title="Attention price" description="Cleared bids over the last 30 days. The dashed line is the creator's floor.">
            <PriceChart points={props.fills.map((f) => ({ at: f.settledAt, amountUsdc: f.amountUsdc }))} floorUsdc={stats.floorUsdc} now={now} />
          </Panel>

          <Panel padded={false}>
            <div role="tablist" aria-label="Bids" className="flex gap-1 border-b border-border px-4 pt-3">
              {tabBtn("book", "Order book", props.book.length)}
              {tabBtn("fills", "Recent fills", props.fills.length)}
            </div>
            {tab === "book" ? (
              <>
                <OrderBook bids={props.book} floorUsdc={stats.floorUsdc} now={now} />
                <p className="border-t border-border px-5 py-3 text-xs text-text-secondary">
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
                        <Num>{timeAgo(f.settledAt, now)}</Num> · replied in <Num>{formatDuration(f.replyMs)}</Num> ·{" "}
                        <a href={f.txHref} target="_blank" rel="noopener noreferrer" className="text-arc-lavender hover:underline">
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

          <section aria-label="About this creator" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-5">
            <Panel title="Agent endpoint" description="External agents can read this market over x402.">
              <code className="num block overflow-x-auto whitespace-nowrap rounded-md border border-border bg-arc-bg-0 px-2.5 py-2 text-xs text-arc-lavender">
                GET attnn.xyz{props.apiPath}
              </code>
            </Panel>
            {details.unlocked && (
              <>
                <Panel title="About">
                  <p className="text-[13px] text-text-secondary">{details.bio || "No bio yet."}</p>
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
        <aside aria-label="Place a bid" className="flex min-w-0 max-w-[420px] flex-[1_1_340px] flex-col gap-5">
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
            <Link
              href={`/register?callbackUrl=/c/${handle}`}
              className="focus-ring -mt-2 inline-flex h-11 items-center justify-center rounded-lg border border-arc-lavender font-medium text-text-primary hover:bg-arc-bg-2"
            >
              Sign in to bid
            </Link>
          )}

          {!details.unlocked && (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Lock aria-hidden className="h-4 w-4 text-arc-lavender" /> Private details
                </span>
              }
              description="Availability, bio and what they're open to."
            >
              <p className="text-[13px] text-text-secondary">
                Free when you&apos;re signed in. AI agents can pay <Num>$0.001</Num> USDC over x402 at the endpoint above.
              </p>
            </Panel>
          )}

          <Panel title="How this market settles">
            <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-[13px] text-text-secondary">
              <li>Your bid&apos;s USDC moves into escrow on Arc.</li>
              <li>The creator&apos;s agent scores it: accept, review or decline.</li>
              <li>Reply → USDC is released to the creator.</li>
              <li>No reply in 3 days → full refund to you.</li>
            </ol>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
