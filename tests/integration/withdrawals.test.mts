/**
 * D4: sending USDC out of a main wallet. A new address needs the code emailed to the
 * account; at most $500 leaves in any 24 hours, also when sends race; a retry with the
 * same request id never pays twice; a refused transfer doesn't use up the limit.
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
  namedExports: { auth: async () => (session.userId ? { user: { id: session.userId, role: "bidder", email: "bidder@test" } } : null) },
});
// Captures user emails instead of sending them; `failNext` simulates Resend refusing.
const mail = { sent: [] as { to: string; subject: string; text: string }[], failNext: false };
mock.module(pathToFileURL(path.resolve("lib/email.ts")).href, {
  namedExports: {
    sendUserEmail: async (to: string, subject: string, text: string) => {
      if (mail.failNext) {
        mail.failNext = false;
        return false;
      }
      mail.sent.push({ to, subject, text });
      return true;
    },
  },
});

const { db } = await import("../../lib/db/client.ts");
const { withdrawals, withdrawalCodes } = await import("../../lib/db/schema.ts");
const { NextRequest } = await import("next/server");
const route = await import("../../app/api/wallet/send/route.ts");
const bidRoute = await import("../../app/api/bid/place/route.ts");
const agentRoute = await import("../../app/api/wallet/agent/route.ts");
const configRoute = await import("../../app/api/bidder-config/create/route.ts");
const { bids, bidderConfigs } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");

const NEW = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const postTo = (url: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
const bid = (amountUsdc: string, code?: string) => bidRoute.POST(postTo("/api/bid/place", { creatorHandle: "amina", amountUsdc, message: "hi", ...(code ? { code } : {}) }));
const topUp = (amount: string, requestId = crypto.randomUUID(), code?: string) =>
  agentRoute.POST(postTo("/api/wallet/agent", { action: "fund", amount, requestId, ...(code ? { code } : {}) }));
const post = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/wallet/send", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
const send = (to: string, amount: string, extra: Record<string, unknown> = {}) =>
  route.POST(post({ to, amount, requestId: crypto.randomUUID(), ...extra }));
const lastCode = () => /\b(\d{6})\b/.exec(mail.sent.filter((m) => m.subject.includes("code")).at(-1)?.text ?? "")?.[1];

/** Confirms NEW through the real code flow. */
async function confirm(address = NEW) {
  const requestId = crypto.randomUUID();
  const first = await route.POST(post({ to: address, amount: "1", requestId }));
  assert.equal(first.status, 202);
  const second = await route.POST(post({ to: address, amount: "1", requestId, code: lastCode() }));
  assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
}

describe("D4: withdrawals", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    await truncateAll();
    await seedMarket({ bidderUsdc: BigInt(2_000_000_000) });
    session.userId = ids.bidder;
    mail.sent.length = 0;
    mail.failNext = false;
    clearSettingsCache();
  });
  after(closeDb);

  test("a new address gets an emailed code first; nothing is sent until it's entered", async () => {
    const res = await send(NEW, "10");
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.needsCode, true);
    assert.match(body.sentTo, /@test$/);
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0]!.to, "bidder@test");
    assert.match(lastCode() ?? "", /^\d{6}$/);
    assert.equal(world.calls("transfer").length, 0);
    const [stored] = await db.select().from(withdrawalCodes);
    assert.ok(stored && !stored.codeHash.includes(lastCode()!), "only a keyed hash of the code is stored");
  });

  test("the right code sends once and remembers the address; next time no code is needed", async () => {
    const requestId = crypto.randomUUID();
    await route.POST(post({ to: NEW, amount: "10", requestId }));
    const ok = await route.POST(post({ to: NEW, amount: "10", requestId, code: lastCode() }));
    assert.equal(ok.status, 200);
    assert.equal(world.calls("transfer").length, 1);
    assert.deepEqual(world.calls("transfer")[0]!.args, [NEW, "10000000"]);
    assert.ok(mail.sent.some((m) => m.subject.includes("You sent $10.00")), "the account is told about every send");
    const again = await send(NEW, "5");
    assert.equal(again.status, 200, "confirmed address: no second code");
    assert.equal(world.calls("transfer").length, 2);
  });

  test("wrong codes count down and then the code dies; a code can't be used for another address", async () => {
    const requestId = crypto.randomUUID();
    await route.POST(post({ to: NEW, amount: "10", requestId }));
    const good = lastCode()!;
    const wrong = good === "000000" ? "111111" : "000000";
    const r1 = await route.POST(post({ to: NEW, amount: "10", requestId, code: wrong }));
    assert.equal(r1.status, 400);
    assert.match((await r1.json()).error, /4 tries left/);

    // NEW's code doesn't work for OTHER (it asks for OTHER's own code instead).
    const other = await route.POST(post({ to: OTHER, amount: "10", requestId: crypto.randomUUID(), code: good }));
    assert.equal(other.status, 410);

    for (let i = 0; i < 4; i++) await route.POST(post({ to: NEW, amount: "10", requestId, code: wrong }));
    const dead = await route.POST(post({ to: NEW, amount: "10", requestId, code: good }));
    assert.equal(dead.status, 410, "after 5 wrong tries even the right code is refused");
    assert.equal(world.calls("transfer").length, 0);
  });

  test("parallel guesses can't get more than 5 tries", async () => {
    const requestId = crypto.randomUUID();
    await route.POST(post({ to: NEW, amount: "10", requestId }));
    const good = lastCode()!;
    const guesses = Array.from({ length: 20 }, (_, i) => String((Number(good) + 1 + i) % 1_000_000).padStart(6, "0"));
    // Straight at the check (the route's rate limit would stop most of these first).
    const { confirmWithdrawalAddress } = await import("../../lib/withdrawals.ts");
    await Promise.allSettled(guesses.map((code) => confirmWithdrawalAddress(ids.bidder, NEW, code)));
    const [row] = await db.select().from(withdrawalCodes);
    assert.equal(row!.attempts, 5);
    assert.equal((await route.POST(post({ to: NEW, amount: "10", requestId, code: good }))).status, 410);
  });

  test("a second code within a minute is refused; an email failure stores no code", async () => {
    await send(NEW, "10");
    assert.equal((await send(NEW, "10")).status, 429);
    mail.failNext = true;
    const failed = await send(OTHER, "10");
    assert.equal(failed.status, 503);
    const codes = await db.select().from(withdrawalCodes);
    assert.equal(codes.length, 1, "only NEW's code exists");
  });

  test("the user's own agent wallet needs no code", async () => {
    const res = await send(addr.bidderAgent, "5");
    assert.equal(res.status, 200);
    assert.equal(mail.sent.filter((m) => m.subject.includes("code")).length, 0);
  });

  test("at most $500 in 24 hours, with a clear message and the GET allowance", async () => {
    await confirm();
    assert.equal((await send(NEW, "300")).status, 200);
    const over = await send(NEW, "250");
    assert.equal(over.status, 429);
    assert.match((await over.json()).error, /\$199\.00 left/); // $1 (confirm) + $300 sent
    const allowance = await (await route.GET()).json();
    assert.equal(allowance.limit, "500000000");
    assert.equal(allowance.remaining, "199000000");
    assert.equal((await send(NEW, "199")).status, 200);
    // Sends older than 24 hours no longer count.
    await db.update(withdrawals).set({ createdAt: new Date(Date.now() - 25 * 3600_000) });
    assert.equal((await send(NEW, "400")).status, 200);
  });

  test("sends racing each other can't get past the limit together", async () => {
    await confirm();
    const results = await Promise.all(Array.from({ length: 5 }, () => send(NEW, "200")));
    const ok = results.filter((r) => r.status === 200).length;
    assert.equal(ok, 2, "$1 + 2 × $200 fits; a third $200 would not");
    const sent = world.calls("transfer").reduce((s, t) => s + BigInt(t.args[1] as string), BigInt(0));
    assert.ok(sent <= BigInt(500_000_000));
  });

  test("a retry of the same request pays once; a refused transfer frees the limit, an unclear one doesn't", async () => {
    await confirm();
    const requestId = crypto.randomUUID();
    const a = await route.POST(post({ to: NEW, amount: "100", requestId }));
    const b = await route.POST(post({ to: NEW, amount: "100", requestId }));
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(world.calls("transfer").length, 2, "one for confirm(), one for this request");
    assert.equal(mail.sent.filter((m) => m.subject.includes("You sent")).length, 2, "no second notice for the retry");

    // Circle refuses outright (4xx): nothing sent, nothing counted, the browser restarts.
    world.failNextSubmit = Object.assign(new Error("insufficient funds"), { status: 400 });
    const refusedId = crypto.randomUUID();
    assert.equal((await route.POST(post({ to: NEW, amount: "300", requestId: refusedId }))).status, 500);
    const retryRefused = await route.POST(post({ to: NEW, amount: "300", requestId: refusedId }));
    assert.equal(retryRefused.status, 409);
    assert.equal((await retryRefused.json()).restart, true);
    assert.equal((await (await route.GET()).json()).remaining, "399000000");

    // A timeout: it may have gone through, so it stays counted; the retry finishes it.
    world.timeoutNextSubmit = true;
    const unclearId = crypto.randomUUID();
    assert.equal((await route.POST(post({ to: NEW, amount: "50", requestId: unclearId }))).status, 500);
    assert.equal((await (await route.GET()).json()).remaining, "349000000");
    const finished = await route.POST(post({ to: NEW, amount: "50", requestId: unclearId }));
    assert.equal(finished.status, 200);
    assert.equal(world.calls("transfer").filter((t) => t.args[1] === "50000000").length, 1, "never sent twice");
  });

  test("signed out, cross-site, or to the wallet's own address: refused", async () => {
    assert.equal((await send(addr.bidderMain, "5")).status, 400);
    session.userId = null;
    assert.equal((await send(NEW, "5")).status, 401);
    assert.equal((await route.GET()).status, 401);
    assert.equal(world.txs.length, 0);
  });

  // ── One allowance for everything that leaves the main wallet ──
  test("bids placed by hand and sends share the $500: a $300 bid leaves $200 to send", async () => {
    await confirm(); // $1
    assert.equal((await bid("300000000")).status, 202, "bid queued");
    const over = await send(NEW, "250");
    assert.equal(over.status, 429);
    assert.match((await over.json()).error, /\$199\.00 left/);
    assert.equal((await (await route.GET()).json()).remaining, "199000000");
  });

  test("a bid over the allowance needs the emailed code, approves only that bid, then counts", async () => {
    assert.equal((await bid("400000000")).status, 202);
    const over = await bid("200000000"); // $600 > $500
    assert.equal(over.status, 202);
    const body = await over.json();
    assert.equal(body.needsCode, true);
    assert.equal((await db.select().from(bids)).length, 1, "no bid recorded without the code");
    const code = lastCode()!;
    // The code is for $200 to this creator, not for a different amount.
    assert.equal((await bid("250000000", code)).status, 410);
    assert.equal((await bid("200000000")).status, 429, "asking again within a minute: refused, the old code stands");
    // A fresh code for $200 approves exactly that bid.
    await db.delete((await import("../../lib/db/schema.ts")).withdrawalCodes);
    await bid("200000000");
    assert.equal((await bid("200000000", lastCode())).status, 202);
    assert.equal((await db.select().from(bids)).length, 2);
    assert.equal((await (await route.GET()).json()).remaining, "0");
  });

  test("agent bids aren't counted again (the agent wallet was funded under the allowance)", async () => {
    const { createBidIntent } = await import("../../lib/bids.ts");
    await createBidIntent({ bidderUserId: ids.bidder, creatorUserId: ids.creator, amountUsdc: "20000000", fromAgentWallet: true });
    assert.equal((await (await route.GET()).json()).remaining, "500000000");
  });

  test("moving USDC to the agent counts; over the allowance it needs the code; moving it back doesn't count", async () => {
    world.usdc.set(addr.bidderMain, BigInt(2_000_000_000));
    assert.equal((await topUp("450")).status, 202);
    const requestId = crypto.randomUUID();
    const over = await topUp("100", requestId);
    assert.equal((await over.json()).needsCode, true);
    assert.equal(world.calls("transfer").length, 1);
    const ok = await topUp("100", requestId, lastCode());
    assert.equal(ok.status, 202);
    assert.equal(world.calls("transfer").length, 2);
    const back = await agentRoute.POST(postTo("/api/wallet/agent", { action: "withdraw", amount: "50", requestId: crypto.randomUUID() }));
    assert.equal(back.status, 202);
    assert.equal((await (await route.GET()).json()).remaining, "0", "$550 out; moving $50 back doesn't refill it");
    assert.equal((await send(NEW, "1")).status, 429, "sends never go over");
  });

  test("raising the agent's budget or cap needs the code; lowering it doesn't", async () => {
    const save = (body: Record<string, unknown>) => configRoute.POST(postTo("/api/bidder-config/create", body));
    const raise = await save({ dailyBudget: "900000000", maxBidPerCreator: "20000000" });
    assert.equal(raise.status, 202);
    assert.equal((await raise.json()).needsCode, true);
    const cfg = async () => (await db.query.bidderConfigs.findFirst({ where: eq(bidderConfigs.userId, ids.bidder) }))!;
    assert.equal((await cfg()).dailyBudget, "50000000", "unchanged without the code");
    const ok = await save({ dailyBudget: "900000000", maxBidPerCreator: "20000000", code: lastCode() });
    assert.equal(ok.status, 200);
    assert.equal((await cfg()).dailyBudget, "900000000");
    const lower = await save({ dailyBudget: "10000000", maxBidPerCreator: "5000000", goal: "find designers" });
    assert.equal(lower.status, 200);
    assert.equal((await cfg()).maxBidPerCreator, "5000000");
  });

  test("M2: a send that needed a retry still emails the notice, exactly once", async () => {
    await confirm();
    mail.sent.length = 0;
    world.timeoutNextSubmit = true;
    const requestId = crypto.randomUUID();
    assert.equal((await route.POST(post({ to: NEW, amount: "20", requestId }))).status, 500);
    assert.equal((await route.POST(post({ to: NEW, amount: "20", requestId }))).status, 200);
    assert.equal((await route.POST(post({ to: NEW, amount: "20", requestId }))).status, 200);
    assert.equal(mail.sent.filter((m) => m.subject.includes("You sent $20.00")).length, 1);
  });

  test("no code is emailed for a send the allowance would refuse", async () => {
    await confirm();
    await send(NEW, "499");
    mail.sent.length = 0;
    assert.equal((await send(OTHER, "5")).status, 429);
    assert.equal(mail.sent.length, 0);
  });
});
