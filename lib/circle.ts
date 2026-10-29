import {
  CircleDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { type Abi, type AbiFunction, type Hex } from "viem";
import { usdcAbi, USDC_ADDRESS } from "./arc";
import { arc } from "./chain";
import { stableUuid } from "./bid-rules";

function getSDK(): CircleDeveloperControlledWalletsClient {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error("Circle API credentials not configured");
  }
  return new CircleDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

let walletSetId: string | null = null;

export async function getOrCreateWalletSet(): Promise<string> {
  if (walletSetId) return walletSetId;
  if (process.env.CIRCLE_WALLET_SET_ID) {
    walletSetId = process.env.CIRCLE_WALLET_SET_ID;
    return walletSetId;
  }

  const client = getSDK();

  try {
    const { data } = await client.listWalletSets({});
    if (data?.walletSets?.length && data.walletSets[0]) {
      walletSetId = data.walletSets[0].id!;
      return walletSetId;
    }
  } catch (err) {
    console.warn("Failed to list wallet sets", err);
  }

  const idempotencyKey = crypto.randomUUID();
  const { data } = await client.createWalletSet({
    idempotencyKey,
    name: "Attnn Wallet Set",
  });

  walletSetId = data?.walletSet?.id ?? null;
  if (!walletSetId) throw new Error("Failed to create wallet set");
  return walletSetId;
}

export interface ProvisionedWallet {
  walletId: string;
  address: string;
  blockchain: string;
}

export async function provisionUserWallet(
  _userId: string,
  _name: string,
): Promise<ProvisionedWallet> {
  const client = getSDK();
  const wsId = await getOrCreateWalletSet();
  const idempotencyKey = crypto.randomUUID();

  const { data } = await client.createWallets({
    idempotencyKey,
    walletSetId: wsId,
    blockchains: [arc.circleBlockchain],
    count: 1,
  });

  const wallet = data?.wallets?.[0];
  if (!wallet) throw new Error("Failed to create wallet");

  return {
    walletId: wallet.id!,
    address: wallet.address!,
    blockchain: wallet.blockchain!,
  };
}

export interface ExecuteContractResult {
  txId: string;
  state: string;
}

/**
 * Submits a contract call through Circle. Returns as soon as Circle accepts it —
 * it does NOT wait for the chain. Use getTransactionStatus/classifyTxState (or the
 * Inngest helpers in inngest/tx.ts) before treating the call as done.
 *
 * Pass a stable `idempotencyKey` (a UUID v4 generated once and reused on retries)
 * whenever the call can be retried, e.g. inside an Inngest step. Circle returns the
 * original transaction instead of sending a second one.
 */
export async function executeContractCall(params: {
  walletId: string;
  contractAddress: string;
  abi: Abi;
  functionName: string;
  args: unknown[];
  idempotencyKey?: string;
  refId?: string;
}): Promise<ExecuteContractResult> {
  const client = getSDK();
  const idempotencyKey = params.idempotencyKey ?? crypto.randomUUID();

  // The SDK JSON-serialises abiParameters, which throws on BigInt. Send uint256s
  // as decimal strings.
  const abiParameters = params.args.map((a) => (typeof a === "bigint" ? a.toString() : a));

  const { data } = await client.createContractExecutionTransaction({
    idempotencyKey,
    walletId: params.walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: `${params.functionName}(${params.abi
      .filter((f): f is AbiFunction => f.type === "function" && f.name === params.functionName)
      .flatMap((f) => f.inputs?.map((i) => i.type) ?? [])
      .join(",")})`,
    abiParameters: abiParameters as Record<string, unknown>[],
    fee: { type: "level" as const, config: { feeLevel: "MEDIUM" as const } },
    ...(params.refId ? { refId: params.refId } : {}),
  });

  if (!data?.id) throw new Error(`Circle did not return a transaction id for ${params.functionName}`);

  return {
    txId: data.id,
    state: data.state ?? "INITIATED",
  };
}

// Circle error codes meaning "this idempotency key was already used".
const IDEMPOTENCY_REUSED_CODES = new Set([156020, 175403]);

function isIdempotencyReuse(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && typeof e.code === "number" && IDEMPOTENCY_REUSED_CODES.has(e.code)) return true;
  return typeof e?.message === "string" && /idempotency key/i.test(e.message);
}

/** Pages of 50 searched before giving up (2,500 transactions). */
const REF_LOOKUP_MAX_PAGES = 50;

/**
 * Finds a transaction from this wallet by the refId we gave it.
 *
 * Circle can't filter by refId, so this pages back through the wallet's
 * transactions, newest first. Pass `since` (e.g. the bid's creation time) to stop
 * early; without it the search goes back up to 2,500 transactions. Paging moves the
 * time window's end back to the oldest item seen, so it doesn't depend on the
 * direction of Circle's page cursors. A busy agent wallet makes two transactions
 * per bid, so the latest 50 alone was not enough (a missed transaction could mark
 * an escrowed bid "failed").
 */
export async function findTransactionByRefId(
  walletId: string,
  refId: string,
  since?: Date,
): Promise<ExecuteContractResult | null> {
  const client = getSDK();
  const from = since ? new Date(since.getTime() - 5 * 60 * 1000).toISOString() : undefined;
  let to: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < REF_LOOKUP_MAX_PAGES; page++) {
    const { data } = await client.listTransactions({ walletIds: [walletId], pageSize: 50, order: "DESC", from, to });
    const txs = data?.transactions ?? [];
    const match = txs.find((t) => t.refId === refId);
    if (match) return { txId: match.id, state: match.state };
    const fresh = txs.filter((t) => !seen.has(t.id));
    if (fresh.length === 0 || txs.length < 50) return null; // reached the start of the window
    for (const t of fresh) seen.add(t.id);
    // Next window ends at the oldest item on this page (inclusive, so repeats are skipped above).
    to = txs[txs.length - 1]!.createDate;
  }
  console.warn(`findTransactionByRefId: gave up on ${refId} after ${REF_LOOKUP_MAX_PAGES} pages`);
  return null;
}

/**
 * Submits a contract call at most once per `opKey` (e.g. "place:<bidId>").
 *
 * The key becomes both Circle's idempotencyKey (as a stable UUID) and the
 * transaction's refId. If a retry is told the key was already used, the original
 * transaction is looked up by refId and returned — a retry never sends a second
 * bid, payout or refund.
 */
export async function executeContractCallOnce(
  params: Omit<Parameters<typeof executeContractCall>[0], "idempotencyKey" | "refId"> & { opKey: string },
): Promise<ExecuteContractResult> {
  const { opKey, ...call } = params;
  try {
    return await executeContractCall({ ...call, idempotencyKey: stableUuid(opKey), refId: opKey });
  } catch (err) {
    if (isIdempotencyReuse(err)) {
      const existing = await findTransactionByRefId(call.walletId, opKey);
      if (existing) return existing;
      throw new Error(`Circle reports "${opKey}" was already submitted but the transaction could not be found`);
    }
    throw err;
  }
}

/**
 * Sends USDC at most once per `opKey`. Callers build the key from a request id the
 * browser generates once per send, so a double click or a retried request returns
 * the original transfer instead of paying twice.
 */
export async function transferUSDC(
  walletId: string,
  to: string,
  amount: string,
  opKey: string,
): Promise<ExecuteContractResult> {
  return executeContractCallOnce({
    walletId,
    contractAddress: USDC_ADDRESS,
    abi: usdcAbi as unknown as Abi,
    functionName: "transfer",
    args: [to, amount],
    opKey,
  });
}

/**
 * True only when Circle answered and refused the request (a 4xx other than a timeout),
 * so it can't have been accepted. Timeouts, network errors and 5xx are unknown: the
 * request may have gone through.
 */
export function rejectedByCircle(err: unknown): boolean {
  const e = err as { status?: unknown; response?: { status?: unknown } } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.response?.status === "number" ? e.response.status : null;
  return status !== null && status >= 400 && status < 500 && status !== 408;
}

/** A browser-generated request id (UUID), or null if missing or malformed. */
export function parseRequestId(v: unknown): string | null {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
}

/**
 * Signs EIP-712 typed data with a developer-controlled wallet (EOA), for off-chain
 * authorisations such as an x402 Gateway payment. `typedData` is the standard
 * eth_signTypedData_v4 JSON (domain, types incl. EIP712Domain, primaryType, message).
 */
export async function signTypedDataWithCircle(walletId: string, typedData: string, memo?: string): Promise<Hex> {
  const client = getSDK();
  const { data } = await client.signTypedData({ walletId, data: typedData, ...(memo ? { memo } : {}) });
  const signature = data?.signature;
  if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error("Circle did not return a signature");
  return signature as Hex;
}

export interface TransactionStatus {
  state: string;
  txHash?: string;
  // Populated by Circle for failed transactions.
  errorReason?: string;
  errorDetails?: string;
}

export async function getTransactionStatus(txId: string): Promise<TransactionStatus> {
  const client = getSDK();

  const { data } = await client.getTransaction({ id: txId });
  const tx = data?.transaction;
  if (!tx) throw new Error("Transaction not found");

  return {
    state: tx.state!,
    txHash: tx.txHash as Hex | undefined,
    errorReason: tx.errorReason,
    errorDetails: tx.errorDetails,
  };
}

/**
 * Circle developer-controlled wallet transaction states
 * (https://developers.circle.com/wallets/asynchronous-states-and-statuses):
 *   INITIATED → QUEUED → CLEARED → SENT → (CONFIRMED) → COMPLETE
 * Terminal: COMPLETE (success), FAILED, CANCELLED, DENIED.
 * On Arc, CONFIRMED is skipped (instant finality). txHash appears from SENT.
 * STUCK is non-terminal (can be accelerated or cancelled).
 *
 * There is no "SETTLED" or "REJECTED" state — earlier code waited for those and
 * never matched.
 */
export type TxOutcome = "complete" | "failed" | "in_flight";

const FAILED_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);

export function classifyTxState(state: string | undefined | null): TxOutcome {
  if (state === "COMPLETE") return "complete";
  if (state && FAILED_STATES.has(state)) return "failed";
  return "in_flight";
}

/** Human-readable reason for a failed Circle transaction. */
export function describeTxFailure(status: TransactionStatus): string {
  const detail = [status.errorReason, status.errorDetails].filter(Boolean).join(" — ");
  return detail ? `${status.state}: ${detail}` : status.state;
}
