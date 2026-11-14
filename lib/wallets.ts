/**
 * Which wallet a piece of code means. Each user has a "main" wallet and, once
 * they use the bidder agent, a separate "agent" wallet that the agent spends from
 * (it can only spend what the user moved into it).
 *
 * Rules:
 *   - user-facing actions, creator registration and payouts → mainWallet()
 *   - the bidder agent and its counter re-bids               → agentWallet()
 *   - settling an existing bid                               → walletByAddress(), i.e.
 *     the exact wallet that placed it (refunds of agent bids go back to the agent wallet)
 * Never look a wallet up by userId alone.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db/client";
import { wallets } from "./db/schema";
import { provisionUserWallet } from "./circle";
import { arc } from "./chain";

/**
 * Only wallets on the network this deployment runs on. A testnet wallet's key lives
 * in Circle's TEST environment: shown on mainnet, real USDC sent to it would be stuck.
 * Mainnet starts with a fresh database; this makes a mix-up fail safe anyway.
 */
const onThisNetwork = () => eq(wallets.blockchain, arc.circleBlockchain);

export type WalletPurpose = "main" | "agent";
export type WalletRow = typeof wallets.$inferSelect;

/**
 * USDC kept back in the agent wallet when moving money out of it, so the
 * transfer itself can pay its network fee (Arc gas is paid in USDC). $0.05.
 */
export const AGENT_WALLET_GAS_RESERVE = BigInt(50_000);

/**
 * Circle Gas Station (sponsored network fees) is on: CIRCLE_GAS_STATION=1, set only
 * once Gas Station is enabled for this network in the Circle Console with its rules.
 * While on, new users' MAIN wallets are created as smart contract wallets (SCA),
 * whose fees Circle pays; agent wallets stay ordinary wallets (EOA), because they sign
 * the x402 profile-read payments and Circle Gateway expects an EOA signature.
 * Existing wallets never change type.
 */
export function gasStationEnabled(): boolean {
  return process.env.CIRCLE_GAS_STATION === "1";
}

/** The account type a new main wallet is created as. */
export function newMainWalletType(): "EOA" | "SCA" {
  return gasStationEnabled() ? "SCA" : "EOA";
}

/**
 * Circle pays this wallet's network fees: it's a smart contract wallet and Gas
 * Station is on. With Gas Station switched off again, an SCA wallet pays its own
 * fees from its USDC like any other, so the usual balance rules apply to it.
 */
export function feesSponsored(wallet: Pick<WalletRow, "accountType">): boolean {
  return wallet.accountType === "SCA" && gasStationEnabled();
}

export async function walletOf(userId: string, purpose: WalletPurpose): Promise<WalletRow | undefined> {
  return db.query.wallets.findFirst({ where: and(eq(wallets.userId, userId), eq(wallets.purpose, purpose), onThisNetwork()) });
}

export const mainWallet = (userId: string) => walletOf(userId, "main");
export const agentWallet = (userId: string) => walletOf(userId, "agent");

/** The user's wallet with this address (main or agent), if they own it. */
export async function walletByAddress(userId: string, address: string): Promise<WalletRow | undefined> {
  const rows = await db.query.wallets.findMany({ where: and(eq(wallets.userId, userId), onThisNetwork()) });
  return rows.find((w) => w.address.toLowerCase() === address.toLowerCase());
}

/**
 * Returns the user's agent wallet, creating it with Circle if needed. Safe to call
 * twice at once: the unique (user, purpose) index keeps one, and the loser's
 * Circle wallet is simply never used.
 */
export async function ensureAgentWallet(userId: string): Promise<WalletRow> {
  const existing = await agentWallet(userId);
  if (existing) return existing;
  // Always an ordinary wallet: it signs x402 payments (see gasStationEnabled).
  const provisioned = await provisionUserWallet(userId, "Attnn agent wallet", "EOA");
  await db
    .insert(wallets)
    .values({
      userId,
      circleWalletId: provisioned.walletId,
      address: provisioned.address,
      blockchain: provisioned.blockchain,
      state: "active",
      purpose: "agent",
      accountType: provisioned.accountType,
    })
    .onConflictDoNothing();
  const row = await agentWallet(userId);
  if (!row) throw new Error("Could not save the agent wallet");
  return row;
}
