/**
 * In-memory stand-ins for Circle, the Arc chain and Inngest, installed with
 * node:test module mocks BEFORE any app module is imported (see installFakes).
 *
 * Only the network edges are faked. Everything in between (lib/bids.ts, the agent,
 * the jobs' logic, the real Postgres database with its locks and conditional updates)
 * runs as in production.
 */
import { mock } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";

const fileUrl = (p: string) => pathToFileURL(path.resolve(p)).href;
const lower = (a: string) => a.toLowerCase();

export interface FakeTx {
  id: string;
  walletId: string;
  refId?: string;
  functionName: string;
  contractAddress: string;
  args: unknown[];
  state: string;
  txHash?: string;
  createDate: string;
}

export interface EscrowBid {
  bidder: string;
  creator: string;
  amount: bigint;
  message: string;
  reply: string;
  status: number; // 0 Pending, 1 Accepted, 2 Rejected, 3 Refunded
  createdAt: bigint; // seconds
}

export const world = {
  /** Every Circle call that reached "Circle", in order. */
  txs: [] as FakeTx[],
  /** Throws from the next Circle submission (simulates an outage or timeout). */
  failNextSubmit: null as Error | null,
  usdc: new Map<string, bigint>(),
  allowance: new Map<string, bigint>(),
  escrowBids: new Map<string, EscrowBid>(),
  refundPeriodSeconds: BigInt(3 * 24 * 3600),
  activeCreators: new Set<string>(),
  receipts: new Map<string, { status: "success" | "reverted"; logs: unknown[] }>(),
  events: [] as { name: string; data: unknown }[],
  /** Throws from inngest.send when set. */
  failInngest: false,

  reset() {
    this.txs.length = 0;
    this.failNextSubmit = null;
    this.usdc.clear();
    this.allowance.clear();
    this.escrowBids.clear();
    this.activeCreators.clear();
    this.receipts.clear();
    this.events.length = 0;
    this.failInngest = false;
    this.refundPeriodSeconds = BigInt(3 * 24 * 3600);
  },

  /** Circle calls made for a given contract function. */
  calls(functionName: string) {
    return this.txs.filter((t) => t.functionName === functionName);
  },

  /** Marks a Circle transaction COMPLETE on-chain with a successful receipt and these logs. */
  complete(txId: string, logs: unknown[] = []) {
    const tx = this.txs.find((t) => t.id === txId);
    if (!tx) throw new Error(`no tx ${txId}`);
    tx.state = "COMPLETE";
    tx.txHash = `0x${txId.replace(/-/g, "").padEnd(64, "0")}`;
    this.receipts.set(tx.txHash, { status: "success", logs });
  },

  /** Marks a Circle transaction FAILED (nothing happened on-chain). */
  fail(txId: string) {
    const tx = this.txs.find((t) => t.id === txId);
    if (!tx) throw new Error(`no tx ${txId}`);
    tx.state = "FAILED";
  },
};

let nextTx = 1;

function submit(params: { walletId: string; contractAddress: string; functionName: string; args: unknown[]; refId?: string }) {
  if (world.failNextSubmit) {
    const err = world.failNextSubmit;
    world.failNextSubmit = null;
    throw err;
  }
  const tx: FakeTx = {
    id: `tx-${String(nextTx++).padStart(6, "0")}`,
    walletId: params.walletId,
    refId: params.refId,
    functionName: params.functionName,
    contractAddress: lower(params.contractAddress),
    args: params.args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
    state: "INITIATED",
    createDate: new Date().toISOString(),
  };
  world.txs.push(tx);
  return { txId: tx.id, state: tx.state };
}

/** A BidPlaced log as the escrow would emit it (for placeBid receipts). */
export function bidPlacedLog(escrow: string, bidId: bigint, bidder: string, creator: string, amount: bigint) {
  const event = {
    type: "event",
    name: "BidPlaced",
    inputs: [
      { name: "bidId", type: "uint256", indexed: true },
      { name: "bidder", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  } as const;
  return {
    address: escrow as Hex,
    topics: encodeEventTopics({ abi: [event], eventName: "BidPlaced", args: { bidId, bidder: bidder as Hex, creator: creator as Hex } }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    blockHash: `0x${"1".repeat(64)}`,
    blockNumber: BigInt(1),
    logIndex: 0,
    transactionHash: `0x${"2".repeat(64)}`,
    transactionIndex: 0,
    removed: false,
  };
}

/** Puts a bid in the fake escrow and returns its on-chain id. */
export function escrowBid(bid: Omit<EscrowBid, "status" | "reply" | "message" | "createdAt"> & Partial<EscrowBid>): string {
  const id = String(world.escrowBids.size + 1);
  world.escrowBids.set(id, {
    message: "",
    reply: "",
    status: 0,
    createdAt: BigInt(Math.floor(Date.now() / 1000)),
    ...bid,
    bidder: lower(bid.bidder),
    creator: lower(bid.creator),
  });
  return id;
}

const fakePublicClient = {
  async readContract({ functionName, args, address }: { functionName: string; args?: readonly unknown[]; address: string }) {
    switch (functionName) {
      case "balanceOf":
        return world.usdc.get(lower(String(args![0]))) ?? BigInt(0);
      case "allowance":
        return world.allowance.get(`${lower(String(args![0]))}:${lower(String(args![1]))}`) ?? BigInt(0);
      case "getBid": {
        const b = world.escrowBids.get(String(args![0]));
        const zero = "0x0000000000000000000000000000000000000000";
        return b
          ? [b.bidder, b.creator, b.amount, b.message, b.reply, b.status, b.createdAt]
          : [zero, zero, BigInt(0), "", "", 0, BigInt(0)];
      }
      case "getBidCount":
        return BigInt(world.escrowBids.size);
      case "REFUND_PERIOD":
        return world.refundPeriodSeconds;
      case "isActiveCreator":
        return world.activeCreators.has(lower(String(args![0])));
      default:
        throw new Error(`fake chain: unhandled readContract ${functionName} on ${address}`);
    }
  },
  async getTransactionReceipt({ hash }: { hash: string }) {
    const r = world.receipts.get(hash);
    if (!r) throw new Error(`fake chain: no receipt ${hash}`);
    return r;
  },
  async getLogs() {
    return [];
  },
  async getCode() {
    return "0x";
  },
};

/**
 * Replaces lib/circle.ts, lib/arc.ts and lib/inngest.ts for every later import.
 * Call once, at the top of a test file, after importing ./env.
 */
export async function installFakes(): Promise<void> {
  const actualCircle = await import("../../lib/circle.ts");
  const actualArc = await import("../../lib/arc.ts");

  mock.module(fileUrl("lib/circle.ts"), {
    namedExports: {
      ...actualCircle,
      executeContractCall: async (p: { walletId: string; contractAddress: string; functionName: string; args: unknown[]; refId?: string }) =>
        submit(p),
      executeContractCallOnce: async (p: { walletId: string; contractAddress: string; functionName: string; args: unknown[]; opKey: string }) => {
        const existing = world.txs.find((t) => t.refId === p.opKey && t.walletId === p.walletId);
        if (existing) return { txId: existing.id, state: existing.state };
        return submit({ ...p, refId: p.opKey });
      },
      transferUSDC: async (walletId: string, to: string, amount: string, opKey: string) => {
        const existing = world.txs.find((t) => t.refId === opKey && t.walletId === walletId);
        if (existing) return { txId: existing.id, state: existing.state };
        return submit({ walletId, contractAddress: actualArc.USDC_ADDRESS, functionName: "transfer", args: [to, amount], refId: opKey });
      },
      findTransactionByRefId: async (walletId: string, refId: string) => {
        const tx = world.txs.find((t) => t.refId === refId && t.walletId === walletId);
        return tx ? { txId: tx.id, state: tx.state } : null;
      },
      getTransactionStatus: async (txId: string) => {
        const tx = world.txs.find((t) => t.id === txId);
        if (!tx) throw new Error("Transaction not found");
        return { state: tx.state, txHash: tx.txHash };
      },
      provisionUserWallet: async () => {
        throw new Error("fake circle: provisionUserWallet not used in tests");
      },
    },
  });

  mock.module(fileUrl("lib/arc.ts"), {
    namedExports: { ...actualArc, publicClient: fakePublicClient },
  });

  mock.module(fileUrl("lib/inngest.ts"), {
    namedExports: {
      inngest: {
        send: async (payload: { name: string; data: unknown } | { name: string; data: unknown }[]) => {
          if (world.failInngest) throw new Error("fake inngest: send failed");
          for (const e of Array.isArray(payload) ? payload : [payload]) world.events.push(e);
          return { ids: [] };
        },
        createFunction: (...args: unknown[]) => ({ __fn: args }),
      },
    },
  });
}
