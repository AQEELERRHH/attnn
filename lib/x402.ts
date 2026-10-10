/**
 * x402 v2 paywall settled through Circle Gateway (batched, gas-free "nanopayments").
 *
 *   1. No Payment-Signature header → 402 with a base64 PAYMENT-REQUIRED header
 *      offering the GatewayWalletBatched scheme on this Arc network.
 *   2. Header present → verify + settle with Circle's BatchFacilitatorClient,
 *      record the payment, and hand back a PAYMENT-RESPONSE receipt
 *      ({ success, transaction, network, payer }) that GatewayClient.pay() reads.
 *
 * Retries are idempotent: the same signed payment (same header) is settled once;
 * a replay of it for the same resource returns the stored receipt instead of
 * failing or charging again. A replay for a different resource is refused.
 *
 * Fails closed: without SELLER_ADDRESS (and without explicit X402_MOCK=1) it
 * refuses to serve rather than giving the resource away.
 */
import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { arc } from "./chain";
import { db } from "./db/client";
import { x402Payments } from "./db/schema";
import { dollarsToAtomic } from "./format";

const SELLER_ADDRESS = (process.env.SELLER_ADDRESS ?? "").trim() as `0x${string}` | "";
const MOCK = process.env.X402_MOCK === "1";

/**
 * How long a signed payment stays valid. Circle's GatewayClient always signs for
 * at least 7 days + 100 s and Circle's own seller middleware advertises exactly
 * that, so we match it (a shorter window made Gateway reject the signature).
 */
const GATEWAY_VALIDITY_SECONDS = 7 * 24 * 60 * 60 + 100;

export interface X402Receipt {
  success: true;
  transaction: string;
  network: string;
  payer: string;
  amount: string;
  /** True when this response replays an earlier settlement of the same payment. */
  replay?: boolean;
}

function atomicPrice(price: string): string {
  const v = dollarsToAtomic(price);
  if (v === null || v <= BigInt(0)) throw new Error(`Invalid x402 price ${price}`);
  return v.toString();
}

function buildRequirements(price: string) {
  return {
    scheme: "exact" as const,
    network: arc.caip2,
    asset: arc.usdcAddress,
    amount: atomicPrice(price),
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: GATEWAY_VALIDITY_SECONDS,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: arc.gatewayWallet,
    },
  };
}

function challenge402(price: string, endpoint: string, description: string) {
  const paymentRequired = {
    x402Version: 2,
    resource: { url: endpoint, description, mimeType: "application/json" },
    accepts: [buildRequirements(price)],
  };
  return new NextResponse(JSON.stringify({ error: "payment required", price, network: arc.caip2 }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
    },
  });
}

const encodeReceipt = (r: X402Receipt) => Buffer.from(JSON.stringify(r)).toString("base64");

export type GateResult =
  | { ok: false; response: NextResponse }
  | { ok: true; receipt: X402Receipt; paymentResponseHeader: string };

/**
 * Charges `price` for `resource` (a stable id such as "profile:alice").
 * Call it only after confirming the resource exists, so nobody pays for a 404.
 */
export async function gate(
  req: NextRequest,
  opts: { price: string; endpoint: string; resource: string; description: string },
): Promise<GateResult> {
  const paymentSignature = req.headers.get("payment-signature");

  if (!MOCK && !SELLER_ADDRESS) {
    console.error("x402: SELLER_ADDRESS is not set; refusing paid requests");
    return { ok: false, response: NextResponse.json({ error: "payments not configured" }, { status: 503 }) };
  }

  if (!paymentSignature) {
    return { ok: false, response: challenge402(opts.price, opts.endpoint, opts.description) };
  }

  const amount = atomicPrice(opts.price);

  if (MOCK) {
    const receipt: X402Receipt = { success: true, transaction: "mock", network: arc.caip2, payer: "mock", amount };
    return { ok: true, receipt, paymentResponseHeader: encodeReceipt(receipt) };
  }

  const signatureHash = createHash("sha256").update(paymentSignature).digest("hex");

  // Idempotent retry: this exact signed payment was already settled.
  const previous = await db.query.x402Payments.findFirst({ where: eq(x402Payments.signatureHash, signatureHash) });
  if (previous) {
    if (previous.resource !== opts.resource) {
      return {
        ok: false,
        response: NextResponse.json({ error: "this payment was already used for a different resource" }, { status: 409 }),
      };
    }
    const receipt: X402Receipt = {
      success: true,
      transaction: previous.transaction,
      network: previous.network,
      payer: previous.payer,
      amount: previous.amountUsdc,
      replay: true,
    };
    return { ok: true, receipt, paymentResponseHeader: encodeReceipt(receipt) };
  }

  try {
    let payload: { accepted?: { network?: string } } & Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(paymentSignature, "base64").toString("utf-8"));
    } catch {
      return { ok: false, response: NextResponse.json({ error: "malformed Payment-Signature header" }, { status: 400 }) };
    }
    if (payload.accepted?.network && payload.accepted.network !== arc.caip2) {
      return {
        ok: false,
        response: NextResponse.json({ error: `network ${payload.accepted.network} not accepted; use ${arc.caip2}` }, { status: 400 }),
      };
    }

    const { BatchFacilitatorClient } = await import("@circle-fin/x402-batching/server");
    // The client defaults to the MAINNET Gateway API, which can't see testnet
    // balances; always use the API for the network we charge on.
    const facilitator = new BatchFacilitatorClient({ url: arc.gatewayApiUrl });
    const requirements = buildRequirements(opts.price);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- facilitator takes the decoded x402 payload as-is
    const verified = await facilitator.verify(payload as any, requirements);
    if (!verified.isValid) {
      console.warn("x402: Gateway rejected payment", { resource: opts.resource, reason: verified.invalidReason });
      return {
        ok: false,
        response: NextResponse.json({ error: "payment verification failed", reason: verified.invalidReason }, { status: 402 }),
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    const settled = await facilitator.settle(payload as any, requirements);
    if (!settled.success) {
      console.warn("x402: Gateway settlement failed", { resource: opts.resource, reason: settled.errorReason });
      return {
        ok: false,
        response: NextResponse.json({ error: "payment settlement failed", reason: settled.errorReason }, { status: 402 }),
      };
    }

    const receipt: X402Receipt = {
      success: true,
      transaction: settled.transaction,
      network: settled.network || requirements.network,
      payer: settled.payer ?? verified.payer ?? "unknown",
      amount,
    };

    // Record it (also the idempotency key). A concurrent duplicate loses the race
    // harmlessly: its row is skipped and it still gets its own receipt.
    await db
      .insert(x402Payments)
      .values({
        signatureHash,
        resource: opts.resource,
        payer: receipt.payer,
        amountUsdc: amount,
        network: receipt.network,
        transaction: receipt.transaction,
      })
      .onConflictDoNothing()
      .catch((err) => console.error("x402: could not record payment", err));

    return { ok: true, receipt, paymentResponseHeader: encodeReceipt(receipt) };
  } catch (err) {
    console.error("x402: payment processing error", err);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "payment processing error", message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      ),
    };
  }
}
