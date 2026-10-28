/**
 * Creator social verification (server only): an OAuth sign-in with X or LinkedIn that
 * proves the creator controls that account. Labels and messages: lib/social-verify-rules.ts.
 *
 * Flow: /api/verify/<provider>/start puts a signed, short-lived state in an httpOnly
 * cookie and sends the creator to the provider; /callback checks the state against the
 * cookie and the session, swaps the code for a token, reads the account id and handle,
 * and stores them. The token is used once and never stored: Attnn. can't post, read
 * messages or see anything beyond the public id, name and handle.
 *
 * One provider account can verify only one Attnn. user (unique index), so a market can't
 * borrow someone else's X account.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { profiles, socialVerifications } from "@/lib/db/schema";
import { SOCIAL_PROVIDERS, type PublicVerification, type SocialProvider, type VerifyErrorCode } from "@/lib/social-verify-rules";

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
  /** X requires PKCE; LinkedIn's web flow uses the client secret instead. */
  pkce: boolean;
  /** How the client secret is sent to the token endpoint. */
  tokenAuth: "basic" | "body";
  idEnv: string;
  secretEnv: string;
}

const PROVIDERS: Record<SocialProvider, ProviderConfig> = {
  x: {
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    profileUrl: "https://api.x.com/2/users/me",
    // users.read needs tweet.read alongside it; neither lets Attnn. post or read DMs.
    scope: "users.read tweet.read",
    pkce: true,
    tokenAuth: "basic",
    idEnv: "X_CLIENT_ID",
    secretEnv: "X_CLIENT_SECRET",
  },
  linkedin: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    profileUrl: "https://api.linkedin.com/v2/userinfo",
    scope: "openid profile",
    pkce: false,
    tokenAuth: "body",
    idEnv: "LINKEDIN_CLIENT_ID",
    secretEnv: "LINKEDIN_CLIENT_SECRET",
  },
};

export class VerificationError extends Error {
  constructor(public code: VerifyErrorCode, message?: string) {
    super(message ?? code);
  }
}

function credentials(p: SocialProvider): { id: string; secret: string } | null {
  const id = process.env[PROVIDERS[p].idEnv]?.trim();
  const secret = process.env[PROVIDERS[p].secretEnv]?.trim();
  return id && secret ? { id, secret } : null;
}

export function providerEnabled(p: SocialProvider): boolean {
  return credentials(p) !== null;
}

/** Providers with keys configured, in display order. */
export function enabledProviders(): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter(providerEnabled);
}

/**
 * Verification is required to go live only when at least one provider is configured;
 * with none set up nobody could verify, and every new market would be stuck.
 */
export function verificationRequired(): boolean {
  return enabledProviders().length > 0;
}

// ─── Signed state cookie ─────────────────────────────────────────────────────

export const VERIFY_COOKIE = "attnn_verify";
export const VERIFY_STATE_TTL_MS = 10 * 60 * 1000;

export interface VerifyState {
  provider: SocialProvider;
  userId: string;
  /** Random value echoed back by the provider (CSRF protection). */
  state: string;
  /** PKCE code verifier (X). */
  verifier: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function stateSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

export function newVerifyState(provider: SocialProvider, userId: string, now = Date.now()): VerifyState {
  return { provider, userId, state: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), exp: now + VERIFY_STATE_TTL_MS };
}

/** `payload.signature`, both base64url; HMAC-SHA256 keyed by AUTH_SECRET. */
export function sealState(s: VerifyState, secret = stateSecret()): string {
  const payload = b64url(Buffer.from(JSON.stringify(s)));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** The state if the signature is valid and it hasn't expired, else null. */
export function openState(token: string | undefined | null, secret = stateSecret(), now = Date.now()): VerifyState | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as VerifyState;
    if (!s || typeof s.exp !== "number" || s.exp < now) return null;
    if (!(SOCIAL_PROVIDERS as readonly string[]).includes(s.provider)) return null;
    return s;
  } catch {
    return null;
  }
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

/** Where the provider sends the creator back. Must match the redirect URL registered with the provider. */
export function redirectUriFor(p: SocialProvider, origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/verify/${p}/callback`;
}

export function authorizeUrl(p: SocialProvider, s: VerifyState, redirectUri: string): string {
  const cfg = PROVIDERS[p];
  const creds = credentials(p);
  if (!creds) throw new VerificationError("unavailable");
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", creds.id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", s.state);
  if (cfg.pkce) {
    u.searchParams.set("code_challenge", pkceChallenge(s.verifier));
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

// ─── Identity ────────────────────────────────────────────────────────────────

export interface Identity {
  accountId: string;
  handle: string | null;
  displayName: string | null;
}

const clip = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Reads the provider's profile response. Null if it doesn't carry a stable account id. */
export function parseIdentity(p: SocialProvider, json: unknown): Identity | null {
  const j = json as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  if (p === "x") {
    const d = j.data as Record<string, unknown> | undefined;
    const id = clip(d?.id, 64);
    const handle = clip(d?.username, 32);
    if (!id || !handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
    return { accountId: id, handle, displayName: clip(d?.name, 80) };
  }
  const id = clip(j.sub, 128);
  if (!id) return null;
  const name = clip(j.name, 80) ?? ([clip(j.given_name, 40), clip(j.family_name, 40)].filter(Boolean).join(" ") || null);
  return { accountId: id, handle: null, displayName: name };
}

/** Swaps the code for a token, reads the account and drops the token. */
export async function exchangeAndIdentify(p: SocialProvider, code: string, verifier: string, redirectUri: string): Promise<Identity> {
  const cfg = PROVIDERS[p];
  const creds = credentials(p);
  if (!creds) throw new VerificationError("unavailable");

  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (cfg.pkce) body.set("code_verifier", verifier);
  if (cfg.tokenAuth === "basic") {
    headers.Authorization = "Basic " + Buffer.from(`${encodeURIComponent(creds.id)}:${encodeURIComponent(creds.secret)}`).toString("base64");
  } else {
    body.set("client_id", creds.id);
    body.set("client_secret", creds.secret);
  }

  const tokenRes = await fetch(cfg.tokenUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!tokenRes.ok || typeof token?.access_token !== "string") {
    console.warn(`social-verify: ${p} token exchange failed (${tokenRes.status})`);
    throw new VerificationError("failed");
  }

  const profileRes = await fetch(cfg.profileUrl, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const identity = parseIdentity(p, await profileRes.json().catch(() => null));
  if (!profileRes.ok || !identity) {
    console.warn(`social-verify: ${p} profile read failed (${profileRes.status})`);
    throw new VerificationError("failed");
  }
  return identity;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const isUniqueViolation = (err: unknown, constraint: string) => {
  const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const c = e?.code === "23505" ? e : e?.cause?.code === "23505" ? e.cause : null;
  return !!c && (c.constraint_name ?? "") === constraint;
};

/**
 * Links (or re-links) this creator's account on the provider. Refuses with "taken" if
 * that provider account already verifies another Attnn. user.
 */
export async function saveVerification(userId: string, p: SocialProvider, id: Identity): Promise<void> {
  try {
    await db
      .insert(socialVerifications)
      .values({ userId, provider: p, providerAccountId: id.accountId, handle: id.handle, displayName: id.displayName })
      .onConflictDoUpdate({
        target: [socialVerifications.userId, socialVerifications.provider],
        set: { providerAccountId: id.accountId, handle: id.handle, displayName: id.displayName, verifiedAt: new Date() },
      });
  } catch (err) {
    if (isUniqueViolation(err, "social_verifications_provider_account_uq")) throw new VerificationError("taken");
    throw err;
  }
}

export async function listVerifications(userId: string): Promise<PublicVerification[]> {
  const rows = await db
    .select({ provider: socialVerifications.provider, handle: socialVerifications.handle, displayName: socialVerifications.displayName })
    .from(socialVerifications)
    .where(eq(socialVerifications.userId, userId));
  return sortVerifications(rows);
}

export async function verificationsByUser(userIds: string[]): Promise<Map<string, PublicVerification[]>> {
  const out = new Map<string, PublicVerification[]>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: socialVerifications.userId,
      provider: socialVerifications.provider,
      handle: socialVerifications.handle,
      displayName: socialVerifications.displayName,
    })
    .from(socialVerifications)
    .where(inArray(socialVerifications.userId, userIds));
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), { provider: r.provider, handle: r.handle, displayName: r.displayName }]);
  for (const [k, v] of out) out.set(k, sortVerifications(v));
  return out;
}

function sortVerifications(rows: PublicVerification[]): PublicVerification[] {
  const order = (p: SocialProvider) => SOCIAL_PROVIDERS.indexOf(p);
  return [...rows].sort((a, b) => order(a.provider) - order(b.provider));
}

export async function hasVerification(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(socialVerifications)
    .where(eq(socialVerifications.userId, userId));
  return (row?.n ?? 0) > 0;
}

/**
 * Unlinks one account. A market that is live (or going live) must keep at least one,
 * so the last one can't be removed then. Runs under a lock on the profile row so two
 * unlinks at once can't both remove "the other one".
 */
export async function removeVerification(userId: string, p: SocialProvider): Promise<void> {
  await db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ isActive: profiles.isActive, onChainTx: profiles.onChainTx })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .for("update");
    const rows = await tx
      .select({ provider: socialVerifications.provider })
      .from(socialVerifications)
      .where(eq(socialVerifications.userId, userId));
    if (!rows.some((r) => r.provider === p)) return;
    const live = !!profile && (profile.isActive || !!profile.onChainTx);
    if (live && rows.length <= 1) throw new VerificationError("last");
    await tx.delete(socialVerifications).where(and(eq(socialVerifications.userId, userId), eq(socialVerifications.provider, p)));
  });
}
