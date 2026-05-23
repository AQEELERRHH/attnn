import {
  CircleDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { type Abi, type Hex } from "viem";
import { usdcAbi, USDC_ADDRESS } from "./arc";

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
    blockchains: ["ARC-TESTNET"],
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

export async function executeContractCall(params: {
  walletId: string;
  contractAddress: string;
  abi: Abi;
  functionName: string;
  args: unknown[];
}): Promise<ExecuteContractResult> {
  const client = getSDK();
  const idempotencyKey = crypto.randomUUID();

  const { data } = await client.createContractExecutionTransaction({
    idempotencyKey,
    walletId: params.walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: `${params.functionName}(${params.abi
      .filter((f: any) => f.type === "function" && f.name === params.functionName)
      .flatMap((f: any) => f.inputs?.map((i: any) => i.type) ?? [])
      .join(",")})`,
    abiParameters: params.args as Record<string, unknown>[],
    fee: { type: "level" as const, config: { feeLevel: "MEDIUM" as const } },
  });

  return {
    txId: data?.id ?? "",
    state: data?.state ?? "pending",
  };
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
}

export async function getTransactionStatus(txId: string): Promise<TransactionStatus> {
  const client = getSDK();

  const { data } = await client.getTransaction({ id: txId });
  const tx = data?.transaction;
  if (!tx) throw new Error("Transaction not found");

  return { state: tx.state!, txHash: tx.txHash as Hex | undefined };
}

export async function pollTransactionUntilSettled(
  txId: string,
  maxAttempts = 30,
  delayMs = 2000,
): Promise<TransactionStatus> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getTransactionStatus(txId);
    if (status.state === "SETTLED" || status.state === "FAILED" || status.state === "REJECTED") {
      return status;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Transaction ${txId} did not settle after ${maxAttempts} attempts`);
}
