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

export interface WalletBalance {
  amount: string;
  usdc: string;
}

export async function getWalletBalance(walletId: string): Promise<WalletBalance> {
  const client = getSDK();

  const { data } = await client.getWalletTokenBalance({ id: walletId });
  const wallet = data?.tokenBalances;
  if (!wallet) throw new Error("Wallet not found");

  const usdcBalance = Array.isArray(wallet)
    ? wallet.find(
        (b: { currency?: string; token?: { symbol?: string } }) =>
          b.currency === "USD" || b.token?.symbol === "USDC",
      )
    : undefined;

  return { amount: usdcBalance?.amount ?? "0", usdc: usdcBalance?.amount ?? "0" };
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

/** Finds a recent transaction from this wallet by the refId we gave it. */
export async function findTransactionByRefId(
  walletId: string,
  refId: string,
): Promise<ExecuteContractResult | null> {
  const client = getSDK();
  const { data } = await client.listTransactions({ walletIds: [walletId], pageSize: 50 });
  const tx = data?.transactions?.find((t) => t.refId === refId);
  return tx ? { txId: tx.id, state: tx.state } : null;
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

export async function transferUSDC(
  walletId: string,
  to: string,
  amount: string,
): Promise<ExecuteContractResult> {
  return executeContractCall({
    walletId,
    contractAddress: USDC_ADDRESS,
    abi: usdcAbi as unknown as Abi,
    functionName: "transfer",
    args: [to, amount],
  });
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
