"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  BidTicket,
  Change,
  CreatorAvatar,
  MarketTable,
  Money,
  Num,
  OrderBook,
  Panel,
  Sparkline,
  StatInline,
  StatStrip,
  StatusChip,
  Tag,
  type MarketColumn,
  type OrderBookBid,
} from "@/components/market";
import { bidDisplay } from "@/lib/bid-display";
import type { BidStatus } from "@/lib/db/schema";
import { formatChange } from "@/lib/format";

// SAMPLE DATA — for this reference page only. Real screens get every number from
// bids confirmed on Arc (PR 3).
const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

const sampleBook: OrderBookBid[] = [
  { id: "b1", agent: "Sample Recruiter", owner: "Sample Labs", amountUsdc: "35000000", createdAt: iso(4), score: 8.4 },
  { id: "b2", agent: "Sample Scout", owner: "Sample Ventures", amountUsdc: "25000000", createdAt: iso(2), score: 7.1 },
  { id: "b3", agent: "Sample Talent", owner: null, amountUsdc: "20000000", createdAt: iso(9), score: null },
];

interface SampleMarket {
  handle: string;
  role: string;
  tags: string[];
  floor: string;
  top: string | null;
  last: string | null;
  prev: string | null;
  vol: string | null;
  spark: number[];
}
const sampleMarkets: SampleMarket[] = [
  { handle: "sample.dev", role: "Web3 developer", tags: ["web3", "ai"], floor: "20000000", top: "35000000", last: "35000000", prev: "30000000", vol: "118000000", spark: [20, 22, 25, 24, 30, 35] },
  { handle: "sample.audits", role: "Solidity auditor", tags: ["security"], floor: "60000000", top: "120000000", last: "110000000", prev: "100000000", vol: "520000000", spark: [80, 90, 95, 100, 110] },
  { handle: "sample.new", role: "Mobile developer", tags: ["mobile"], floor: "12000000", top: null, last: null, prev: null, vol: null, spark: [] },
];

const statuses: { status: BidStatus; settlementTxHash?: string; settlementAction?: string; failReason?: string }[] = [
  { status: "placing" },
  { status: "pending" },
  { status: "pending", settlementTxHash: "x", settlementAction: "accept" },
  { status: "counter_offered" },
  { status: "accepted" },
  { status: "rejected" },
  { status: "refunded" },
  { status: "failed", failReason: "Below the creator's floor. No USDC moved." },
];

export function DesignPreview() {
  const columns: MarketColumn<SampleMarket>[] = [
    {
      key: "creator",
      label: "Creator",
      render: (m) => (
        <span className="flex items-center gap-2.5">
          <CreatorAvatar handle={m.handle} />
          <span>
            <span className="block font-semibold">@{m.handle}</span>
            <span className="block text-xs text-text-secondary">{m.role}</span>
          </span>
        </span>
      ),
    },
    { key: "tags", label: "Tags", render: (m) => <span className="flex gap-1">{m.tags.map((t) => <Tag key={t}>{t}</Tag>)}</span> },
    { key: "floor", label: "Floor", align: "right", sortValue: (m) => Number(m.floor), render: (m) => <Money atomic={m.floor} /> },
    { key: "top", label: "Top bid", align: "right", sortValue: (m) => (m.top ? Number(m.top) : null), render: (m) => <Money atomic={m.top} tone="gold" /> },
    {
      key: "last",
      label: "Last cleared",
      align: "right",
      sortValue: (m) => (m.last ? Number(m.last) : null),
      render: (m) => (
        <>
          <Money atomic={m.last} /> <Change value={m.last && m.prev ? formatChange(BigInt(m.last), BigInt(m.prev)) : ""} />
        </>
      ),
    },
    { key: "vol", label: "7d volume", align: "right", sortValue: (m) => (m.vol ? Number(m.vol) : null), render: (m) => <Money atomic={m.vol} /> },
    { key: "trend", label: "7d trend", render: (m) => <Sparkline values={m.spark} label={`7 day cleared price for @${m.handle}`} /> },
    {
      key: "action",
      label: "Action",
      hiddenLabel: true,
      align: "right",
      render: () => (
        <Button size="sm" className="h-9 px-4">
          Bid
        </Button>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-[1320px] space-y-10 px-6 py-10">
      <header>
        <p className="eyebrow">Internal · not linked from the site</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Market design system</h1>
        <p className="mt-2 max-w-[65ch] text-text-secondary">
          Shared pieces for the markets table, creator market page and portfolio. All numbers on this page are sample data.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Colour roles</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 text-sm">
          {[
            ["bg-arc-gold", "Gold", "Money, open bids, primary action"],
            ["bg-green", "Green", "Settled, paid, price up"],
            ["bg-arc-coral", "Coral", "Refund countdowns, warnings, down"],
            ["bg-arc-lavender", "Lavender", "Links, tags, focus ring"],
            ["bg-arc-purple", "Purple", "Decorative only (fails text contrast)"],
          ].map(([cls, name, use]) => (
            <div key={name} className="panel p-3">
              <span className={`mb-2 block h-8 rounded ${cls}`} />
              <span className="block font-medium">{name}</span>
              <span className="block text-xs text-text-secondary">{use}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Stat strip</h2>
        <StatStrip
          items={[
            { label: "In escrow now", value: <Money atomic="1284000000" tone="gold" />, sub: "Read live from AttnnEscrow" },
            { label: "24h settled", value: <Money atomic="212000000" />, sub: <Change value="+18.4%" /> },
            { label: "Bids cleared · 24h", value: <Num>9</Num>, sub: "3 refunded" },
            { label: "Median reply", value: <Num>5h 10m</Num>, sub: "Cleared bids, 7d" },
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Market header numbers</h2>
        <Panel>
          <StatInline
            items={[
              { label: "Floor", value: <Money atomic="20000000" /> },
              { label: "Top bid", value: <Money atomic="35000000" tone="gold" /> },
              { label: "Last cleared", value: <Money atomic="35000000" />, sub: <Change value="+16.7%" /> },
              { label: "7d volume", value: <Money atomic="118000000" /> },
              { label: "Reply rate", value: <Num>92%</Num> },
              { label: "Median reply", value: <Num>4h 56m</Num> },
            ]}
          />
        </Panel>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Bid status chips</h2>
        <div className="panel flex flex-wrap gap-3 p-5">
          {statuses.map((s, i) => {
            const d = bidDisplay(s);
            return (
              <div key={i} className="min-w-[180px]">
                <StatusChip tone={d.tone}>{d.label}</StatusChip>
                <p className="mt-1 max-w-[220px] text-xs text-text-secondary">
                  <code className="num">{s.status}</code>
                  {s.settlementAction ? ` + ${s.settlementAction} in flight` : ""}
                  {d.note ? ` — ${d.note}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Markets table</h2>
        <Panel padded={false}>
          <MarketTable columns={columns} rows={sampleMarkets} rowKey={(m) => m.handle} defaultSort={{ key: "vol", dir: "desc" }} caption="Creator markets" />
        </Panel>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[999_1_600px] space-y-3">
          <h2 className="font-display text-lg font-bold">Order book</h2>
          <Panel padded={false}>
            <OrderBook bids={sampleBook} floorUsdc="20000000" />
          </Panel>
        </section>
        <section className="min-w-0 max-w-[420px] flex-[1_1_340px] space-y-3">
          <h2 className="font-display text-lg font-bold">Bid ticket</h2>
          <BidTicket
            floorUsdc="20000000"
            openBidAmounts={sampleBook.map((b) => b.amountUsdc)}
            biddingAs="Sample Scout · agent wallet"
            escrowAddress="0x7b43b155acc2b191c121fb2fc724669a6f7fbb86"
            onSubmit={async () => ({ ok: true })}
          />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </div>
      </section>
    </main>
  );
}
