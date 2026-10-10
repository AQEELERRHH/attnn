/**
 * Creator registration on the AttnnRegistry, confirmed before a market goes live.
 *
 * A profile's registration state is derived from three columns:
 *   isActive = true                                → "active"      (registered on Arc)
 *   onChainTx set, registrationError null          → "registering" (Circle tx in flight,
 *                                                     or a "reserved:<ms>" sentinel while sending)
 *   registrationError set                          → "failed"      (retry allowed)
 *   otherwise                                      → "none"        (never submitted)
 *
 * isActive is written ONLY after the registry itself says the wallet is an active
 * creator, so attnn.xyz never shows a market that bidder agents can't find on Arc.
 */
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { mainWallet } from "./wallets";
import { db } from "./db/client";
import { profiles } from "./db/schema";
import { publicClient, registryAbi } from "./arc";
import { classifyTxState, describeTxFailure, executeContractCall, getTransactionStatus } from "./circle";
import { inngest } from "./inngest";

export type RegistrationState = "active" | "registering" | "failed" | "none";

const RESERVED = "reserved:";
/** A reservation older than this never reached Circle (the request died mid-send). */
const STALE_RESERVATION_MS = 2 * 60 * 1000;

type ProfileRow = typeof profiles.$inferSelect;

export function registrationState(p: Pick<ProfileRow, "isActive" | "onChainTx" | "registrationError">): RegistrationState {
  if (p.isActive) return "active";
  if (p.registrationError) return "failed";
  if (p.onChainTx) return "registering";
  return "none";
}

function registryAddress(): `0x${string}` | null {
  const a = process.env.ATTN_REGISTRY_CONTRACT?.trim();
  return a ? (a as `0x${string}`) : null;
}

/** True when the registry reports this wallet as an active creator. */
export async function isActiveOnRegistry(address: string): Promise<boolean> {
  const registry = registryAddress();
  if (!registry) throw new Error("ATTN_REGISTRY_CONTRACT is not set");
  return publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "isActiveCreator",
    args: [address as `0x${string}`],
  });
}

async function markActive(userId: string) {
  await db.update(profiles).set({ isActive: true, registrationError: null }).where(eq(profiles.userId, userId));
}

async function markFailed(userId: string, reason: string) {
  await db
    .update(profiles)
    .set({ isActive: false, onChainTx: null, registrationError: reason.slice(0, 500) })
    .where(eq(profiles.userId, userId));
}

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Sends registerCreator from the creator's wallet, unless they're already
 * registered or a registration is already on its way. Returns the state after the call.
 */
export async function submitRegistration(userId: string): Promise<RegistrationState> {
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) throw new RegistrationError("Profile not found", 404);
  const wallet = await mainWallet(userId);
  if (!wallet) throw new RegistrationError("Wallet not found", 404);
  if (!registryAddress()) throw new RegistrationError("Registry not deployed", 500);

  if (profile.isActive) return "active";

  // Already registered on Arc (e.g. an earlier attempt finished but the DB missed it).
  if (await isActiveOnRegistry(wallet.address)) {
    await markActive(userId);
    return "active";
  }

  // A registration is already on its way: let it finish instead of sending a second
  // one (the registry would revert "already registered").
  const state = await refreshRegistration(userId);
  if (state === "active" || state === "registering") return state;

  // Reserve atomically so a double click can't send two transactions.
  const reservation = `${RESERVED}${Date.now()}`;
  const [reserved] = await db
    .update(profiles)
    .set({ onChainTx: reservation, registrationError: null })
    .where(
      and(
        eq(profiles.userId, userId),
        eq(profiles.isActive, false),
        or(isNull(profiles.onChainTx), isNotNull(profiles.registrationError)),
      ),
    )
    .returning({ id: profiles.id });
  if (!reserved) return "registering";

  try {
    const tx = await executeContractCall({
      walletId: wallet.circleWalletId,
      contractAddress: registryAddress()!,
      abi: registryAbi,
      functionName: "registerCreator",
      args: [profile.handle, profile.minBid, profile.tags, profile.profileURI ?? ""],
    });
    await db.update(profiles).set({ onChainTx: tx.txId }).where(eq(profiles.userId, userId));
  } catch (err) {
    await markFailed(userId, err instanceof Error ? err.message : String(err));
    throw new RegistrationError(err instanceof Error ? err.message : "Registration failed", 502);
  }

  await inngest.send({ name: "attnn/creator.registering", data: { userId } }).catch((err) => {
    // The 10-minute sweep confirms it anyway.
    console.error("registration: could not queue confirmation", err);
  });
  return "registering";
}

/**
 * Re-checks an in-flight registration against Circle and the registry and records
 * the outcome. Safe to call any number of times.
 */
export async function refreshRegistration(userId: string): Promise<RegistrationState> {
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) return "none";
  const state = registrationState(profile);
  if (state !== "registering") return state;

  const txId = profile.onChainTx!;
  if (txId.startsWith(RESERVED)) {
    const age = Date.now() - Number(txId.slice(RESERVED.length));
    if (age > STALE_RESERVATION_MS) {
      await markFailed(userId, "The registration request didn't reach Circle. Please try again.");
      return "failed";
    }
    return "registering";
  }

  const status = await getTransactionStatus(txId);
  const outcome = classifyTxState(status.state);
  if (outcome === "failed") {
    await markFailed(userId, describeTxFailure(status));
    return "failed";
  }
  if (outcome === "complete") {
    const wallet = await mainWallet(userId);
    if (wallet && (await isActiveOnRegistry(wallet.address))) {
      await markActive(userId);
      return "active";
    }
    // COMPLETE but the registry doesn't list the wallet yet: an RPC node lagging
    // behind. Stay "registering"; the next check will see it.
  }
  return "registering";
}

/** User ids of every profile with a registration in flight (for the sweep). */
export async function loadRegisteringUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(and(eq(profiles.isActive, false), isNotNull(profiles.onChainTx), isNull(profiles.registrationError)))
    .limit(100);
  return rows.map((r) => r.userId);
}
