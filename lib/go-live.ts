/**
 * Putting a creator's market live: the one path shared by the "Go live" button
 * (`POST /api/profile/activate`) and the automatic go-live right after a creator
 * verifies X or LinkedIn (`/api/verify/<provider>/callback`).
 *
 * Order of checks: profile → already live → verified (when verification is on) → wallet
 * → registration already on its way → network fee. Who pays the fee:
 *   - a smart contract wallet while Circle Gas Station is on: Circle (no balance needed);
 *   - otherwise the creator's own USDC; a creator who is short gets the one-time
 *     sponsored top-up when it's set up (lib/sponsorship.ts), or else the old rule
 *     stands ($1 in the wallet first).
 */
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { profiles } from "./db/schema";
import { ACTIVATION_FUNDS_MESSAGE, ACTIVATION_MIN_USDC, getUsdcBalance } from "./activation";
import { refreshRegistration, registrationState, submitRegistration, type RegistrationState } from "./registration";
import { hasVerification, verificationRequired } from "./social-verify";
import { VERIFY_REQUIRED_MESSAGE } from "./social-verify-rules";
import { feesSponsored, mainWallet } from "./wallets";
import { inngest } from "./inngest";
import { REGISTRATION_GAS_MIN, SPONSOR_FAILED_MESSAGE, sponsorActivation, sponsorConfig, type SponsorConfig } from "./sponsorship";

/** Shown when sponsorship is on but this creator can't have it (already had it, or today's budget is spent). */
export const SMALL_FUNDS_MESSAGE =
  "Add a little USDC to your wallet (a few cents is enough) to go live. It covers the small network fee for registering on Arc.";

export type GoLiveResult =
  | { ok: true; status: RegistrationState; sponsored?: boolean }
  | { ok: false; code: "NOT_FOUND" | "VERIFY_REQUIRED" | "INSUFFICIENT_FUNDS" | "SPONSOR_FAILED"; error: string; httpStatus: number; balance?: string };

/** The sponsor settings when sponsorship applies at all: set up, and creators must verify first. */
export function activeSponsorConfig(): SponsorConfig | null {
  return verificationRequired() ? sponsorConfig() : null;
}

/**
 * Starts (or reports) the creator's registration. Never marks a market live itself:
 * that happens only once the registry confirms it (lib/registration.ts).
 * Throws RegistrationError for registration failures, like submitRegistration.
 */
export async function goLive(userId: string): Promise<GoLiveResult> {
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!profile) return { ok: false, code: "NOT_FOUND", error: "Profile not found", httpStatus: 404 };
  if (profile.isActive) return { ok: true, status: "active" };

  // A market goes live only once the creator has proved they control a social
  // account (lib/social-verify.ts), so nobody can open a market as someone else.
  if (verificationRequired() && !(await hasVerification(userId))) {
    return { ok: false, code: "VERIFY_REQUIRED", error: VERIFY_REQUIRED_MESSAGE, httpStatus: 400 };
  }

  const wallet = await mainWallet(userId);
  if (!wallet) return { ok: false, code: "NOT_FOUND", error: "Wallet not found", httpStatus: 404 };

  // Already on its way (a top-up or the registration itself): report, don't resend.
  if (registrationState(profile) === "registering") return { ok: true, status: await refreshRegistration(userId) };

  // Circle Gas Station pays this wallet's fees: no balance check, no top-up.
  if (feesSponsored(wallet)) return { ok: true, status: await submitRegistration(userId), sponsored: true };

  const sponsor = activeSponsorConfig();
  const minimum = sponsor ? REGISTRATION_GAS_MIN : ACTIVATION_MIN_USDC;

  // Registration is paid for in USDC gas from the creator's own wallet.
  let balance: bigint | null = null;
  try {
    balance = await getUsdcBalance(wallet.address);
  } catch (err) {
    // RPC hiccup: don't block going live (and don't sponsor blind); an unfunded wallet
    // fails at Circle and the creator can retry.
    console.warn("go-live: balance check skipped:", err);
  }

  if (balance !== null && balance < minimum) {
    if (sponsor) {
      const outcome = await sponsorActivation(userId, wallet.address, sponsor);
      if (outcome === "sent" || outcome === "busy") {
        await inngest.send({ name: "attnn/creator.registering", data: { userId } }).catch((err) => {
          console.error("go-live: could not queue confirmation (the 10-minute sweep picks it up)", err);
        });
        return { ok: true, status: "registering", sponsored: outcome === "sent" };
      }
      if (outcome === "failed") return { ok: false, code: "SPONSOR_FAILED", error: SPONSOR_FAILED_MESSAGE, httpStatus: 502 };
      // "used" / "limit": the creator funds it themselves, a few cents is enough.
    }
    return {
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      error: sponsor ? SMALL_FUNDS_MESSAGE : ACTIVATION_FUNDS_MESSAGE,
      httpStatus: 400,
      balance: balance.toString(),
    };
  }

  return { ok: true, status: await submitRegistration(userId) };
}
