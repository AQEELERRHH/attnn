"use client";

import * as React from "react";
import Link from "next/link";
import { CreatorAvatar, MarketTable, Money, Num, Panel, StatStrip, StatusChip, type MarketColumn } from "@/components/market";
import { bidDisplay } from "@/lib/bid-display";
import { cn } from "@/lib/cn";
import { formatMoney, refundCountdown, shortAddress, timeAgo } from "@/lib/format";
import { ReplyRating, ReplySourceTag } from "./reply-rating";
import type { BidData, BidderConfigData, PortfolioSummary } from "./types";

const OPEN_STATUSES = new Set(["placing", "pending", "counter_offered"]);

export function CreatorCell({ bid }: { bid: BidData }) {
  if (!bid.creatorHandle) {
    return <span className="num text-text-secondary">{shortAddress(bid.creatorAddress)}</span>;
  }
  return (
    <Link href={`/c/${bid.creatorHandle}`} className="focus-ring flex items-center gap-2.5 rounded-md text-text-primary">
      <CreatorAvatar handle={bid.creatorHandle} src={bid.creatorAvatarUrl} size={30} />
      <span className="font-medium">@{bid.creatorHandle}</span>
    </Link>
  );
}

export function TxLinks({ bid, hideEmpty }: { bid: BidData; hideEmpty?: boolean }) {
  if (!bid.bidTxHref && !bid.settlementTxHref) return hideEmpty ? null : <span className="text-text-secondary">—</span>;
  return (
    <span className="flex gap-3 text-[13px]">
      {bid.bidTxHref && (
        <a href={bid.bidTxHref} target="_blank" rel="noopener noreferrer" className="text-arc-lavender hover:underline">
          Escrow ↗
        </a>
      )}
      {bid.settlementTxHref && (
        <a href={bid.settlementTxHref} target="_blank" rel="noopener noreferrer" className="text-arc-lavender hover:underline">
          Settlement ↗
        </a>
      )}
    </span>
  );
}

export function TabButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "focus-ring -mb-px h-10 whitespace-nowrap border-b-2 px-3 text-sm font-medium",
        active ? "border-arc-gold text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary",
      )}
    >
      {children} {count !== undefined && <Num className="text-xs text-text-secondary">{count}</Num>}
    </button>
  );
}

export function BidderView({
  bids,
  summary,
  bidderConfig,
  now,
  onOpenAgent,
}: {
  /** Only bids this user placed. */
  bids: BidData[];
  summary: PortfolioSummary;
  bidderConfig: BidderConfigData | null;
  now: number;
  onOpenAgent: () => void;
}) {
  const [tab, setTab] = React.useState<"open" | "history">("open");
  const open = bids.filter((b) => OPEN_STATUSES.has(b.status));
  // Counter re-bids: say which bid replaces which, so two open bids on one creator make sense.
  const byId = new Map(bids.map((b) => [b.id, b]));
  const rebidOf = new Map(bids.filter((b) => b.replacesBidId && b.status !== "failed").map((b) => [b.replacesBidId!, b]));
  const rebidNote = (b: BidData): string | null => {
    const original = b.replacesBidId ? byId.get(b.replacesBidId) : null;
    if (original) return `At the creator's counter price. Your ${formatMoney(original.amountUsdc)} bid is released once this is escrowed.`;
    const rebid = b.status === "counter_offered" ? rebidOf.get(b.id) : null;
    if (rebid) {
      return rebid.status === "placing"
        ? `Your agent re-bid ${formatMoney(rebid.amountUsdc)}. This bid is released back to you once that's escrowed.`
        : `Your agent re-bid ${formatMoney(rebid.amountUsdc)}. This bid is being released back to you.`;
    }
    return null;
  };
  const history = bids.filter((b) => !OPEN_STATUSES.has(b.status));
  const s = summary.bidder;

  const budget = bidderConfig ? BigInt(bidderConfig.dailyBudget) : null;
  const spent = BigInt(s.spentTodayUsdc);
  const budgetUsed = budget !== null && spent >= budget;

  const openColumns: MarketColumn<BidData>[] = [
    { key: "creator", label: "Creator", render: (b) => <CreatorCell bid={b} /> },
    {
      key: "bid",
      label: "Bid",
      align: "right",
      sortValue: (b) => Number(b.amountUsdc),
      render: (b) => (
        <span className="block leading-tight">
          <Money atomic={b.amountUsdc} tone="gold" className="font-medium" />
          {b.status === "counter_offered" && b.counterOfferAmount && (
            <span className="block text-xs text-arc-lavender">
              Asked <Money atomic={b.counterOfferAmount} className="text-arc-lavender" />
            </span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      className: "whitespace-normal min-w-[180px] max-w-[260px]",
      render: (b) => {
        const d = bidDisplay(b, "bidder");
        return (
          <span className="block">
            <StatusChip tone={d.tone} dot>
              {d.label}
            </StatusChip>
            {d.note && <span className="mt-1 block text-xs text-text-secondary">{d.note}</span>}
            {rebidNote(b) && <span className="mt-1 block text-xs text-arc-lavender">{rebidNote(b)}</span>}
          </span>
        );
      },
    },
    {
      key: "rank",
      label: "Book",
      align: "right",
      sortValue: (b) => b.bookRank?.rank,
      render: (b) =>
        b.bookRank ? (
          <Num className={b.bookRank.rank === 1 ? "text-arc-gold" : undefined}>
            #{b.bookRank.rank} <span className="text-text-secondary">of {b.bookRank.of}</span>
          </Num>
        ) : (
          <Num className="text-text-secondary">—</Num>
        ),
    },
    {
      key: "placed",
      label: "Placed",
      sortValue: (b) => new Date(b.createdAt).getTime(),
      render: (b) => <Num className="text-text-secondary">{timeAgo(b.createdAt, now)}</Num>,
    },
    {
      key: "refund",
      label: "Refund",
      render: (b) => {
        if (b.status === "placing") return <Num className="text-text-secondary">—</Num>;
        const r = refundCountdown(b.createdAt, now);
        return <Num className="text-arc-coral">{r.due ? "due now" : r.label}</Num>;
      },
    },
    {
      key: "score",
      label: "Creator score",
      align: "right",
      sortValue: (b) => b.score,
      render: (b) => <Num>{b.score == null ? "—" : `${b.score}/10`}</Num>,
    },
    { key: "tx", label: "Transactions", render: (b) => <TxLinks bid={b} /> },
  ];

  const historyColumns: MarketColumn<BidData>[] = [
    { key: "creator", label: "Creator", render: (b) => <CreatorCell bid={b} /> },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      sortValue: (b) => Number(b.amountUsdc),
      render: (b) => <Money atomic={b.amountUsdc} tone={b.status === "accepted" && b.settlementTxHref ? "success" : "muted"} className="font-medium" />,
    },
    {
      key: "outcome",
      label: "Outcome",
      render: (b) => {
        const d = bidDisplay(b, "bidder");
        return (
          <StatusChip tone={d.tone} dot>
            {d.label}
          </StatusChip>
        );
      },
    },
    {
      key: "detail",
      label: "Reply / reason",
      className: "whitespace-normal min-w-[220px] max-w-[360px]",
      render: (b) => {
        const text = b.status === "failed" ? bidDisplay(b, "bidder").note : b.reply;
        if (!text) return <span className="text-text-secondary">—</span>;
        return (
          <span className="flex flex-col gap-1.5">
            <span title={text} className={cn("line-clamp-2 text-[13px]", b.status === "failed" ? "text-arc-coral" : "text-text-secondary")}>
              {text}
            </span>
            {b.status === "accepted" && (
              <span className="flex flex-wrap items-center gap-2">
                <ReplySourceTag source={b.replySource} />
                <ReplyRating bid={b} />
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "when",
      label: "Ended",
      sortValue: (b) => new Date(b.settledAt ?? b.createdAt).getTime(),
      render: (b) => <Num className="text-text-secondary">{timeAgo(b.settledAt ?? b.createdAt, now)}</Num>,
    },
    { key: "tx", label: "Transactions", render: (b) => <TxLinks bid={b} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StatStrip
        items={[
          {
            label: "Available",
            value: <Money atomic={summary.walletUsdc} tone="gold" />,
            sub: summary.walletUsdc === null ? "Couldn't read Arc just now" : "USDC in your wallet",
          },
          {
            label: "In escrow",
            value: <Money atomic={s.inEscrow.usdc} />,
            sub: `${s.inEscrow.count} open bid${s.inEscrow.count === 1 ? "" : "s"}${s.confirming.count ? ` · ${s.confirming.count} confirming` : ""}`,
          },
          {
            label: "Spent today",
            value: <Money atomic={s.spentTodayUsdc} />,
            tone: budgetUsed ? "danger" : "default",
            sub: budget !== null ? (
              <>
                of <Money atomic={budget} className="text-text-secondary" /> budget{budgetUsed ? " · limit reached" : ""}
              </>
            ) : (
              "No agent budget set"
            ),
          },
          {
            label: "Cleared · 7d",
            value: <Money atomic={s.cleared7d.usdc} tone="success" />,
            sub: `${s.cleared7d.count} repl${s.cleared7d.count === 1 ? "y" : "ies"} paid`,
          },
          {
            label: "Refunded · 7d",
            value: <Money atomic={s.returned7d.usdc} tone="muted" />,
            sub: `${s.returned7d.count} bid${s.returned7d.count === 1 ? "" : "s"} back to you`,
          },
        ]}
      />

      <Panel padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-4 pt-3">
          <div role="tablist" aria-label="Positions" className="flex gap-1">
            <TabButton active={tab === "open"} onClick={() => setTab("open")} count={open.length}>
              Open positions
            </TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")} count={history.length}>
              History · 30d
            </TabButton>
          </div>
          <div className="flex gap-2 pb-2">
            <Link
              href="/creators"
              className="focus-ring inline-flex h-8 items-center rounded-lg border border-border-bright px-3 text-xs font-medium hover:bg-arc-bg-2"
            >
              Browse markets
            </Link>
            <button
              type="button"
              onClick={onOpenAgent}
              className="focus-ring inline-flex h-8 items-center rounded-lg border border-border-bright px-3 text-xs font-medium hover:bg-arc-bg-2"
            >
              {bidderConfig ? "Agent console" : "Deploy an agent"}
            </button>
          </div>
        </div>
        {tab === "open" ? (
          <MarketTable
            caption="Open positions"
            columns={openColumns}
            rows={open}
            rowKey={(b) => b.id}
            defaultSort={{ key: "bid", dir: "desc" }}
            minWidth={980}
            mobileCard={(b) => {
              const d = bidDisplay(b, "bidder");
              const r = refundCountdown(b.createdAt, now);
              return (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <CreatorCell bid={b} />
                    </div>
                    <Money atomic={b.amountUsdc} tone="gold" className="font-medium" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                    <StatusChip tone={d.tone} dot>
                      {d.label}
                    </StatusChip>
                    {b.bookRank && (
                      <Num>
                        #{b.bookRank.rank} of {b.bookRank.of}
                      </Num>
                    )}
                    {b.status !== "placing" && <Num className="text-arc-coral">{r.due ? "refund due now" : `refund ${r.label}`}</Num>}
                    <TxLinks bid={b} hideEmpty />
                  </div>
                  {b.status === "counter_offered" && b.counterOfferAmount && (
                    <span className="text-xs text-arc-lavender">
                      Asked <Money atomic={b.counterOfferAmount} className="text-arc-lavender" />
                    </span>
                  )}
                  {d.note && <span className="text-xs text-text-secondary">{d.note}</span>}
                  {rebidNote(b) && <span className="text-xs text-arc-lavender">{rebidNote(b)}</span>}
                </div>
              );
            }}
            empty={
              <>
                No open bids. Find a creator on the <Link href="/creators" className="text-arc-lavender hover:underline">markets page</Link> or let your agent bid for you.
              </>
            }
          />
        ) : (
          <MarketTable
            caption="Bid history"
            columns={historyColumns}
            rows={history}
            rowKey={(b) => b.id}
            defaultSort={{ key: "when", dir: "desc" }}
            minWidth={900}
            mobileCard={(b) => {
              const d = bidDisplay(b, "bidder");
              const text = b.status === "failed" ? d.note : b.reply;
              return (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <CreatorCell bid={b} />
                    </div>
                    <Money atomic={b.amountUsdc} tone={b.status === "accepted" && b.settlementTxHref ? "success" : "muted"} className="font-medium" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                    <StatusChip tone={d.tone} dot>
                      {d.label}
                    </StatusChip>
                    <Num>{timeAgo(b.settledAt ?? b.createdAt, now)}</Num>
                    <TxLinks bid={b} hideEmpty />
                  </div>
                  {text && <span className={cn("line-clamp-3 text-xs", b.status === "failed" ? "text-arc-coral" : "text-text-secondary")}>{text}</span>}
                  {b.status === "accepted" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <ReplySourceTag source={b.replySource} />
                      <ReplyRating bid={b} />
                    </div>
                  )}
                </div>
              );
            }}
            empty="Nothing settled in the last 30 days."
          />
        )}
        <p className="border-t border-border px-5 py-3 text-xs text-text-secondary">
          Escrowed bids refund automatically 3 days after placing if the creator hasn&apos;t replied. Book rank counts only escrowed bids.
        </p>
      </Panel>
    </div>
  );
}
