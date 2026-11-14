/**
 * Sponsored first network fee + going live right after verification, against a real
 * Postgres with Circle, Arc, Inngest and X faked at the edge.
 *
 * Money rules proved here: only a verified creator who is short of USDC is sponsored;
 * once per user, ever; never past the daily cap; never twice under concurrency or
 * retries; a top-up Circle refused (no USDC moved) may be retried with a new key; an
 * unclear one is resolved by its op key, never re-sent; the registration is sent once,
 * from the creator's own wallet, only after the top-up landed. With sponsorship off
 * (or verification off) the old $1 rule is unchanged.
 */
import "../helpers/env.mts";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installFakes, world } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";

await installFakes();

process.env.X_CLIENT_ID = "x-client";
process.env.X_CLIENT_SECRET = "x-secret";
process.env.AUTH_URL = "http://localhost:3000";
const SPONSOR_WALLET = "w-sponsor";
const SPONSOR_ADDRESS = "0x5900000000000000000000000000000000000005";
const sponsorEnv = () => {
  process.env.GAS_SPONSOR_WALLET_ID = SPONSOR_WALLET;
  process.env.GAS_SPONSOR_WALLET_ADDRESS = SPONSOR_ADDRESS;
  delete process.env.GAS_SPONSOR_AMOUNT_USDC;
  delete process.env.GAS_SPONSOR_DAILY_LIMIT_USDC;
};

const session = { userId: ids.creator as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: {
    auth: async () => (session.userId ? { user: { id: session.userId, role: "creator", email: "t@test" } } : null),
  },
});

// X at the network edge (for the verify → go live flow).
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url === "https://api.x.com/2/oauth2/token") return json({ access_token: "tok", token_type: "bearer" });
  if (url === "https://api.x.com/2/users/me") return json({ data: { id: "x-777", username: "amina", name: "Amina" } });
  return realFetch(input, init);
}) as typeof fetch;

const { NextRequest } = await import("next/server");
const { db } = await import("../../lib/db/client.ts");
const { gasSponsorships, profiles, socialVerifications } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const activate = await import("../../app/api/profile/activate/route.ts");
const start = await import("../../app/api/verify/[provider]/start/route.ts");
const callback = await import("../../app/api/verify/[provider]/callback/route.ts");
const { refreshRegistration, loadRegisteringUserIds } = await import("../../lib/registration.ts");
const { sponsorConfig, SPONSOR_FAILED_REASON } = await import("../../lib/sponsorship.ts");
const { SMALL_FUNDS_MESSAGE } = await import("../../lib/go-live.ts");
const { ACTIVATION_FUNDS_MESSAGE } = await import("../../lib/activation.ts");

const HOST = { host: "localhost:3000", origin: "http://localhost:3000" };
const post = async () => {
  const res = await activate.POST(new NextRequest("http://localhost:3000/api/profile/activate", { method: "POST", headers: HOST }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const transfers = () => world.calls("transfer").filter((t) => t.walletId === SPONSOR_WALLET);
const registrations = () => world.calls("registerCreator");
const profile = async () => (await db.query.profiles.findFirst({ where: eq(profiles.userId, ids.creator) }))!;
const sponsorshipRow = async (userId = ids.creator) =>
  (await db.select().from(gasSponsorships).where(eq(gasSponsorships.userId, userId)))[0];

/** The top-up lands on Arc: Circle COMPLETE and the creator's balance goes up. */
function landTopUp(txId: string) {
  world.complete(txId);
  world.usdc.set(addr.creatorMain, (world.usdc.get(addr.creatorMain) ?? BigInt(0)) + BigInt(100_000));
}

/** The registration lands on Arc. */
function landRegistration(txId: string) {
  world.complete(txId);
  world.activeCreators.add(addr.creatorMain);
}

async function verify(userId = ids.creator, account = "x-1") {
  await db.insert(socialVerifications).values({ userId, provider: "x", providerAccountId: account, handle: "amina" });
}

after(async () => {
  globalThis.fetch = realFetch;
  await closeDb();
});

describe("sponsored first network fee", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    sponsorEnv();
    await truncateAll();
    await seedMarket();
    // A new creator: market saved but not live, empty wallet, not on the registry.
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, ids.creator));
    world.usdc.set(addr.creatorMain, BigInt(0));
    world.activeCreators.delete(addr.creatorMain);
    session.userId = ids.creator;
  });

  test("a verified creator with an empty wallet is topped up once, then registers from their own wallet", async () => {
    await verify();
    const res = await post();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, status: "registering", sponsored: true });

    assert.equal(transfers().length, 1);
    const t = transfers()[0]!;
    assert.deepEqual(t.args, [addr.creatorMain, "100000"], "$0.10 to the creator's own main wallet");
    assert.equal(t.refId, `sponsor:${ids.creator}:1`);
    assert.equal(registrations().length, 0, "nothing is registered before the top-up lands");
    assert.ok(world.events.some((e) => e.name === "attnn/creator.registering"), "the confirmation job is queued");
    assert.deepEqual(await loadRegisteringUserIds(), [ids.creator], "the 10-minute sweep sees it too");

    assert.equal(await refreshRegistration(ids.creator), "registering");
    assert.equal(registrations().length, 0);

    landTopUp(t.id);
    assert.equal(await refreshRegistration(ids.creator), "registering");
    assert.equal(registrations().length, 1);
    assert.equal(registrations()[0]!.walletId, "w-creator-main", "registered from the creator's own wallet");
    assert.equal((await sponsorshipRow())!.status, "complete");

    landRegistration(registrations()[0]!.id);
    assert.equal(await refreshRegistration(ids.creator), "active");
    assert.equal((await profile()).isActive, true);
    assert.equal(transfers().length, 1);
  });

  test("once per user: a creator already sponsored funds the next fee themselves", async () => {
    await verify();
    await post();
    landTopUp(transfers()[0]!.id);
    await refreshRegistration(ids.creator);
    // The registration failed later and the wallet is empty again.
    world.fail(registrations()[0]!.id);
    assert.equal(await refreshRegistration(ids.creator), "failed");
    world.usdc.set(addr.creatorMain, BigInt(0));

    const again = await post();
    assert.equal(again.status, 400);
    assert.equal(again.body.code, "INSUFFICIENT_FUNDS");
    assert.equal(again.body.error, SMALL_FUNDS_MESSAGE);
    assert.equal(transfers().length, 1, "never a second top-up");
  });

  test("no verified account: no top-up and no registration", async () => {
    const res = await post();
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "VERIFY_REQUIRED");
    assert.equal(world.txs.length, 0);
    assert.equal(await sponsorshipRow(), undefined);
  });

  test("the daily cap: today's sponsorships count, older ones don't, and nothing is sent past it", async () => {
    await verify();
    process.env.GAS_SPONSOR_DAILY_LIMIT_USDC = "0.10";
    await db.insert(gasSponsorships).values({
      userId: ids.other,
      walletAddress: "0xother",
      sponsorWalletId: SPONSOR_WALLET,
      amountUsdc: "100000",
      status: "complete",
    });
    const capped = await post();
    assert.equal(capped.status, 400);
    assert.equal(capped.body.code, "INSUFFICIENT_FUNDS");
    assert.equal(world.txs.length, 0);
    assert.equal((await profile()).onChainTx, null, "the registration slot isn't taken");

    // The other sponsorship was 25 hours ago: it no longer counts.
    await db.update(gasSponsorships).set({ reservedAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(gasSponsorships.userId, ids.other));
    const ok = await post();
    assert.equal(ok.status, 200);
    assert.equal(transfers().length, 1);
  });

  test("a failed sponsorship doesn't count toward the cap", async () => {
    await verify();
    process.env.GAS_SPONSOR_DAILY_LIMIT_USDC = "0.10";
    await db.insert(gasSponsorships).values({
      userId: ids.other,
      walletAddress: "0xother",
      sponsorWalletId: SPONSOR_WALLET,
      amountUsdc: "100000",
      status: "failed",
    });
    assert.equal((await post()).status, 200);
    assert.equal(transfers().length, 1);
  });

  test("a creator with enough for the fee isn't sponsored", async () => {
    await verify();
    world.usdc.set(addr.creatorMain, BigInt(20_000)); // $0.02
    const res = await post();
    assert.deepEqual(res.body, { success: true, status: "registering" });
    assert.equal(transfers().length, 0);
    assert.equal(registrations().length, 1);
  });

  test("ten Go live presses at once send one top-up and one registration", async () => {
    await verify();
    const results = await Promise.all(Array.from({ length: 10 }, () => post()));
    assert.ok(results.every((r) => r.status === 200 && r.body.status === "registering"), JSON.stringify(results));
    assert.equal(transfers().length, 1);

    landTopUp(transfers()[0]!.id);
    await Promise.all(Array.from({ length: 5 }, () => refreshRegistration(ids.creator)));
    await Promise.all(Array.from({ length: 5 }, () => post()));
    assert.equal(registrations().length, 1, "the registration is sent once");
    assert.equal(transfers().length, 1);
  });

  test("two creators racing for the last of the daily budget: only one is paid", async () => {
    await verify(ids.creator, "x-1");
    process.env.GAS_SPONSOR_DAILY_LIMIT_USDC = "0.10";
    // A second unfunded, verified creator.
    const { wallets } = await import("../../lib/db/schema.ts");
    await db.insert(wallets).values({ userId: ids.other, circleWalletId: "w-other-main", address: "0xd100000000000000000000000000000000000001", blockchain: "ARC-TESTNET", state: "active", purpose: "main" });
    await db.insert(profiles).values({ userId: ids.other, handle: "bola", minBid: "5000000", tags: ["ai"], isActive: false });
    await verify(ids.other, "x-2");

    const as = async (userId: string) => {
      session.userId = userId;
      return post();
    };
    // session is read at the start of each request, so set it right before each call.
    const p1 = as(ids.creator);
    const p2 = as(ids.other);
    const results = await Promise.all([p1, p2]);
    assert.equal(transfers().length, 1, JSON.stringify(results));
    assert.equal(results.filter((r) => r.body.code === "INSUFFICIENT_FUNDS").length, 1);
  });

  test("a registration already on its way is never paired with a top-up", async () => {
    await verify();
    const { sponsorActivation } = await import("../../lib/sponsorship.ts");
    await db.update(profiles).set({ onChainTx: "tx-in-flight" }).where(eq(profiles.userId, ids.creator));
    assert.equal(await sponsorActivation(ids.creator, addr.creatorMain, sponsorConfig()!), "busy");
    assert.equal(transfers().length, 0);
    assert.equal(await sponsorshipRow(), undefined, "nothing reserved either");
    assert.equal((await profile()).onChainTx, "tx-in-flight", "the registration is untouched");
  });

  test("Circle refuses the top-up: nothing moved, the creator sees why and can retry with a new key", async () => {
    await verify();
    world.failNextSubmit = Object.assign(new Error("insufficient balance"), { status: 400 });
    const res = await post();
    assert.equal(res.status, 502);
    assert.equal(res.body.code, "SPONSOR_FAILED");
    const row = (await sponsorshipRow())!;
    assert.equal(row.status, "failed");
    const p = await profile();
    assert.equal(p.onChainTx, null);
    assert.equal(p.registrationError, SPONSOR_FAILED_REASON);

    const retry = await post();
    assert.equal(retry.status, 200);
    assert.equal(transfers().length, 1);
    assert.equal(transfers()[0]!.refId, `sponsor:${ids.creator}:2`);
  });

  test("the top-up fails on Arc: the market isn't registered, the creator can retry", async () => {
    await verify();
    await post();
    world.fail(transfers()[0]!.id);
    assert.equal(await refreshRegistration(ids.creator), "failed");
    assert.equal(registrations().length, 0);
    assert.equal((await profile()).registrationError, SPONSOR_FAILED_REASON);

    assert.equal((await post()).status, 200);
    assert.equal(transfers().length, 2);
    assert.equal(transfers()[1]!.refId, `sponsor:${ids.creator}:2`);
  });

  test("an unclear send (timeout) is found by its op key, never sent again", async () => {
    await verify();
    world.timeoutNextSubmit = true;
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "registering");
    assert.equal((await sponsorshipRow())!.circleTxId, null);

    // Circle's list doesn't show it yet: still waiting, nothing re-sent.
    assert.equal(await refreshRegistration(ids.creator), "registering");
    assert.equal((await post()).body.status, "registering");
    assert.equal(transfers().length, 1);

    world.unlisted.clear();
    landTopUp(transfers()[0]!.id);
    assert.equal(await refreshRegistration(ids.creator), "registering");
    assert.equal((await sponsorshipRow())!.circleTxId, transfers()[0]!.id);
    assert.equal(registrations().length, 1);
    assert.equal(transfers().length, 1);
  });

  test("a top-up Circle never received is given up after 10 minutes, so the creator can retry", async () => {
    await verify();
    world.timeoutNextSubmit = true;
    await post();
    world.txs.length = 0; // it never reached Circle
    await db.update(gasSponsorships).set({ reservedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(gasSponsorships.userId, ids.creator));
    assert.equal(await refreshRegistration(ids.creator), "failed");
    assert.equal((await sponsorshipRow())!.status, "failed");
    assert.equal((await post()).status, 200);
    assert.equal(transfers()[0]!.refId, `sponsor:${ids.creator}:2`);
  });

  test("sponsorship off: the $1 rule is unchanged", async () => {
    await verify();
    delete process.env.GAS_SPONSOR_WALLET_ID;
    world.usdc.set(addr.creatorMain, BigInt(500_000));
    const res = await post();
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "INSUFFICIENT_FUNDS");
    assert.equal(res.body.error, ACTIVATION_FUNDS_MESSAGE);
    assert.equal(world.txs.length, 0);
  });

  test("verification off: nobody is sponsored, even with a sponsor wallet set", async () => {
    delete process.env.X_CLIENT_ID;
    try {
      const res = await post();
      assert.equal(res.body.code, "INSUFFICIENT_FUNDS");
      assert.equal(res.body.error, ACTIVATION_FUNDS_MESSAGE);
      assert.equal(world.txs.length, 0);
    } finally {
      process.env.X_CLIENT_ID = "x-client";
    }
  });

  test("the hourly health check alerts when the sponsor wallet runs low", async () => {
    const { quickHealthCheck } = await import("../../lib/health.ts");
    const sponsorAlerts = async () => (await quickHealthCheck()).problems.filter((p) => p.includes("Gas sponsor"));
    world.usdc.set(SPONSOR_ADDRESS, BigInt(5_000_000));
    assert.deepEqual(await sponsorAlerts(), []);
    world.usdc.set(SPONSOR_ADDRESS, BigInt(900_000)); // $0.90, under $1
    assert.equal((await sponsorAlerts()).length, 1);
    delete process.env.GAS_SPONSOR_WALLET_ID; // not set up: nothing to watch
    assert.deepEqual(await sponsorAlerts(), []);
  });

  test("settings that can't be read switch sponsorship off, and the amount can't exceed $1", () => {
    assert.ok(sponsorConfig());
    for (const [amount, limit] of [["5", undefined], ["abc", undefined], ["0", undefined], ["0.10", "0.05"], ["-1", undefined]] as const) {
      process.env.GAS_SPONSOR_AMOUNT_USDC = amount;
      if (limit) process.env.GAS_SPONSOR_DAILY_LIMIT_USDC = limit;
      else delete process.env.GAS_SPONSOR_DAILY_LIMIT_USDC;
      assert.equal(sponsorConfig(), null, `${amount} / ${limit}`);
    }
    process.env.GAS_SPONSOR_AMOUNT_USDC = "0.25";
    assert.equal(sponsorConfig()!.amount, BigInt(250_000));
    process.env.GAS_SPONSOR_WALLET_ADDRESS = "not-an-address";
    assert.equal(sponsorConfig(), null);
  });
});

describe("going live right after verification", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    sponsorEnv();
    await truncateAll();
    await seedMarket();
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, ids.creator));
    world.usdc.set(addr.creatorMain, BigInt(0));
    world.activeCreators.delete(addr.creatorMain);
    session.userId = ids.creator;
  });

  const params = (provider: string) => ({ params: Promise.resolve({ provider }) });
  async function verifyWithX() {
    const s = await start.GET(new NextRequest("http://localhost:3000/api/verify/x/start", { headers: { host: "localhost:3000" } }), params("x"));
    const location = new URL(s.headers.get("location")!);
    const cookie = /attnn_verify=([^;]+)/.exec(s.headers.get("set-cookie") ?? "")![1]!;
    const res = await callback.GET(
      new NextRequest(`http://localhost:3000/api/verify/x/callback?code=c&state=${location.searchParams.get("state")}`, {
        headers: { host: "localhost:3000", cookie: `attnn_verify=${cookie}` },
      }),
      params("x"),
    );
    return new URL(res.headers.get("location")!);
  }

  test("verifying an unfunded market sponsors it and starts going live", async () => {
    const back = await verifyWithX();
    assert.equal(back.searchParams.get("verified"), "x");
    assert.equal(back.searchParams.get("live"), "going");
    assert.equal(transfers().length, 1);
    landTopUp(transfers()[0]!.id);
    await refreshRegistration(ids.creator);
    landRegistration(registrations()[0]!.id);
    assert.equal(await refreshRegistration(ids.creator), "active");
  });

  test("verifying a funded market registers it straight away", async () => {
    world.usdc.set(addr.creatorMain, BigInt(1_000_000));
    const back = await verifyWithX();
    assert.equal(back.searchParams.get("live"), "going");
    assert.equal(transfers().length, 0);
    assert.equal(registrations().length, 1);
  });

  test("verifying a market that's already live changes nothing", async () => {
    await db.update(profiles).set({ isActive: true }).where(eq(profiles.userId, ids.creator));
    const back = await verifyWithX();
    assert.equal(back.searchParams.get("verified"), "x");
    assert.equal(back.searchParams.get("live"), null);
    assert.equal(world.txs.length, 0);
  });

  test("no sponsor and no USDC: verified, and told to add funds", async () => {
    delete process.env.GAS_SPONSOR_WALLET_ID;
    const back = await verifyWithX();
    assert.equal(back.searchParams.get("verified"), "x");
    assert.equal(back.searchParams.get("live"), "funds");
    assert.equal(world.txs.length, 0);
  });

  test("going live failing never undoes the verification", async () => {
    world.usdc.set(addr.creatorMain, BigInt(1_000_000));
    world.failNextSubmit = Object.assign(new Error("boom"), { status: 500 });
    const back = await verifyWithX();
    assert.equal(back.searchParams.get("verified"), "x");
    assert.equal(back.searchParams.get("live"), "retry");
    const rows = await db.select().from(socialVerifications).where(eq(socialVerifications.userId, ids.creator));
    assert.equal(rows.length, 1);
  });
});
