/**
 * Card funding (Arc Onramp Kit): the session always pays USDC on Arc into the given
 * wallet, and the environment follows the Arc network.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
const { onrampEnvironment, onrampSessionRequest } = await import("../../lib/onramp.ts");

describe("onramp rules", () => {
  test("mainnet uses Circle production; testnet uses the sandbox (API and widget always match)", () => {
    const main = onrampEnvironment("mainnet");
    assert.equal(main.name, "production");
    assert.equal(main.apiBaseUrl, "https://api.circle.com");
    assert.equal(main.widgetBaseUrl, "https://onramp.arc.io");
    assert.equal(main.destinationChain, "Arc");
    const test_ = onrampEnvironment("testnet");
    assert.equal(test_.name, "sandbox");
    assert.equal(test_.apiBaseUrl, "https://api-test.circle.com");
    assert.equal(test_.widgetBaseUrl, "https://onramp-sandbox.arc.io");
    assert.equal(test_.destinationChain, "Arc_Testnet");
  });

  test("a session pays USDC on Arc into exactly the wallet given, for that user", () => {
    const req = onrampSessionRequest("user-1", "0x1111111111111111111111111111111111111111", "mainnet");
    assert.equal(req.appUserId, "user-1");
    assert.equal(req.destinationAddress, "0x1111111111111111111111111111111111111111");
    assert.equal(req.destinationChain, "Arc", "never the kit's default (Ethereum)");
    assert.deepEqual(req.assets, { pairs: [{ token: "USDC", chain: "arc" }] });
  });
});
