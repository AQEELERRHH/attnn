// Simulated Arc: answers eth_call batches and log queries from in-memory state, so the
// read logic is tested end to end without a network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, keccak256, pad, toHex, type Hex } from "viem";
import { ARC, CREATOR_REGISTERED_TOPIC, computeMarket, creatorMarket, listCreators, parseHandles, escrowAbi, formatUsdc, registryAbi } from "../src/arc.ts";

const A = getAddress("0x1111111111111111111111111111111111111111");
const B = getAddress("0x2222222222222222222222222222222222222222");
const C = getAddress("0x3333333333333333333333333333333333333333");
const now = BigInt(Math.floor(Date.now() / 1000));
const DAY = BigInt(86400);

type Creator = { handle: string; minBid: bigint; tags: string[]; active: boolean };
let creators: Map<string, Creator>;
let bids: { creator: string; amount: bigint; status: number; createdAt: bigint }[];
let paused: boolean;
let explorerUp: boolean;
let siteUp: boolean;
let calls: number;
let batchUnsupported: boolean;
let rpcBusy: boolean;

beforeEach(() => {
  creators = new Map([
    [A, { handle: "asmau", minBid: BigInt(1_000_000), tags: ["ai", "web3"], active: true }],
    [B, { handle: "bola", minBid: BigInt(5_000_000), tags: ["ai"], active: true }],
    [C, { handle: "chidi", minBid: BigInt(2_000_000), tags: ["ai"], active: false }],
  ]);
  bids = [
    { creator: A, amount: BigInt(3_000_000), status: 0, createdAt: now - DAY },        // open
    { creator: A, amount: BigInt(7_500_000), status: 0, createdAt: now - DAY },        // open, top
    { creator: A, amount: BigInt(1_000_000), status: 0, createdAt: now - DAY * BigInt(4) }, // past 3 days
    { creator: A, amount: BigInt(2_000_000), status: 1, createdAt: now - DAY * BigInt(5) }, // replied
    { creator: A, amount: BigInt(2_000_000), status: 1, createdAt: now - DAY * BigInt(5) }, // replied
    { creator: A, amount: BigInt(2_000_000), status: 1, createdAt: now - DAY * BigInt(5) }, // replied
    { creator: A, amount: BigInt(2_000_000), status: 2, createdAt: now - DAY * BigInt(5) }, // declined
    { creator: A, amount: BigInt(2_000_000), status: 3, createdAt: now - DAY * BigInt(9) }, // refunded
    { creator: B, amount: BigInt(5_000_000), status: 1, createdAt: now - DAY },
  ];
  paused = false;
  explorerUp = true;
  siteUp = true;
  calls = 0;
  batchUnsupported = false;
  rpcBusy = false;
});

function answer(to: string, data: Hex): Hex | { revert: true } {
  const isRegistry = to.toLowerCase() === ARC.registry.toLowerCase();
  const abi = isRegistry ? registryAbi : escrowAbi;
  const { functionName, args } = decodeFunctionData({ abi, data }) as { functionName: string; args: readonly unknown[] };
  const enc = (result: unknown) => encodeFunctionResult({ abi, functionName, result } as never);
  const mine = (addr: string) => bids.map((b, i) => ({ ...b, id: BigInt(i + 1) })).filter((b) => b.creator === getAddress(addr));
  switch (functionName) {
    case "getCreatorProfile": {
      const entry = [...creators].find(([, c]) => c.handle === args[0]);
      if (!entry) return { revert: true };
      return enc([entry[0], entry[1].minBid, entry[1].tags, "", entry[1].active]);
    }
    case "getCreatorsByTagPage":
      return enc([...creators].filter(([, c]) => c.tags.includes(args[0] as string)).map(([a]) => a));
    case "isActiveCreator": return enc(creators.get(getAddress(args[0] as string))?.active ?? false);
    case "minBidOf": return enc(creators.get(getAddress(args[0] as string))?.minBid ?? BigInt(0));
    case "getCreatorBidCount": return enc(BigInt(mine(args[0] as string).length));
    case "getCreatorBidsPage": {
      const [addr, offset, limit] = args as [string, bigint, bigint];
      return enc(mine(addr).slice(Number(offset), Number(offset + limit)).map((b) => b.id));
    }
    case "getBid": {
      const b = bids[Number(args[0] as bigint) - 1]!;
      return enc([A, b.creator, b.amount, pad("0x01"), pad("0x00"), b.status, b.createdAt]);
    }
    case "paused": return enc(paused);
    default: throw new Error(`unexpected ${functionName}`);
  }
}

function registrationLogs() {
  return [...creators].map(([addr, c]) => ({
    topics: [CREATOR_REGISTERED_TOPIC, pad(addr as Hex)],
    data: encodeAbiParameters([{ type: "string" }, { type: "uint256" }], [c.handle, c.minBid]),
  }));
}

globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  calls++;
  const u = String(url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (u === `${ARC.site}/creators`) {
    if (!siteUp) return new Response("down", { status: 503 });
    const links = [...creators.values()].map((c) => `<a href="/c/${c.handle}">@${c.handle}</a>`).join("");
    return new Response(`<html><body>${links}<a href="/c/ghost">not on Arc</a><a href="/about">x</a></body></html>`, { status: 200 });
  }
  if (u.startsWith(`${ARC.explorer}/api?`)) {
    if (!explorerUp) return new Response("down", { status: 502 });
    return json({ status: "1", result: registrationLogs() });
  }
  if (u === ARC.rpc) {
    const body = JSON.parse(String(init?.body));
    if (!Array.isArray(body) && body.method === "eth_getLogs") return json({ jsonrpc: "2.0", id: body.id, result: registrationLogs() });
    if (Array.isArray(body) && batchUnsupported) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch not supported" } });
    if (!Array.isArray(body)) {
      const r = answer(body.params[0].to, body.params[0].data);
      return json(typeof r === "string" ? { jsonrpc: "2.0", id: body.id, result: r } : { jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted" } });
    }
    if (rpcBusy) return json(body.map((req: { id: number }) => ({ jsonrpc: "2.0", id: req.id, error: { code: -32005, message: "rate limited" } })));
    return json(body.map((req: { id: number; params: [{ to: string; data: Hex }] }) => {
      const r = answer(req.params[0].to, req.params[0].data);
      return typeof r === "string"
        ? { jsonrpc: "2.0", id: req.id, result: r }
        : { jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted" } };
    }));
  }
  throw new Error(`unexpected host ${u}`);
}) as typeof fetch;

test("formatUsdc uses whole cents, no floats", () => {
  assert.equal(formatUsdc(BigInt(1_000_000)), "$1.00");
  assert.equal(formatUsdc(BigInt(7_509_999)), "$7.50");
  assert.equal(formatUsdc(BigInt(1_000_000_000)), "$1,000.00");
});

test("creator_market: floor, open bids, top bid and reply rate from the escrow", async () => {
  const m = await creatorMarket("@asmau".replace(/^@/, ""));
  assert.ok(m);
  assert.equal(m.address, A);
  assert.equal(m.minBidAtomic, BigInt(1_000_000));
  assert.equal(m.stats.openBids, 2);
  assert.equal(m.stats.topOpenBidAtomic, BigInt(7_500_000));
  assert.equal(m.stats.awaitingRefund, 1, "a pending bid past 3 days isn't counted as open");
  assert.equal(m.stats.replied, 3);
  assert.equal(m.stats.declined, 1);
  assert.equal(m.stats.refunded, 1);
  assert.equal(m.stats.replyRatePercent, 75, "replied ÷ (replied + refunded); declines don't count against it");
  assert.equal(m.totalBids, BigInt(8));
});

test("creator_market: handles are matched case-insensitively; unknown handle = null, not an error", async () => {
  assert.equal((await creatorMarket("ASMAU"))?.handle, "asmau");
  assert.equal(await creatorMarket("nobody"), null);
});

test("creator_market reports a pause", async () => {
  paused = true;
  assert.equal((await creatorMarket("bola"))?.biddingPaused, true);
});

test("find_creators by tag: active only, busiest first, checked on Arc", async () => {
  const list = await listCreators("AI", 10);
  assert.deepEqual(list.map((c) => c.handle), ["asmau", "bola"], "chidi is paused; ghost isn't registered");
  assert.equal(list[1]!.minBidAtomic, BigInt(5_000_000));
  assert.deepEqual((await listCreators("web3", 10)).map((c) => c.handle), ["asmau"]);
  assert.deepEqual(await listCreators("cooking", 10), []);
});

test("find_creators with no tag lists every active market", async () => {
  assert.deepEqual((await listCreators(undefined, 10)).map((c) => c.handle), ["asmau", "bola"]);
  assert.deepEqual((await listCreators(undefined, 1)).map((c) => c.handle), ["asmau"]);
});

test("if attnn.xyz is down, handles come from the registry's events", async () => {
  siteUp = false;
  assert.deepEqual((await listCreators(undefined, 10)).map((c) => c.handle), ["asmau", "bola"]);
  explorerUp = false;
  assert.deepEqual((await listCreators("ai", 10)).map((c) => c.handle), ["asmau", "bola"]);
});

test("parseHandles reads market links from the page and ignores other links", () => {
  assert.deepEqual(parseHandles('<a href="/c/Emdee002">x</a><a href="/c/emdee002?ref=1">y</a><a href="/about">z</a>\\"/c/bola\\"'), ["emdee002", "bola"]);
});

test("a market with no bids has no reply rate (not 0%)", () => {
  assert.equal(computeMarket([], now).replyRatePercent, null);
});

test("reads are batched: one market lookup is a handful of requests", async () => {
  await creatorMarket("asmau");
  assert.ok(calls <= 4, `made ${calls} requests`);
});

test("an RPC that refuses batches still works (calls sent one by one)", async () => {
  batchUnsupported = true;
  assert.equal((await creatorMarket("asmau"))?.stats.openBids, 2);
  assert.equal(await creatorMarket("nobody"), null);
});

test("a busy RPC is an error, never 'creator not found'", async () => {
  rpcBusy = true;
  await assert.rejects(creatorMarket("asmau"), /busy/);
});
