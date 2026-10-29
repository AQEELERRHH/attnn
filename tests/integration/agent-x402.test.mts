/**
 * Milestone 3: the bidder agent pays for creator profiles over x402, like an outside agent.
 *
 * Real code end to end: the agent (lib/agent.ts) signs an EIP-3009 authorisation through
 * its Circle wallet (faked signer: a real key, real EIP-712), calls the real profile route
 * (app/api/c/[handle]) which runs the real x402 gate (lib/x402.ts). Only Circle Gateway's
 * facilitator is faked, and it checks the signature by recovering the signer, so a wrongly
 * built or wrongly signed payment fails here exactly as it would at Gateway.
 *
 * Also: the read balance is funded only by the user (POST /api/wallet/agent fund_reads →
 * fundAgentReads job: approve the Gateway wallet for exactly the amount, then deposit).
 */
import "../helpers/env.mts";
process.env.SELLER_ADDRESS = "0x5e11e40000000000000000000000000000000005";
process.env.AUTH_URL = "http://attnn.test";

import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAddress, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { installFakes, world } from "../helpers/fakes.mts";
import { addr, closeDb, ids, resetDatabase, truncateAll } from "../helpers/db.mts";
import { seedMarket } from "../helpers/seed.mts";

await installFakes();

const session = { userId: null as string | null };
mock.module(pathToFileURL(path.resolve("lib/auth.ts")).href, {
  namedExports: { auth: async () => (session.userId ? { user: { id: session.userId, role: "bidder", email: "bidder@test" } } : null) },
});

// ── Circle Gateway, faked at its edges: balances by depositor, and the facilitator ──
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"; // testnet (env.mts)
const gateway = {
  balances: new Map<string, bigint>(),
  settled: [] as { from: string; to: string; value: bigint }[],
  refuse: null as string | null,
};
mock.module("@circle-fin/x402-batching/server", {
  namedExports: {
    BatchFacilitatorClient: class {
      async verify(
        payload: { payload: { signature: Hex; authorization: Record<string, string> } },
        req: { amount: string; payTo: string; network: string; extra: { verifyingContract: string } },
      ) {
        if (gateway.refuse) return { isValid: false, invalidReason: gateway.refuse };
        const a = payload.payload.authorization;
        const signer = await recoverTypedDataAddress({
          domain: { name: "GatewayWalletBatched", version: "1", chainId: Number(req.network.split(":")[1]), verifyingContract: getAddress(req.extra.verifyingContract) },
          types: {
            TransferWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          primaryType: "TransferWithAuthorization",
          message: {
            from: getAddress(a.from!),
            to: getAddress(a.to!),
            value: BigInt(a.value!),
            validAfter: BigInt(a.validAfter!),
            validBefore: BigInt(a.validBefore!),
            nonce: a.nonce as Hex,
          },
          signature: payload.payload.signature,
        });
        if (signer.toLowerCase() !== a.from!.toLowerCase()) return { isValid: false, invalidReason: "invalid_signature" };
        if (a.to!.toLowerCase() !== req.payTo.toLowerCase() || BigInt(a.value!) !== BigInt(req.amount)) return { isValid: false, invalidReason: "mismatch" };
        if ((gateway.balances.get(a.from!.toLowerCase()) ?? BigInt(0)) < BigInt(a.value!)) return { isValid: false, invalidReason: "insufficient_balance" };
        return { isValid: true, payer: a.from };
      }
      async settle(payload: { payload: { authorization: Record<string, string> } }, req: { network: string }) {
        const a = payload.payload.authorization;
        const from = a.from!.toLowerCase();
        gateway.balances.set(from, (gateway.balances.get(from) ?? BigInt(0)) - BigInt(a.value!));
        gateway.settled.push({ from, to: a.to!.toLowerCase(), value: BigInt(a.value!) });
        return { success: true, transaction: `gw-${gateway.settled.length}`, network: req.network, payer: a.from };
      }
    },
  },
});

// ── The network: fake AI, Gateway's balance API, and attnn.test → the real profile route ──
const ai = { proceed: true };
const realFetch = globalThis.fetch;
let profileRoute: { GET: (req: never, ctx: never) => Promise<Response> };
let NextRequestCtor: new (url: string, init?: RequestInit) => unknown;
const profileHits: { paid: boolean }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("http://127.0.0.1:9")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
    const system = body.messages.find((m) => m.role === "system")?.content ?? "";
    const answer = system.includes("evaluation agent") ? { score: 9, proceed: ai.proceed, reason: "fits" } : { score: 3, reason: "meh" };
    return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "https://gateway-api-testnet.circle.com/v1/balances") {
    const { sources } = JSON.parse(String(init?.body)) as { sources: { depositor: string; domain: number }[] };
    assert.equal(sources[0]!.domain, 26, "Arc's Gateway domain");
    const atomic = gateway.balances.get(sources[0]!.depositor.toLowerCase()) ?? BigInt(0);
    const balance = `${atomic / BigInt(1_000_000)}.${(atomic % BigInt(1_000_000)).toString().padStart(6, "0")}`;
    return Response.json({ token: "USDC", balances: [{ domain: 26, depositor: sources[0]!.depositor, balance }] });
  }
  if (url.startsWith("http://attnn.test/api/c/")) {
    const handle = decodeURIComponent(url.split("/api/c/")[1]!);
    const headers = new Headers(init?.headers);
    profileHits.push({ paid: headers.has("payment-signature") });
    return profileRoute.GET(new NextRequestCtor(url, { headers }) as never, { params: Promise.resolve({ handle }) } as never);
  }
  return realFetch(input, init);
}) as typeof fetch;

const { db } = await import("../../lib/db/client.ts");
const { agentLogs, bids, wallets, x402Payments } = await import("../../lib/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { NextRequest } = await import("next/server");
NextRequestCtor = NextRequest as never;
profileRoute = (await import("../../app/api/c/[handle]/route.ts")) as never;
const { runBidderAgent } = await import("../../lib/agent.ts");
const { clearSettingsCache } = await import("../../lib/app-settings.ts");
const gw = await import("../../lib/gateway.ts");
const agentWalletRoute = await import("../../app/api/wallet/agent/route.ts");
const lifecycle = await import("../../inngest/bid-lifecycle.ts");

type Handler = (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown>;
const fundJob = (lifecycle.fundAgentReads as unknown as { __fn: unknown[] }).__fn[2] as Handler;
const step = { run: async (_id: string, fn: () => unknown) => fn(), sleep: async () => {}, sendEvent: async () => {} };

// The agent wallet signs with a real key, so its address is that key's address.
const AGENT_KEY = `0x${"7".repeat(64)}` as Hex;
const AGENT = privateKeyToAccount(AGENT_KEY).address.toLowerCase();

const post = (body: unknown) =>
  agentWalletRoute.POST(
    new NextRequest("http://localhost:3000/api/wallet/agent", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
      body: JSON.stringify(body),
    }),
  );

after(async () => {
  globalThis.fetch = realFetch;
  await closeDb();
});

const logs = async (action: "creator_scored" | "creator_discovered" | "error") =>
  (await db.select().from(agentLogs).where(eq(agentLogs.action, action))).map((l) => l.data as Record<string, unknown>);

describe("bidder agent pays for profiles over x402", () => {
  before(resetDatabase);
  beforeEach(async () => {
    world.reset();
    clearSettingsCache();
    await truncateAll();
    await db.delete(x402Payments);
    await seedMarket();
    // Re-key the bidder's agent wallet to the signing key's address.
    await db.update(wallets).set({ address: AGENT }).where(eq(wallets.circleWalletId, "w-bidder-agent"));
    world.signingKeys.set("w-bidder-agent", AGENT_KEY);
    world.walletAddress.set("w-bidder-agent", AGENT);
    world.usdc.set(AGENT, BigInt(100_000_000));
    world.usdc.delete(addr.bidderAgent);
    gateway.balances.clear();
    gateway.settled.length = 0;
    gateway.refuse = null;
    profileHits.length = 0;
    ai.proceed = true;
    session.userId = null; // the agent calls the profile API with no session, like an outside agent
  });

  test("with a read balance: pays $0.001 for the profile, the payment verifies, then it bids", async () => {
    gateway.balances.set(AGENT, BigInt(100_000)); // $0.10
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 1, JSON.stringify(result.errors));

    // One 402, then one paid request with a signature Gateway accepted.
    assert.deepEqual(profileHits, [{ paid: false }, { paid: true }]);
    assert.deepEqual(gateway.settled, [{ from: AGENT, to: process.env.SELLER_ADDRESS!.toLowerCase(), value: BigInt(1_000) }]);
    assert.equal(gateway.balances.get(AGENT), BigInt(99_000));

    // The signing request Circle received names the Gateway wallet, not the USDC contract.
    const typed = JSON.parse(world.signed[0]!.typedData) as { domain: { verifyingContract: string; chainId: number }; primaryType: string };
    assert.equal(typed.primaryType, "TransferWithAuthorization");
    assert.equal(typed.domain.verifyingContract.toLowerCase(), GATEWAY_WALLET.toLowerCase());
    assert.equal(typed.domain.chainId, 5042002);

    const [payment] = await db.select().from(x402Payments);
    assert.equal(payment!.resource, "profile:amina");
    assert.equal(payment!.payer.toLowerCase(), AGENT);
    const [scoredLog] = await logs("creator_scored");
    assert.equal(scoredLog!.profile, "x402");
    assert.deepEqual(scoredLog!.x402, { amount: "1000", transaction: "gw-1" });
    const [summary] = await logs("creator_discovered");
    assert.equal(summary!.profilesBought, 1);
    assert.equal(summary!.readSpend, "1000");

    const [bid] = await db.select().from(bids);
    assert.equal(bid!.bidderAddress.toLowerCase(), AGENT, "the bid comes from the agent wallet");
  });

  test("a profile bought earlier today isn't paid for again", async () => {
    gateway.balances.set(AGENT, BigInt(100_000));
    ai.proceed = false; // first run: reads and scores, but doesn't bid
    assert.equal((await runBidderAgent(ids.bidder)).bidsPlaced, 0);
    ai.proceed = true;
    const second = await runBidderAgent(ids.bidder);
    assert.equal(second.bidsPlaced, 1, JSON.stringify(second.errors));
    assert.equal(gateway.settled.length, 1, "paid once");
    const sources = (await logs("creator_scored")).map((l) => l.profile).sort();
    assert.deepEqual(sources, ["x402", "x402_earlier"]);
  });

  test("no read balance: reads for free and says how to switch paid reads on", async () => {
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 1, JSON.stringify(result.errors));
    assert.equal(profileHits.length, 0);
    assert.equal(world.signed.length, 0, "nothing signed");
    const [summary] = await logs("creator_discovered");
    assert.match(String(summary!.readNote), /add one on the Agent tab/);
  });

  test("Gateway refuses the payment: that creator is skipped, never bid on", async () => {
    gateway.balances.set(AGENT, BigInt(100_000));
    gateway.refuse = "insufficient_balance";
    const result = await runBidderAgent(ids.bidder);
    assert.equal(result.bidsPlaced, 0);
    assert.match(result.errors.join(" "), /Skipping amina: couldn't pay for the profile .*insufficient_balance/);
    assert.equal((await db.select().from(bids)).length, 0);
    assert.equal((await db.select().from(x402Payments)).length, 0);
  });

  test("switched off with AGENT_X402=0: free reads, nothing signed", async () => {
    gateway.balances.set(AGENT, BigInt(100_000));
    process.env.AGENT_X402 = "0";
    try {
      assert.equal((await runBidderAgent(ids.bidder)).bidsPlaced, 1);
      assert.equal(world.signed.length, 0);
    } finally {
      delete process.env.AGENT_X402;
    }
  });
});

describe("the agent won't sign a payment it doesn't expect", () => {
  const signer = gw.circleSigner("w-bidder-agent", AGENT);
  const serve402 = (accepts: unknown[]) => {
    const saved = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}", {
        status: 402,
        headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts })).toString("base64") },
      })) as typeof fetch;
    return () => (globalThis.fetch = saved);
  };
  const option = {
    scheme: "exact",
    network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    amount: "1000",
    payTo: "0x5e11e40000000000000000000000000000000005",
    maxTimeoutSeconds: 604900,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET },
  };

  for (const [name, bad] of [
    ["a higher price", { ...option, amount: "1001" }],
    ["another network", { ...option, network: "eip155:8453" }],
    ["another token", { ...option, asset: "0x0000000000000000000000000000000000000001" }],
    ["another contract", { ...option, extra: { ...option.extra, verifyingContract: "0x0000000000000000000000000000000000000bad" } }],
  ] as const) {
    test(`refuses ${name}`, async () => {
      world.signingKeys.set("w-bidder-agent", AGENT_KEY);
      world.signed.length = 0;
      const restore = serve402([bad]);
      try {
        await assert.rejects(gw.buyProfile({ baseUrl: "http://evil.test", handle: "amina", signer }), /won't pay/);
      } finally {
        restore();
      }
      assert.equal(world.signed.length, 0, "nothing was signed");
    });
  }
});

describe("adding to the read balance", () => {
  beforeEach(async () => {
    world.reset();
    await truncateAll();
    await seedMarket();
    world.walletAddress.set("w-bidder-agent", addr.bidderAgent);
    gateway.balances.clear();
    session.userId = ids.bidder;
  });

  test("the user adds $0.10: approve the Gateway wallet for exactly that, then deposit; a retry adds nothing", async () => {
    const requestId = crypto.randomUUID();
    const res = await post({ action: "fund_reads", amount: "0.10", requestId });
    assert.equal(res.status, 202, JSON.stringify(await res.clone().json()));
    const [event] = world.events as { id?: string; name: string; data: { userId: string; amount: string; opKey: string } }[];
    assert.equal(event!.name, "attnn/agent.reads-fund");
    assert.equal(event!.data.amount, "100000");
    assert.equal(event!.id, event!.data.opKey, "Inngest de-duplicates a retried request");

    world.autoMine = true;
    await fundJob({ event: { data: event!.data }, step });
    await fundJob({ event: { data: event!.data }, step }); // Inngest retry of the whole run
    const approve = world.calls("approve");
    const deposit = world.calls("deposit");
    assert.equal(approve.length, 1);
    assert.equal(deposit.length, 1);
    assert.deepEqual(approve[0]!.args, [GATEWAY_WALLET, "100000"]);
    assert.equal(approve[0]!.walletId, "w-bidder-agent");
    assert.equal(deposit[0]!.contractAddress, GATEWAY_WALLET.toLowerCase());
    assert.deepEqual(deposit[0]!.args, ["0x3600000000000000000000000000000000000000", "100000"]);
  });

  test("only the fixed amounts, only up to $2 held, only with enough USDC, only signed in", async () => {
    const r = () => crypto.randomUUID();
    assert.equal((await post({ action: "fund_reads", amount: "0.37", requestId: r() })).status, 400);
    gateway.balances.set(addr.bidderAgent, BigInt(1_600_000));
    const over = await post({ action: "fund_reads", amount: "0.50", requestId: r() });
    assert.equal(over.status, 400);
    assert.match((await over.json()).error, /up to \$2\.00/);
    world.usdc.set(addr.bidderAgent, BigInt(120_000));
    assert.equal((await post({ action: "fund_reads", amount: "0.10", requestId: r() })).status, 400, "fees need a little more");
    session.userId = null;
    assert.equal((await post({ action: "fund_reads", amount: "0.10", requestId: r() })).status, 401);
    assert.equal(world.events.length, 0);
  });
});
