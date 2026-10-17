import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { ARC, ArcError, creatorMarket, listCreators, formatUsdc, marketUrl } from "./arc.js";

const PROTOCOL_VERSION = "2026-07-28";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function explain(err: unknown): string {
  if (err instanceof ArcError) return err.message;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "Arc took too long to answer. Please try again in a moment.";
  }
  console.error(err);
  return "Couldn't read Attnn. on Arc right now. Please try again in a moment.";
}

const RULES = [
  "Bids are paid in USDC on Arc and locked in the AttnnEscrow contract, not held by the creator or by Attnn.",
  "If the creator replies (at least 100 characters), the USDC is released to them.",
  "If the creator declines, the full amount is refunded to the bidder at once.",
  "If there is no reply within 3 days, the bidder can reclaim the full amount.",
  "Each creator sets a minimum price; bids range from $1 to $1,000.",
  "Messages and replies never go on-chain as text: the escrow stores only a fingerprint (hash) of each. Amounts and wallet addresses are public.",
];

function createServer() {
  const server = new McpServer(
    { name: "attnn", version: "0.1.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "how_attnn_works",
    {
      title: "How Attnn. works",
      description:
        "Explains Attnn., the attention marketplace on Arc: how paying a creator for a reply works, the refund rules, and the contract addresses. Use before recommending a creator or a bid.",
      inputSchema: z.object({}).strict(),
      outputSchema: z
        .object({
          summary: z.string(),
          rules: z.array(z.string()),
          network: z.string(),
          contracts: z.object({ registry: z.string(), escrow: z.string(), usdc: z.string() }).strict(),
          bidRangeUsd: z.object({ min: z.string(), max: z.string() }).strict(),
          refundAfterHours: z.number(),
          website: z.string(),
        })
        .strict(),
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async () => {
      const summary =
        "Attnn. lets anyone pay a creator in USDC for a guaranteed reply. The bid waits in an on-chain escrow on Arc: the creator earns it by replying, and the bidder is refunded if they decline or don't reply within 3 days.";
      return {
        content: [{ type: "text", text: `${summary}\n\n- ${RULES.join("\n- ")}\n\nBrowse creators: ${ARC.site}/creators` }],
        structuredContent: {
          summary,
          rules: RULES,
          network: `Arc mainnet (${ARC.chain})`,
          contracts: { registry: ARC.registry, escrow: ARC.escrow, usdc: ARC.usdc },
          bidRangeUsd: { min: formatUsdc(ARC.minBidAtomic), max: formatUsdc(ARC.maxBidAtomic) },
          refundAfterHours: ARC.refundPeriodSeconds / 3600,
          website: ARC.site,
        },
      };
    },
  );

  server.registerTool(
    "find_creators",
    {
      title: "Find creators on Attnn.",
      description:
        "Lists creators currently accepting paid bids on Attnn., read live from the Attnn. registry on Arc mainnet. Optionally filter by a topic tag such as \"ai\", \"design\" or \"web3\". Returns each creator's minimum price in USDC and their market link.",
      inputSchema: z
        .object({
          tag: z.string().trim().min(1).max(32).optional().describe("Topic tag, e.g. \"ai\". Leave out to list everyone."),
          limit: z.number().int().min(1).max(20).optional().describe("How many creators to return (default 10)."),
        })
        .strict(),
      outputSchema: z
        .object({
          tag: z.string().nullable(),
          count: z.number().int(),
          creators: z.array(
            z
              .object({
                handle: z.string().nullable(),
                address: z.string(),
                minBidUsd: z.string(),
                minBidAtomicUsdc: z.string(),
                totalBids: z.string(),
                marketUrl: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ tag, limit }) => {
      try {
        const n = limit ?? 10;
        const creators = await listCreators(tag, n);
        const rows = creators.map((c) => ({
          handle: c.handle,
          address: c.address,
          minBidUsd: formatUsdc(c.minBidAtomic),
          minBidAtomicUsdc: c.minBidAtomic.toString(),
          totalBids: c.totalBids.toString(),
          marketUrl: c.handle ? marketUrl(c.handle) : null,
        }));
        const text =
          rows.length === 0
            ? `No active creators${tag ? ` tagged "${tag}"` : ""} on Attnn. yet. Browse all: ${ARC.site}/creators`
            : rows
                .map((r) => `- ${r.handle ? `@${r.handle}` : r.address}: from ${r.minBidUsd}, ${r.totalBids} bids so far${r.marketUrl ? ` (${r.marketUrl})` : ""}`)
                .join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { tag: tag ? tag.toLowerCase() : null, count: rows.length, creators: rows },
        };
      } catch (err) {
        return failure(explain(err));
      }
    },
  );

  server.registerTool(
    "creator_market",
    {
      title: "Check a creator's market",
      description:
        "Shows what it costs to get a reply from one Attnn. creator, read live from the escrow on Arc mainnet: their minimum price, open bids and the highest one, how often they reply, and the link to place a bid.",
      inputSchema: z
        .object({
          handle: z.string().trim().min(1).max(64).describe("The creator's Attnn. handle, without @."),
        })
        .strict(),
      outputSchema: z
        .object({
          found: z.boolean(),
          handle: z.string(),
          address: z.string().nullable(),
          acceptingBids: z.boolean(),
          minBidUsd: z.string().nullable(),
          minBidAtomicUsdc: z.string().nullable(),
          tags: z.array(z.string()),
          openBids: z.number().int(),
          topOpenBidUsd: z.string().nullable(),
          replied: z.number().int(),
          declined: z.number().int(),
          refunded: z.number().int(),
          replyRatePercent: z.number().nullable(),
          totalBids: z.string(),
          bidsScanned: z.number().int(),
          marketUrl: z.string(),
          note: z.string(),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ handle }) => {
      try {
        const clean = handle.replace(/^@/, "").toLowerCase();
        const m = await creatorMarket(clean);
        if (!m) {
          return {
            content: [{ type: "text", text: `No Attnn. creator called @${clean} on Arc. Browse creators: ${ARC.site}/creators` }],
            structuredContent: {
              found: false, handle: clean, address: null, acceptingBids: false, minBidUsd: null, minBidAtomicUsdc: null,
              tags: [], openBids: 0, topOpenBidUsd: null, replied: 0, declined: 0, refunded: 0, replyRatePercent: null,
              totalBids: "0", bidsScanned: 0, marketUrl: `${ARC.site}/creators`, note: "Creator not found.",
            },
          };
        }
        const s = m.stats;
        const accepting = m.isActive && !m.biddingPaused;
        const note = !m.isActive
          ? "This creator's market is paused, so they aren't taking bids right now."
          : m.biddingPaused
            ? "New bids on Attnn. are paused for maintenance right now; open bids still settle and refund as normal."
            : `Bid at least ${formatUsdc(m.minBidAtomic)} on ${marketUrl(m.handle)}. The USDC waits in the escrow: paid out only if they reply, refunded if they decline or don't reply within 3 days.`;
        const rate = s.replyRatePercent === null ? "no track record yet" : `${s.replyRatePercent}% reply rate`;
        const text = [
          `@${m.handle} on Attnn. (Arc mainnet)`,
          `Minimum: ${formatUsdc(m.minBidAtomic)} · Open bids: ${s.openBids}${s.topOpenBidAtomic !== null ? ` (top ${formatUsdc(s.topOpenBidAtomic)})` : ""} · ${rate}`,
          `Replied ${s.replied} · Declined ${s.declined} · Unanswered and refunded ${s.refunded}`,
          note,
        ].join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: {
            found: true,
            handle: m.handle,
            address: m.address,
            acceptingBids: accepting,
            minBidUsd: formatUsdc(m.minBidAtomic),
            minBidAtomicUsdc: m.minBidAtomic.toString(),
            tags: m.tags,
            openBids: s.openBids,
            topOpenBidUsd: s.topOpenBidAtomic === null ? null : formatUsdc(s.topOpenBidAtomic),
            replied: s.replied,
            declined: s.declined,
            refunded: s.refunded,
            replyRatePercent: s.replyRatePercent,
            totalBids: m.totalBids.toString(),
            bidsScanned: s.bidsScanned,
            marketUrl: marketUrl(m.handle),
            note,
          },
        };
      } catch (err) {
        return failure(explain(err));
      }
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
