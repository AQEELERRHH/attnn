/**
 * POST /api/onramp/session: card funding sends USDC only to the signed-in user's own
 * main wallet. Nothing in the request can redirect it (Circle's drop-in route handler
 * would take the destination from the body, which is why we don't use it).
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

const session = { userId: ids.bidder as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: {
    auth: async () => (session.userId ? { user: { id: session.userId, role: "bidder", email: "t@test" } } : null),
  },
});

// Circle's Onramp server kit, faked at the network edge: records what we ask it to mint.
const minted: { options: Record<string, unknown>; request: Record<string, unknown> }[] = [];
const { KitError } = await import("@circle-fin/onramp-kit/server");
const fakeServerKit = {
  namedExports: {
    KitError,
    createOnrampServerKit: (options: Record<string, unknown>) => ({
      createSession: async (request: Record<string, unknown>) => {
        minted.push({ options, request });
        return {
          sessionId: "s-1",
          sessionToken: "token-1",
          widgetUrl: "https://onramp-sandbox.arc.io/launch/onramp/v1?token=token-1",
          destinationWallet: request.destinationAddress,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        };
      },
    }),
  },
};
// The app may load either build of the package (ESM or CommonJS): fake both.
for (const build of ["server.mjs", "server.cjs"]) {
  mock.module(pathToFileURL(path.resolve("node_modules/@circle-fin/onramp-kit", build)).href, fakeServerKit);
}

const { NextRequest } = await import("next/server");
const route = await import("../../app/api/onramp/session/route.ts");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/onramp/session", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

describe("card funding sessions (Onramp Kit)", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    minted.length = 0;
    await truncateAll();
    await seedMarket();
    session.userId = ids.bidder;
    process.env.ONRAMP_API_KEY = "KIT_KEY:test:test";
  });
  after(async () => {
    delete process.env.ONRAMP_API_KEY;
    await closeDb();
  });

  test("the session pays USDC on Arc into the user's own main wallet, whatever the request says", async () => {
    const attacker = "0x000000000000000000000000000000000000dEaD";
    const res = await route.POST(post({ appUserId: "someone-else", destinationAddress: attacker, destinationChain: "Ethereum" }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(minted.length, 1);
    const { options, request } = minted[0]!;
    assert.equal(request.destinationAddress, addr.bidderMain);
    assert.equal(request.appUserId, ids.bidder);
    assert.equal(request.destinationChain, "Arc_Testnet");
    // Testnet → Circle sandbox, with the widget origin to match.
    assert.equal(options.baseUrl, "https://api-test.circle.com");
    assert.equal(options.widgetBaseUrl, "https://onramp-sandbox.arc.io");
    const body = await res.json();
    assert.equal(body.sessionToken, "token-1");
  });

  test("signed out → 401; another site → refused; no session minted", async () => {
    session.userId = null;
    assert.equal((await route.POST(post({}))).status, 401);
    session.userId = ids.bidder;
    const cross = await route.POST(post({}, { origin: "https://evil.example" }));
    assert.equal(cross.status, 403);
    assert.equal(minted.length, 0);
  });

  test("no Kit key configured → 503, nothing minted", async () => {
    delete process.env.ONRAMP_API_KEY;
    const res = await route.POST(post({}));
    assert.equal(res.status, 503);
    assert.equal(minted.length, 0);
  });

  test("a user without a wallet gets a clear 400, nothing minted", async () => {
    session.userId = "00000000-0000-4000-8000-0000000000ff";
    const res = await route.POST(post({}));
    assert.equal(res.status, 400);
    assert.equal(minted.length, 0);
  });
});
