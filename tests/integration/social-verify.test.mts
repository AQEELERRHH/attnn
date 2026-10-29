/**
 * Creator social verification end to end against a real Postgres, with X and LinkedIn
 * faked at the network edge: the state cookie ties the callback to the creator who
 * started it, one X account can verify only one market, a market can't go live
 * without a verified account, and a live market keeps its last one.
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installFakes, world } from "../helpers/fakes.mts";
import { closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";

await installFakes();

process.env.X_CLIENT_ID = "x-client";
process.env.X_CLIENT_SECRET = "x-secret";
process.env.LINKEDIN_CLIENT_ID = "li-client";
process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
process.env.AUTH_URL = "http://localhost:3000";

const session = { userId: ids.creator as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: {
    auth: async () => (session.userId ? { user: { id: session.userId, role: "creator", email: "t@test" } } : null),
  },
});

// X and LinkedIn at the network edge. `xAccount` is whose X account the person signs in with.
const calls: { url: string; init?: RequestInit }[] = [];
let xAccount = { id: "x-111", username: "amina_creates", name: "Amina" };
let tokenStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url === "https://api.x.com/2/oauth2/token" || url === "https://www.linkedin.com/oauth/v2/accessToken") {
    calls.push({ url, init });
    return tokenStatus === 200 ? json(200, { access_token: "tok-" + Math.random(), token_type: "bearer" }) : json(tokenStatus, { error: "invalid_grant" });
  }
  if (url === "https://api.x.com/2/users/me") {
    calls.push({ url, init });
    return json(200, { data: xAccount });
  }
  if (url === "https://api.linkedin.com/v2/userinfo") {
    calls.push({ url, init });
    return json(200, { sub: "li-abc", name: "Amina Bello" });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { NextRequest } = await import("next/server");
const { db } = await import("../../lib/db/client.ts");
const { profiles, socialVerifications } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const start = await import("../../app/api/verify/[provider]/start/route.ts");
const callback = await import("../../app/api/verify/[provider]/callback/route.ts");
const unlink = await import("../../app/api/verify/[provider]/route.ts");
const activate = await import("../../app/api/profile/activate/route.ts");

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });
const get = (url: string, cookie?: string) =>
  new NextRequest(url, { headers: { host: "localhost:3000", ...(cookie ? { cookie } : {}) } });

/** Runs /start and returns the provider URL and the state cookie it set. */
async function begin(provider: "x" | "linkedin") {
  const res = await start.GET(get(`http://localhost:3000/api/verify/${provider}/start`), params(provider));
  assert.equal(res.status, 303);
  const location = new URL(res.headers.get("location")!);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const value = /attnn_verify=([^;]+)/.exec(setCookie)?.[1];
  return { location, cookie: value ? `attnn_verify=${value}` : "", setCookie };
}

async function finish(provider: "x" | "linkedin", state: string, cookie: string, code = "the-code") {
  const res = await callback.GET(get(`http://localhost:3000/api/verify/${provider}/callback?code=${code}&state=${state}`, cookie), params(provider));
  assert.equal(res.status, 303);
  return new URL(res.headers.get("location")!);
}

const rowsFor = (userId: string) => db.select().from(socialVerifications).where(eq(socialVerifications.userId, userId));

describe("creator social verification", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    calls.length = 0;
    tokenStatus = 200;
    xAccount = { id: "x-111", username: "amina_creates", name: "Amina" };
    await truncateAll();
    await seedMarket();
    session.userId = ids.creator;
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await closeDb();
  });

  test("X: start sets a signed httpOnly cookie, the callback stores the handle and never the token", async () => {
    const { location, cookie, setCookie } = await begin("x");
    assert.equal(location.origin + location.pathname, "https://x.com/i/oauth2/authorize");
    assert.equal(location.searchParams.get("redirect_uri"), "http://localhost:3000/api/verify/x/callback");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Path=\/api\/verify/);

    const back = await finish("x", location.searchParams.get("state")!, cookie);
    assert.equal(back.pathname, "/dashboard");
    assert.equal(back.searchParams.get("verified"), "x");

    // The token request carried the PKCE verifier and the client secret in Basic auth.
    const tokenCall = calls.find((c) => c.url.endsWith("/oauth2/token"))!;
    assert.ok(String(tokenCall.init?.body).includes("code_verifier="));
    assert.match(String((tokenCall.init?.headers as Record<string, string>).Authorization), /^Basic /);

    const rows = await rowsFor(ids.creator);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider, "x");
    assert.equal(rows[0]!.handle, "amina_creates");
    assert.equal(rows[0]!.providerAccountId, "x-111");
    assert.ok(!JSON.stringify(rows[0]).includes("tok-"), "no token is stored");
  });

  test("LinkedIn: stores the OpenID subject and name (no handle)", async () => {
    const { location, cookie } = await begin("linkedin");
    assert.equal(location.searchParams.get("code_challenge"), null);
    const back = await finish("linkedin", location.searchParams.get("state")!, cookie);
    assert.equal(back.searchParams.get("verified"), "linkedin");
    const [row] = await rowsFor(ids.creator);
    assert.equal(row!.providerAccountId, "li-abc");
    assert.equal(row!.handle, null);
    assert.equal(row!.displayName, "Amina Bello");
  });

  test("a wrong state, a missing cookie or another user's cookie is refused before any provider call", async () => {
    const { location, cookie } = await begin("x");
    const state = location.searchParams.get("state")!;

    assert.equal((await finish("x", "not-the-state", cookie)).searchParams.get("verify_error"), "expired");
    assert.equal((await finish("x", state, "")).searchParams.get("verify_error"), "expired");
    // The cookie was made for the creator; someone else's session can't use it.
    session.userId = ids.bidder;
    assert.equal((await finish("x", state, cookie)).searchParams.get("verify_error"), "expired");
    // A cookie for X can't finish a LinkedIn callback.
    session.userId = ids.creator;
    assert.equal((await finish("linkedin", state, cookie)).searchParams.get("verify_error"), "expired");

    assert.equal(calls.length, 0, "no code was exchanged");
    assert.equal((await rowsFor(ids.creator)).length, 0);
  });

  test("cancelling on the provider's page links nothing", async () => {
    const { cookie } = await begin("x");
    const res = await callback.GET(get("http://localhost:3000/api/verify/x/callback?error=access_denied&state=s", cookie), params("x"));
    assert.equal(new URL(res.headers.get("location")!).searchParams.get("verify_error"), "cancelled");
    assert.equal((await rowsFor(ids.creator)).length, 0);
  });

  test("a failed token exchange links nothing", async () => {
    tokenStatus = 400;
    const { location, cookie } = await begin("x");
    assert.equal((await finish("x", location.searchParams.get("state")!, cookie)).searchParams.get("verify_error"), "failed");
    assert.equal((await rowsFor(ids.creator)).length, 0);
  });

  test("one X account can verify only one market", async () => {
    let { location, cookie } = await begin("x");
    await finish("x", location.searchParams.get("state")!, cookie);

    // The bidder opens a market and tries to verify with the same X account.
    await db.insert(profiles).values({ userId: ids.bidder, handle: "copycat", isActive: false });
    session.userId = ids.bidder;
    ({ location, cookie } = await begin("x"));
    assert.equal((await finish("x", location.searchParams.get("state")!, cookie)).searchParams.get("verify_error"), "taken");
    assert.equal((await rowsFor(ids.bidder)).length, 0);
  });

  test("re-verifying replaces the creator's X account instead of adding a second", async () => {
    let { location, cookie } = await begin("x");
    await finish("x", location.searchParams.get("state")!, cookie);
    xAccount = { id: "x-222", username: "amina_new", name: "Amina" };
    ({ location, cookie } = await begin("x"));
    await finish("x", location.searchParams.get("state")!, cookie);
    const rows = await rowsFor(ids.creator);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.handle, "amina_new");
  });

  test("verifying needs a market first", async () => {
    session.userId = ids.bidder; // has no profile
    const res = await start.GET(get("http://localhost:3000/api/verify/x/start"), params("x"));
    assert.equal(new URL(res.headers.get("location")!).searchParams.get("verify_error"), "no_market");
  });

  test("a market can't go live without a verified account", async () => {
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, ids.creator));
    const post = () =>
      activate.POST(new NextRequest("http://localhost:3000/api/profile/activate", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" } }));

    const refused = await post();
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).code, "VERIFY_REQUIRED");

    const { location, cookie } = await begin("x");
    await finish("x", location.searchParams.get("state")!, cookie);
    const after = await post();
    const body = await after.json().catch(() => ({}));
    assert.notEqual(body.code, "VERIFY_REQUIRED", "verified creators get past the check");
  });

  test("with no provider configured, going live isn't blocked", async () => {
    const saved = { ...process.env };
    delete process.env.X_CLIENT_ID;
    delete process.env.LINKEDIN_CLIENT_ID;
    try {
      await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, ids.creator));
      const res = await activate.POST(
        new NextRequest("http://localhost:3000/api/profile/activate", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" } }),
      );
      const body = await res.json().catch(() => ({}));
      assert.notEqual(body.code, "VERIFY_REQUIRED");
    } finally {
      process.env.X_CLIENT_ID = saved.X_CLIENT_ID;
      process.env.LINKEDIN_CLIENT_ID = saved.LINKEDIN_CLIENT_ID;
    }
  });

  test("a live market keeps its last verified account; extras can be unlinked", async () => {
    const del = (p: string) =>
      unlink.DELETE(new NextRequest(`http://localhost:3000/api/verify/${p}`, { method: "DELETE", headers: { host: "localhost:3000", origin: "http://localhost:3000" } }), params(p));

    let { location, cookie } = await begin("x");
    await finish("x", location.searchParams.get("state")!, cookie);
    ({ location, cookie } = await begin("linkedin"));
    await finish("linkedin", location.searchParams.get("state")!, cookie);
    assert.equal((await rowsFor(ids.creator)).length, 2);

    assert.equal((await del("linkedin")).status, 200);
    const last = await del("x");
    assert.equal(last.status, 409);
    assert.equal((await last.json()).code, "last");
    assert.equal((await rowsFor(ids.creator)).length, 1);

    // Once the market isn't live, the last one can go too.
    await db.update(profiles).set({ isActive: false, onChainTx: null }).where(eq(profiles.userId, ids.creator));
    assert.equal((await del("x")).status, 200);
    assert.equal((await rowsFor(ids.creator)).length, 0);
  });

  test("unlinking refuses cross-site requests", async () => {
    const res = await unlink.DELETE(
      new NextRequest("http://localhost:3000/api/verify/x", { method: "DELETE", headers: { host: "localhost:3000", origin: "https://evil.example" } }),
      params("x"),
    );
    assert.equal(res.status, 403);
  });
});
