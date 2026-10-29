/**
 * Creator social verification: the client-safe part (names, labels, messages).
 * The OAuth flow and storage live in lib/social-verify.ts (server only).
 *
 * A creator proves they control at least one social account before their market goes
 * live, so nobody can open a market posing as someone else. Only creators verify:
 * bidders (often agents) don't. Verifying proves control of the account, not who the
 * person is in real life.
 */
export const SOCIAL_PROVIDERS = ["x", "linkedin"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(v: unknown): v is SocialProvider {
  return typeof v === "string" && (SOCIAL_PROVIDERS as readonly string[]).includes(v);
}

export const PROVIDER_LABEL: Record<SocialProvider, string> = { x: "X", linkedin: "LinkedIn" };

/** What one verified account shows publicly. LinkedIn shares a name but no profile link. */
export interface PublicVerification {
  provider: SocialProvider;
  /** X handle without the @; null for LinkedIn. */
  handle: string | null;
  displayName: string | null;
}

export function verificationLabel(v: PublicVerification): string {
  if (v.provider === "x" && v.handle) return `@${v.handle} on X`;
  if (v.provider === "linkedin") return v.displayName ? `${v.displayName} on LinkedIn` : "LinkedIn";
  return PROVIDER_LABEL[v.provider];
}

/** Link to the verified account where one exists (X only: LinkedIn doesn't share profile URLs). */
export function verificationHref(v: PublicVerification): string | null {
  return v.provider === "x" && v.handle ? `https://x.com/${encodeURIComponent(v.handle)}` : null;
}

/** Error codes the verify routes put in ?verify_error=, and what the dashboard says. */
export const VERIFY_ERRORS = {
  unavailable: "That sign-in isn't available right now.",
  rate: "Too many attempts. Try again in a little while.",
  no_market: "Open your market first, then verify an account.",
  cancelled: "Verification was cancelled. Nothing was linked.",
  expired: "That verification link expired. Please try again.",
  taken: "That account is already verified on another Attnn. market.",
  last: "Keep at least one verified account while your market is live.",
  failed: "We couldn't verify that account. Please try again.",
} as const;
export type VerifyErrorCode = keyof typeof VERIFY_ERRORS;

export function verifyErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return (VERIFY_ERRORS as Record<string, string>)[code] ?? VERIFY_ERRORS.failed;
}

export const VERIFY_REQUIRED_MESSAGE =
  "Verify at least one social account (X or LinkedIn) before going live. It shows bidders this market really is yours.";
