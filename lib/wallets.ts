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

export type WalletPurpose = "main" | "agent";
export type WalletRow = typeof wallets.$inferSelect;

/**
 * USDC kept back in the agent wallet when moving money out of it, so the
 * transfer itself can pay its network fee (Arc gas is paid in USDC). $0.05.
 */
export const AGENT_WALLET_GAS_RESERVE = BigInt(50_000);

export async function walletOf(userId: string, purpose: WalletPurpose): Promise<WalletRow | undefined> {
  return db.query.wallets.findFirst({ where: and(eq(wallets.userId, userId), eq(wallets.purpose, purpose)) });
}

export const mainWallet = (userId: string) => walletOf(userId, "main");
export const agentWallet = (userId: string) => walletOf(userId, "agent");

/** The user's wallet with this address (main or agent), if they own it. */
export async function walletByAddress(userId: string, address: string): Promise<WalletRow | undefined> {
  const rows = await db.query.wallets.findMany({ where: eq(wallets.userId, userId) });
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
  const provisioned = await provisionUserWallet(userId, "Attnn agent wallet");
  await db
    .insert(wallets)
    .values({
      userId,
      circleWalletId: provisioned.walletId,
      address: provisioned.address,
      blockchain: provisioned.blockchain,
      state: "active",
      purpose: "agent",
    })
    .onConflictDoNothing();
  const row = await agentWallet(userId);
  if (!row) throw new Error("Could not save the agent wallet");
  return row;
}
