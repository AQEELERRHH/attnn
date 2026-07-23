import { NextRequest, NextResponse } from "next/server";

const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const ARC_TESTNET_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

const SELLER_ADDRESS = (process.env.SELLER_ADDRESS ?? "") as `0x${string}`;
const MOCK = process.env.X402_MOCK === "1" || !SELLER_ADDRESS;

function toAtomic(price: string) {
  return Math.round(parseFloat(price.replace("$", "")) * 1_000_000).toString();
}

function buildRequirements(price: string) {
  return {
    scheme: "exact" as const,
    network: ARC_TESTNET_NETWORK,
    asset: ARC_TESTNET_USDC,
    amount: toAtomic(price),
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: 345600,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: ARC_TESTNET_GATEWAY_WALLET,
    },
  };
}

function challenge402(price: string, endpoint: string) {
  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: endpoint,
      description: `Attn. profile access (${price} USDC)`,
      mimeType: "application/json",
    },
    accepts: [buildRequirements(price)],
  };
  return new NextResponse(JSON.stringify({ error: "payment required" }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(
        JSON.stringify(paymentRequired),
      ).toString("base64"),
    },
  });
}

export type GateResult =
  | { ok: false; response: NextResponse }
  | { ok: true; payer: string; paymentResponseHeader: string | null };

export async function gate(
  req: NextRequest,
  price: string,
  endpoint: string,
): Promise<GateResult> {
  const paymentSignature = req.headers.get("payment-signature");

  if (!paymentSignature) {
    return { ok: false, response: challenge402(price, endpoint) };
  }

  if (MOCK) {
    return {
      ok: true,
      payer: "mock",
      paymentResponseHeader: Buffer.from(
        JSON.stringify({ success: true, mock: true, network: ARC_TESTNET_NETWORK }),
      ).toString("base64"),
    };
  }

  try {
    const { BatchFacilitatorClient } = await import(
      "@circle-fin/x402-batching/server"
    );
    const facilitator = new BatchFacilitatorClient();
    const requirements = buildRequirements(price);
    const payload = JSON.parse(
      Buffer.from(paymentSignature, "base64").toString("utf-8"),
    );

    const verified = await facilitator.verify(payload, requirements);
    if (!verified.isValid) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "verification failed", reason: verified.invalidReason },
          { status: 402 },
        ),
      };
    }

    const settled = await facilitator.settle(payload, requirements);
    if (!settled.success) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "settlement failed", reason: settled.errorReason },
          { status: 402 },
        ),
      };
    }

    const payer = settled.payer ?? verified.payer ?? "unknown";
    const paymentResponseHeader = Buffer.from(
      JSON.stringify({
        success: true,
        transaction: settled.transaction,
        network: requirements.network,
        payer,
      }),
    ).toString("base64");

    return { ok: true, payer, paymentResponseHeader };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "payment processing error", message },
        { status: 500 },
      ),
    };
  }
}
