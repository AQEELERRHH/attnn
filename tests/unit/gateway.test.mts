/** The agent's x402 buyer rules (lib/gateway.ts): pure, no network. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:9/none";
process.env.ARC_NETWORK = "mainnet";

const gw = await import("../../lib/gateway.ts");

const option = {
  scheme: "exact",
  network: "eip155:5042",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "1000",
  payTo: "0x5e11e40000000000000000000000000000000005",
  maxTimeoutSeconds: 604900,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" },
};

describe("which payments the agent will sign", () => {
  test("Attnn.'s own $0.001 Gateway payment on Arc mainnet is accepted", () => {
    assert.equal(gw.checkPaymentOption(option), null);
    assert.equal(gw.checkPaymentOption({ ...option, amount: "999" }), null, "cheaper is fine");
  });

  test("anything else is refused before signing", () => {
    assert.match(gw.checkPaymentOption({ ...option, amount: "1001" })!, /above/);
    assert.match(gw.checkPaymentOption({ ...option, amount: "0" })!, /above|price/);
    assert.match(gw.checkPaymentOption({ ...option, amount: "1e9" })!, /unreadable/);
    assert.match(gw.checkPaymentOption({ ...option, network: "eip155:5042002" })!, /network/);
    assert.match(gw.checkPaymentOption({ ...option, asset: "0x0000000000000000000000000000000000000001" })!, /USDC/);
    assert.match(gw.checkPaymentOption({ ...option, scheme: "upto" })!, /scheme/);
    assert.match(gw.checkPaymentOption({ ...option, extra: { ...option.extra, name: "Other" } })!, /Gateway/);
    assert.match(gw.checkPaymentOption({ ...option, extra: { ...option.extra, verifyingContract: "0x0000000000000000000000000000000000000bad" } })!, /contract/);
    assert.match(gw.checkPaymentOption({ ...option, payTo: "nope" })!, /seller/);
    assert.match(gw.checkPaymentOption(undefined)!, /no payment option/);
  });
});

describe("helpers", () => {
  test("Gateway's decimal balances become atomic USDC", () => {
    assert.equal(gw.parseUsdcDecimal("0.1"), BigInt(100_000));
    assert.equal(gw.parseUsdcDecimal("12.000001"), BigInt(12_000_001));
    assert.equal(gw.parseUsdcDecimal("0"), BigInt(0));
    assert.equal(gw.parseUsdcDecimal("1.1234567"), BigInt(1_123_456), "extra digits are dropped, never rounded up");
    assert.throws(() => gw.parseUsdcDecimal("-1"));
  });

  test("typed data for Circle spells out EIP712Domain and has no bigints", () => {
    const json = gw.eip712Json({
      domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042, verifyingContract: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" },
      types: { T: [{ name: "value", type: "uint256" }] },
      primaryType: "T",
      message: { value: BigInt(1000) },
    });
    const t = JSON.parse(json);
    assert.deepEqual(t.types.EIP712Domain.map((f: { name: string }) => f.name), ["name", "version", "chainId", "verifyingContract"]);
    assert.equal(t.message.value, "1000");
    assert.equal(t.primaryType, "T");
  });

  test("paid reads are on only with a paywall, and can be switched off", () => {
    delete process.env.SELLER_ADDRESS;
    delete process.env.X402_MOCK;
    assert.equal(gw.agentReadsEnabled(), false);
    process.env.SELLER_ADDRESS = option.payTo;
    assert.equal(gw.agentReadsEnabled(), true);
    process.env.AGENT_X402 = "0";
    assert.equal(gw.agentReadsEnabled(), false);
    delete process.env.AGENT_X402;
  });
});
