/**
 * The real lib/circle.ts against a fake Circle SDK client: the refId lookup that pages
 * back through history (M4), the idempotency-reuse path, and transferUSDC's stable
 * idempotency key (H3). No database needed.
 */
import "../helpers/env.mts";
import { beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

interface SdkTx {
  id: string;
  refId?: string;
  state: string;
  createDate: string;
  walletId: string;
}
const sdk = {
  txs: [] as SdkTx[],
  created: [] as Record<string, unknown>[],
  listCalls: 0,
  rejectIdempotent: false,
};

class FakeClient {
  async listTransactions(input: { walletIds: string[]; pageSize: number; order?: string; from?: string; to?: string }) {
    sdk.listCalls++;
    let list = sdk.txs.filter((t) => input.walletIds.includes(t.walletId));
    if (input.from) list = list.filter((t) => t.createDate >= input.from!);
    if (input.to) list = list.filter((t) => t.createDate <= input.to!);
    list.sort((a, b) => b.createDate.localeCompare(a.createDate)); // DESC
    return { data: { transactions: list.slice(0, input.pageSize) } };
  }
  async createContractExecutionTransaction(input: Record<string, unknown>) {
    if (sdk.rejectIdempotent) {
      const err = new Error("idempotency key already used") as Error & { code: number };
      err.code = 156020;
      throw err;
    }
    sdk.created.push(input);
    return { data: { id: `new-${sdk.created.length}`, state: "INITIATED" } };
  }
}
// lib/circle.ts may load the SDK through require() (CommonJS) or import (ESM), which
// resolve to different files: replace both.
const pkg = "@circle-fin/developer-controlled-wallets";
const fake = { namedExports: { CircleDeveloperControlledWalletsClient: FakeClient } };
mock.module(pathToFileURL(createRequire(import.meta.url).resolve(pkg)).href, fake);
mock.module(import.meta.resolve(pkg), fake);

const circle = await import("../../lib/circle.ts");
const { stableUuid } = await import("../../lib/bid-rules.ts");

/** n transactions, one per second, oldest first; the one at `refAt` gets the refId. */
function history(n: number, refAt: number, refId: string) {
  const start = Date.parse("2026-10-01T00:00:00Z");
  sdk.txs = Array.from({ length: n }, (_, i) => ({
    id: `tx-${i}`,
    walletId: "w1",
    state: "COMPLETE",
    createDate: new Date(start + i * 1000).toISOString(),
    ...(i === refAt ? { refId } : {}),
  }));
}

describe("lib/circle.ts against a fake SDK", () => {
  beforeEach(() => {
    sdk.txs = [];
    sdk.created = [];
    sdk.listCalls = 0;
    sdk.rejectIdempotent = false;
  });

  test("M4: finds a transaction far older than the latest 50", async () => {
    history(400, 10, "place:abc");
    const found = await circle.findTransactionByRefId("w1", "place:abc");
    assert.equal(found?.txId, "tx-10");
    assert.ok(sdk.listCalls > 1, "had to page back");
  });

  test("M4: a 'since' bound stops the search early and still finds a recent one", async () => {
    history(400, 395, "settle:x:accept:0");
    const found = await circle.findTransactionByRefId("w1", "settle:x:accept:0", new Date("2026-10-01T00:06:00Z"));
    assert.equal(found?.txId, "tx-395");
  });

  test("returns null, not an error, when the transaction doesn't exist", async () => {
    history(120, -1, "");
    assert.equal(await circle.findTransactionByRefId("w1", "place:nope"), null);
  });

  test("a retried call whose key Circle already used returns the original transaction", async () => {
    history(80, 3, "place:retry");
    sdk.rejectIdempotent = true;
    const res = await circle.executeContractCallOnce({
      walletId: "w1",
      contractAddress: "0x0000000000000000000000000000000000000001",
      abi: [{ type: "function", name: "placeBid", inputs: [], outputs: [], stateMutability: "nonpayable" }],
      functionName: "placeBid",
      args: [],
      opKey: "place:retry",
    });
    assert.equal(res.txId, "tx-3");
  });

  test("H3: transferUSDC uses a stable idempotency key and refId from the op key", async () => {
    await circle.transferUSDC("w1", "0x1111111111111111111111111111111111111111", "5000000", "send:k1");
    await circle.transferUSDC("w1", "0x1111111111111111111111111111111111111111", "5000000", "send:k2");
    assert.equal(sdk.created[0]!.idempotencyKey, stableUuid("send:k1"));
    assert.equal(sdk.created[0]!.refId, "send:k1");
    assert.notEqual(sdk.created[1]!.idempotencyKey, sdk.created[0]!.idempotencyKey);
    assert.deepEqual(sdk.created[0]!.abiParameters, ["0x1111111111111111111111111111111111111111", "5000000"]);
  });
});
