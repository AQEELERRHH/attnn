/**
 * Read-only access to Attnn.'s contracts on Arc mainnet.
 * Everything here is a public on-chain read: no keys, no secrets, no writes.
 * Network hosts used: rpc.mainnet.arc.io (JSON-RPC) and explorer.arc.io (event logs).
 */
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  toEventSelector,
  type Hex,
} from "viem";

export const ARC = {
  chain: "eip155:5042",
  rpc: "https://rpc.mainnet.arc.io",
  explorer: "https://explorer.arc.io",
  registry: "0x024Bd6D6bdD990274Be4e99F919e7D71349782D8",
  escrow: "0xFF00aA5414e205367aF5DD29927E23a1CCF3bAD8",
  usdc: "0x3600000000000000000000000000000000000000",
  deployBlock: 25927568,
  site: "https://attnn.xyz",
  refundPeriodSeconds: 259200, // 3 days, AttnnEscrow.REFUND_PERIOD
  minBidAtomic: BigInt(1_000_000), // $1, AttnnEscrow.MIN_BID
  maxBidAtomic: BigInt(1_000_000_000), // $1,000, AttnnEscrow.MAX_BID
} as const;

const TIMEOUT_MS = 3500;
const MAX_BIDS_SCANNED = 100;

export const registryAbi = parseAbi([
  "function getCreatorProfile(string handle) view returns (address creator, uint256 minBid, string[] tags, string profileURI, bool isActive)",
  "function getCreatorsByTagPage(string tag, uint256 offset, uint256 limit) view returns (address[] page)",
  "function isActiveCreator(address creator) view returns (bool)",
  "function minBidOf(address creator) view returns (uint256)",
  "function getCreatorCount() view returns (uint256)",
  "event CreatorRegistered(address indexed creator, string handle, uint256 minBid)",
]);

export const escrowAbi = parseAbi([
  "function getBid(uint256 bidId) view returns (address bidder, address creator, uint256 amount, bytes32 messageHash, bytes32 replyHash, uint8 status, uint256 createdAt)",
  "function getCreatorBidCount(address creator) view returns (uint256)",
  "function getCreatorBidsPage(address creator, uint256 offset, uint256 limit) view returns (uint256[])",
  "function getBidCount() view returns (uint256)",
  "function paused() view returns (bool)",
]);

export const CREATOR_REGISTERED_TOPIC = toEventSelector(
  "CreatorRegistered(address,string,uint256)",
);

export class ArcError extends Error {}

// ── Formatting (BigInt only, never float maths on money) ──

/** "1500000" → "$1.50" */
export function formatUsdc(atomic: bigint): string {
  const neg = atomic < BigInt(0);
  const abs = neg ? -atomic : atomic;
  const dollars = abs / BigInt(1_000_000);
  const cents = (abs % BigInt(1_000_000)) / BigInt(10_000);
  const whole = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${whole}.${cents.toString().padStart(2, "0")}`;
}

export function marketUrl(handle: string): string {
  return `${ARC.site}/c/${encodeURIComponent(handle.toLowerCase())}`;
}

/** Handles and tags as the app stores them: trimmed, lower-case. */
export function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

// ── JSON-RPC ──

type Call = { to: string; data: Hex };
type RpcResponse = { id: number; result?: Hex; error?: { message?: string; data?: unknown } };

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new ArcError(`Arc RPC answered ${res.status}`);
  return res.json();
}

/** eth_call for each call, in one batched request. A reverted call comes back as null. */
export async function ethCalls(calls: Call[]): Promise<(Hex | null)[]> {
  if (calls.length === 0) return [];
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_call",
    params: [{ to: c.to, data: c.data }, "latest"],
  }));
  let json = await postJson(ARC.rpc, body);
  if (!Array.isArray(json)) {
    // Batches not accepted: send the calls one by one (in parallel) instead.
    json = await Promise.all(body.map((one) => postJson(ARC.rpc, one)));
  }
  const byId = new Map<number, RpcResponse>();
  for (const r of json as RpcResponse[]) byId.set(r.id, r);
  return calls.map((_, i) => {
    const r = byId.get(i);
    if (!r) throw new ArcError("Arc RPC answer was incomplete");
    if (r.error) {
      // A revert (e.g. an unknown handle) is an answer; anything else (rate limit, outage) is not.
      const e = r.error as { code?: number; message?: string };
      if (e.code === 3 || /revert/i.test(e.message ?? "")) return null;
      throw new ArcError("Arc RPC is busy right now. Please try again in a moment.");
    }
    return r.result ?? null;
  });
}

type ReadSpec = { to: string; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] };

/** Reads many view functions at once. null = the call reverted. */
export async function readMany(specs: ReadSpec[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < specs.length; i += 80) {
    const chunk = specs.slice(i, i + 80);
    const raw = await ethCalls(
      chunk.map((s) => ({
        to: s.to,
        data: encodeFunctionData({ abi: s.abi, functionName: s.functionName, args: s.args ?? [] } as unknown as Parameters<typeof encodeFunctionData>[0]),
      })),
    );
    raw.forEach((data, j) => {
      const s = chunk[j]!;
      out.push(
        data === null || data === "0x"
          ? null
          : decodeFunctionResult({ abi: s.abi, functionName: s.functionName, data } as unknown as Parameters<typeof decodeFunctionResult>[0]),
      );
    });
  }
  return out;
}

// ── Handles (from CreatorRegistered events) ──

type RawLog = { topics: Hex[]; data: Hex };

export function decodeRegistrations(logs: RawLog[]): Map<string, string> {
  const handles = new Map<string, string>(); // address (checksummed) → handle (lower-case)
  for (const log of logs) {
    try {
      const ev = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName !== "CreatorRegistered") continue;
      handles.set(getAddress(ev.args.creator), ev.args.handle.toLowerCase());
    } catch {
      // not ours; skip
    }
  }
  return handles;
}

async function logsFromExplorer(): Promise<RawLog[]> {
  const q = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: String(ARC.deployBlock),
    toBlock: "latest",
    address: ARC.registry,
    topic0: CREATOR_REGISTERED_TOPIC,
  });
  const res = await fetch(`${ARC.explorer}/api?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new ArcError(`Explorer answered ${res.status}`);
  const json = (await res.json()) as { result?: unknown };
  if (!Array.isArray(json.result)) throw new ArcError("Explorer returned no logs");
  return json.result as RawLog[];
}

async function logsFromRpc(): Promise<RawLog[]> {
  const json = (await postJson(ARC.rpc, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [{
      address: ARC.registry,
      topics: [CREATOR_REGISTERED_TOPIC],
      fromBlock: `0x${ARC.deployBlock.toString(16)}`,
      toBlock: "latest",
    }],
  })) as { result?: unknown };
  if (!Array.isArray(json.result)) throw new ArcError("Arc RPC returned no logs");
  return json.result as RawLog[];
}

/** Every registered creator's handle. Best effort: an empty map if neither source answers. */
export async function loadHandles(): Promise<{ handles: Map<string, string>; ok: boolean }> {
  for (const source of [logsFromExplorer, logsFromRpc]) {
    try {
      return { handles: decodeRegistrations(await source()), ok: true };
    } catch (err) {
      console.error(`handle lookup: ${(err as Error).message}`);
    }
  }
  return { handles: new Map(), ok: false };
}

// ── Market maths (pure) ──

export type ChainBid = { id: bigint; amount: bigint; status: number; createdAt: bigint };

export type MarketStats = {
  openBids: number;
  topOpenBidAtomic: bigint | null;
  awaitingRefund: number;
  replied: number;
  declined: number;
  refunded: number;
  replyRatePercent: number | null;
  bidsScanned: number;
};

/** Status: 0 Pending, 1 Accepted, 2 Rejected, 3 Refunded (AttnnEscrow.BidStatus). */
export function computeMarket(bids: ChainBid[], nowSeconds: bigint): MarketStats {
  let openBids = 0;
  let awaitingRefund = 0;
  let replied = 0;
  let declined = 0;
  let refunded = 0;
  let top: bigint | null = null;
  for (const b of bids) {
    if (b.status === 0) {
      if (b.createdAt + BigInt(ARC.refundPeriodSeconds) > nowSeconds) {
        openBids++;
        if (top === null || b.amount > top) top = b.amount;
      } else {
        awaitingRefund++;
      }
    } else if (b.status === 1) replied++;
    else if (b.status === 2) declined++;
    else if (b.status === 3) refunded++;
  }
  // Same rule as Attnn.: replied ÷ (replied + went unanswered). A decline is an answer, not a miss.
  const decided = replied + refunded;
  return {
    openBids,
    topOpenBidAtomic: top,
    awaitingRefund,
    replied,
    declined,
    refunded,
    replyRatePercent: decided === 0 ? null : Math.round((replied * 100) / decided),
    bidsScanned: bids.length,
  };
}

// ── High-level reads ──

export type CreatorSummary = {
  address: string;
  handle: string | null;
  minBidAtomic: bigint;
  totalBids: bigint;
};

export async function creatorsByTag(tag: string, limit: number): Promise<{ creators: CreatorSummary[]; handlesOk: boolean }> {
  const [page] = await readMany([
    { to: ARC.registry, abi: registryAbi, functionName: "getCreatorsByTagPage", args: [normalizeKey(tag), BigInt(0), BigInt(50)] },
  ]);
  const addresses = ((page as readonly string[] | null) ?? []).map((a) => getAddress(a));
  return summarise(addresses, limit);
}

export async function allCreators(limit: number): Promise<{ creators: CreatorSummary[]; handlesOk: boolean }> {
  const { handles, ok } = await loadHandles();
  if (!ok) throw new ArcError("Couldn't list creators right now (explorer and RPC log lookups failed). Try again, or search by tag.");
  return summarise([...handles.keys()].slice(0, 50), limit, handles);
}

async function summarise(
  addresses: string[],
  limit: number,
  knownHandles?: Map<string, string>,
): Promise<{ creators: CreatorSummary[]; handlesOk: boolean }> {
  if (addresses.length === 0) return { creators: [], handlesOk: true };
  const [reads, names] = await Promise.all([
    readMany(
      addresses.flatMap((a) => [
        { to: ARC.registry, abi: registryAbi, functionName: "isActiveCreator", args: [a] },
        { to: ARC.registry, abi: registryAbi, functionName: "minBidOf", args: [a] },
        { to: ARC.escrow, abi: escrowAbi, functionName: "getCreatorBidCount", args: [a] },
      ]),
    ),
    knownHandles ? Promise.resolve({ handles: knownHandles, ok: true }) : loadHandles(),
  ]);
  const creators: CreatorSummary[] = [];
  addresses.forEach((address, i) => {
    const active = reads[i * 3] === true;
    if (!active) return; // paused or deactivated markets aren't offered
    creators.push({
      address,
      handle: names.handles.get(address) ?? null,
      minBidAtomic: (reads[i * 3 + 1] as bigint | null) ?? BigInt(0),
      totalBids: (reads[i * 3 + 2] as bigint | null) ?? BigInt(0),
    });
  });
  creators.sort((a, b) => (b.totalBids > a.totalBids ? 1 : b.totalBids < a.totalBids ? -1 : 0));
  return { creators: creators.slice(0, limit), handlesOk: names.ok };
}

export type CreatorMarket = {
  handle: string;
  address: string;
  minBidAtomic: bigint;
  tags: string[];
  isActive: boolean;
  biddingPaused: boolean;
  totalBids: bigint;
  stats: MarketStats;
};

export async function creatorMarket(handle: string): Promise<CreatorMarket | null> {
  const h = normalizeKey(handle);
  const [profile, paused] = await readMany([
    { to: ARC.registry, abi: registryAbi, functionName: "getCreatorProfile", args: [h] },
    { to: ARC.escrow, abi: escrowAbi, functionName: "paused" },
  ]);
  if (profile === null) return null; // the registry reverts for an unknown handle
  const [address, minBid, tags, , isActive] = profile as readonly [string, bigint, readonly string[], string, boolean];

  const [count] = await readMany([
    { to: ARC.escrow, abi: escrowAbi, functionName: "getCreatorBidCount", args: [address] },
  ]);
  const total = (count as bigint | null) ?? BigInt(0);
  const offset = total > BigInt(MAX_BIDS_SCANNED) ? total - BigInt(MAX_BIDS_SCANNED) : BigInt(0);
  const [ids] = await readMany([
    { to: ARC.escrow, abi: escrowAbi, functionName: "getCreatorBidsPage", args: [address, offset, BigInt(MAX_BIDS_SCANNED)] },
  ]);
  const bidIds = (ids as readonly bigint[] | null) ?? [];
  const raw = await readMany(bidIds.map((id) => ({ to: ARC.escrow, abi: escrowAbi, functionName: "getBid", args: [id] })));
  const bids: ChainBid[] = [];
  raw.forEach((r, i) => {
    if (!r) return;
    const [, , amount, , , status, createdAt] = r as readonly [string, string, bigint, Hex, Hex, number, bigint];
    bids.push({ id: bidIds[i]!, amount, status: Number(status), createdAt });
  });

  return {
    handle: h,
    address: getAddress(address),
    minBidAtomic: minBid,
    tags: [...tags],
    isActive,
    biddingPaused: paused === true,
    totalBids: total,
    stats: computeMarket(bids, BigInt(Math.floor(Date.now() / 1000))),
  };
}
