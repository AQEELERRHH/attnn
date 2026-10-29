/**
 * Creator social verification: the signed state, PKCE, the sign-in URLs, reading the
 * provider's answer, and the checklist step. Pure, no database or network.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:9/none"; // imported, never queried
process.env.AUTH_SECRET = "unit-test-secret";
process.env.X_CLIENT_ID = "x-client";
process.env.X_CLIENT_SECRET = "x-secret";
process.env.LINKEDIN_CLIENT_ID = "li-client";
process.env.LINKEDIN_CLIENT_SECRET = "li-secret";

const sv = await import("../../lib/social-verify.ts");
const rules = await import("../../lib/social-verify-rules.ts");
const { computeChecklist } = await import("../../lib/onboarding.ts");

describe("verification state cookie", () => {
  const user = "00000000-0000-0000-0000-00000000000c";

  test("a sealed state opens with the same secret and keeps every field", () => {
    const s = sv.newVerifyState("x", user, 1_000);
    const opened = sv.openState(sv.sealState(s, "k1"), "k1", 1_000);
    assert.deepEqual(opened, s);
  });

  test("tampered, wrongly signed, malformed or expired states are refused", () => {
    const s = sv.newVerifyState("x", user, 1_000);
    const token = sv.sealState(s, "k1");
    const [payload, sig] = token.split(".");
    // Someone swaps in another user id but keeps the old signature.
    const forged = Buffer.from(JSON.stringify({ ...s, userId: "00000000-0000-0000-0000-00000000000d" })).toString("base64url");
    assert.equal(sv.openState(`${forged}.${sig}`, "k1", 1_000), null);
    assert.equal(sv.openState(token, "other-secret", 1_000), null);
    assert.equal(sv.openState(`${payload}`, "k1", 1_000), null);
    assert.equal(sv.openState("", "k1", 1_000), null);
    assert.equal(sv.openState(null, "k1", 1_000), null);
    assert.equal(sv.openState(token, "k1", s.exp + 1), null, "expired after 10 minutes");
  });

  test("each state is random", () => {
    const a = sv.newVerifyState("x", user);
    const b = sv.newVerifyState("x", user);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.verifier, b.verifier);
  });
});

describe("sign-in URLs", () => {
  test("PKCE challenge matches RFC 7636's example", () => {
    assert.equal(sv.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("X: read-only scopes, state and an S256 PKCE challenge", () => {
    const s = sv.newVerifyState("x", "u");
    const u = new URL(sv.authorizeUrl("x", s, "https://attnn.xyz/api/verify/x/callback"));
    assert.equal(u.origin + u.pathname, "https://x.com/i/oauth2/authorize");
    assert.equal(u.searchParams.get("client_id"), "x-client");
    assert.equal(u.searchParams.get("scope"), "users.read tweet.read");
    assert.equal(u.searchParams.get("state"), s.state);
    assert.equal(u.searchParams.get("code_challenge"), sv.pkceChallenge(s.verifier));
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("redirect_uri"), "https://attnn.xyz/api/verify/x/callback");
    assert.ok(!u.toString().includes("x-secret"), "the secret never goes in the URL");
  });

  test("LinkedIn: OpenID profile scope, no PKCE, no secret in the URL", () => {
    const s = sv.newVerifyState("linkedin", "u");
    const u = new URL(sv.authorizeUrl("linkedin", s, "https://attnn.xyz/api/verify/linkedin/callback"));
    assert.equal(u.origin + u.pathname, "https://www.linkedin.com/oauth/v2/authorization");
    assert.equal(u.searchParams.get("scope"), "openid profile");
    assert.equal(u.searchParams.get("code_challenge"), null);
    assert.ok(!u.toString().includes("li-secret"));
  });

  test("redirect URL is the site's callback for that provider", () => {
    assert.equal(sv.redirectUriFor("x", "https://attnn.xyz/"), "https://attnn.xyz/api/verify/x/callback");
  });

  test("a provider without keys is off, and verification is required only when one is on", () => {
    assert.deepEqual(sv.enabledProviders(), ["x", "linkedin"]);
    const saved = process.env.LINKEDIN_CLIENT_SECRET;
    delete process.env.LINKEDIN_CLIENT_SECRET;
    assert.deepEqual(sv.enabledProviders(), ["x"]);
    const savedX = process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_ID;
    assert.equal(sv.verificationRequired(), false);
    assert.throws(() => sv.authorizeUrl("x", sv.newVerifyState("x", "u"), "https://a/cb"));
    process.env.LINKEDIN_CLIENT_SECRET = saved;
    process.env.X_CLIENT_ID = savedX;
    assert.equal(sv.verificationRequired(), true);
  });
});

describe("reading the provider's answer", () => {
  test("X: id and handle are required; the handle must be a real X handle", () => {
    assert.deepEqual(sv.parseIdentity("x", { data: { id: "123", username: "asmau_z", name: "Asmau" } }), {
      accountId: "123",
      handle: "asmau_z",
      displayName: "Asmau",
    });
    assert.equal(sv.parseIdentity("x", { data: { id: "123" } }), null);
    assert.equal(sv.parseIdentity("x", { data: { username: "a" } }), null);
    assert.equal(sv.parseIdentity("x", { data: { id: "1", username: "<script>" } }), null);
    assert.equal(sv.parseIdentity("x", { errors: [{}] }), null);
    assert.equal(sv.parseIdentity("x", null), null);
  });

  test("LinkedIn: the OpenID subject is the id; name falls back to given + family", () => {
    assert.deepEqual(sv.parseIdentity("linkedin", { sub: "abc", name: "Asmau Zubairu" }), {
      accountId: "abc",
      handle: null,
      displayName: "Asmau Zubairu",
    });
    assert.equal(sv.parseIdentity("linkedin", { sub: "abc", given_name: "Asmau", family_name: "Z" })?.displayName, "Asmau Z");
    assert.equal(sv.parseIdentity("linkedin", { name: "No id" }), null);
  });

  test("labels and links shown to the public", () => {
    assert.equal(rules.verificationLabel({ provider: "x", handle: "asmau", displayName: "A" }), "@asmau on X");
    assert.equal(rules.verificationHref({ provider: "x", handle: "asmau", displayName: null }), "https://x.com/asmau");
    assert.equal(rules.verificationLabel({ provider: "linkedin", handle: null, displayName: "Asmau Z" }), "Asmau Z on LinkedIn");
    assert.equal(rules.verificationHref({ provider: "linkedin", handle: null, displayName: "Asmau Z" }), null);
    assert.equal(rules.verifyErrorMessage("taken"), rules.VERIFY_ERRORS.taken);
    assert.equal(rules.verifyErrorMessage("nonsense"), rules.VERIFY_ERRORS.failed);
    assert.equal(rules.isSocialProvider("instagram"), false);
  });
});

describe("signing secret", () => {
  test("NEXTAUTH_SECRET works when AUTH_SECRET isn't set (production uses it)", () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "legacy-name";
    assert.equal(sv.stateSecret(), "legacy-name");
    delete process.env.NEXTAUTH_SECRET;
    assert.throws(() => sv.stateSecret());
    process.env.AUTH_SECRET = saved;
  });
});

describe("server log details", () => {
  test("only the provider's named error fields are logged, never tokens", () => {
    assert.equal(
      sv.providerError({ error: "invalid_client", error_description: "Client authentication failed", access_token: "SECRET" }),
      ": error=invalid_client error_description=Client authentication failed",
    );
    assert.equal(sv.providerError({ access_token: "SECRET" }), "");
    assert.equal(sv.providerError(null), "");
  });
});

describe("checklist", () => {
  const base = {
    role: "creator",
    hasWallet: true,
    walletUsdc: "0",
    agentWalletUsdc: null,
    minBid: 1_000_000n,
    minBidLabel: "$1.00",
    placedStatuses: [],
    received: [],
    hasAgent: false,
    isTestnet: false,
  };
  const ids = (c: ReturnType<typeof computeChecklist>) => c.steps.map((s) => s.id);

  test("creators get a verify step before going live, when verification is set up", () => {
    const c = computeChecklist({ ...base, profile: { registration: "none", avatarUrl: null, verified: false } });
    assert.deepEqual(ids(c), ["wallet", "market", "verify", "registered", "photo", "first-reply"]);
    assert.equal(c.steps.find((s) => s.id === "verify")?.done, false);
    const done = computeChecklist({ ...base, profile: { registration: "none", avatarUrl: null, verified: true } });
    assert.equal(done.steps.find((s) => s.id === "verify")?.done, true);
  });

  test("no verify step when verification isn't set up, or for bidders", () => {
    assert.ok(!ids(computeChecklist({ ...base, profile: { registration: "none", avatarUrl: null, verified: null } })).includes("verify"));
    assert.ok(!ids(computeChecklist({ ...base, role: "bidder", profile: { registration: "none", avatarUrl: null, verified: false } })).includes("verify"));
  });
});
