// x402 integration for Circle Gateway payments
// Note: @circle-fin/x402-batching exports supportsBatching, isBatchPayment, and
// getVerifyingContract — it does NOT export an X402 client class.
// This file stubs the x402 integration functions.
// TODO: Replace stubs with actual @circle-fin/x402-batching usage when the
// client-side API is available.

import { Hex } from "viem";

export interface X402PaymentRequest {
  payer: string; // Wallet address
  amount: string; // "0.001" USDC
  memo?: string;
  metadata?: Record<string, unknown>;
}

export interface X402PaymentResponse {
  paymentId: string;
  challenge: string; // Base64 encoded challenge for user to sign
  expiresAt: Date;
}

// Stub: create a payment request via Circle API
export async function createPaymentRequest(
  params: X402PaymentRequest
): Promise<X402PaymentResponse> {
  // TODO: Implement using Circle Developer Controlled Wallets API or Gateway API
  // For now, return a simulated response
  console.warn("x402 createPaymentRequest is a stub — implement with Circle Gateway API");
  return {
    paymentId: crypto.randomUUID(),
    challenge: Buffer.from(JSON.stringify({ payer: params.payer, amount: params.amount })).toString("base64"),
    expiresAt: new Date(Date.now() + 3600_000),
  };
}

// Stub: verify a payment
export async function verifyPayment(
  _paymentId: string,
  _signature: Hex
): Promise<boolean> {
  // TODO: Implement using @circle-fin/x402-batching or Circle Gateway API
  console.warn("x402 verifyPayment is a stub — implement with Circle Gateway API");
  return false;
}

// Stub: check payment status
export async function checkPaymentStatus(_paymentId: string): Promise<{
  status: "pending" | "paid" | "expired" | "failed";
  paidAt?: Date;
}> {
  // TODO: Implement using Circle Gateway API
  console.warn("x402 checkPaymentStatus is a stub — implement with Circle Gateway API");
  return { status: "pending" };
}

// Helper for the Attnn use case: $0.001 USDC gate
export async function createProfileAccessPayment(payerAddress: string, handle: string) {
  return createPaymentRequest({
    payer: payerAddress,
    amount: "0.001",
    memo: `Access to @${handle} profile`,
    metadata: { handle, type: "profile_access" },
  });
}
