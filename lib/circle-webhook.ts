import crypto, { type KeyObject } from "crypto";

// Circle v2 notifications are signed with ECDSA_SHA_256. The signature arrives in the
// X-Circle-Signature header (base64 DER) and the id of the signing key in X-Circle-Key-Id.
// W3S serves both testnet and mainnet keys from api.circle.com. CIRCLE_API_BASE_URL is an
// optional override (the SDK client in lib/circle.ts defaults to the same host).
const DEFAULT_API_BASE_URL = "https://api.circle.com";
const EXPECTED_ALGORITHM = "ECDSA_SHA_256";

function publicKeyEndpoint(keyId: string): string {
  const baseUrl = (process.env.CIRCLE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  return `${baseUrl}/v2/notifications/publicKey/${encodeURIComponent(keyId)}`;
}

// A public key is static for its key id, so keys are cached for the lifetime of the process.
const publicKeyCache = new Map<string, KeyObject>();

interface PublicKeyResponse {
  data?: {
    id?: string;
    algorithm?: string;
    publicKey?: string;
    createDate?: string;
  };
}

async function getPublicKey(keyId: string): Promise<KeyObject | null> {
  const cached = publicKeyCache.get(keyId);
  if (cached) return cached;

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("Circle webhook: CIRCLE_API_KEY is not configured, cannot fetch public key");
    return null;
  }

  let body: PublicKeyResponse;
  try {
    const res = await fetch(publicKeyEndpoint(keyId), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.error(`Circle webhook: public key request for ${keyId} failed with status ${res.status}`);
      return null;
    }
    body = (await res.json()) as PublicKeyResponse;
  } catch (err) {
    console.error(`Circle webhook: public key request for ${keyId} errored`, err);
    return null;
  }

  const encodedKey = body.data?.publicKey;
  if (!encodedKey) {
    console.error(`Circle webhook: public key response for ${keyId} contained no key`);
    return null;
  }

  // Warn but continue: a relabelled algorithm shouldn't silently stop bid syncing. The
  // verification below fails on its own if the key genuinely can't check the signature.
  const algorithm = body.data?.algorithm;
  if (algorithm && algorithm !== EXPECTED_ALGORITHM) {
    console.warn(`Circle webhook: key ${keyId} reports algorithm ${algorithm}, expected ${EXPECTED_ALGORITHM}`);
  }

  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(encodedKey, "base64"),
      format: "der",
      type: "spki",
    });
    publicKeyCache.set(keyId, key);
    return key;
  } catch (err) {
    console.error(`Circle webhook: could not import public key ${keyId}`, err);
    return null;
  }
}

/**
 * Verify a Circle notification signature against the raw request body.
 * Never throws: any missing header, fetch failure or bad signature returns false.
 */
export async function verifyCircleSignature(
  rawBody: string,
  signature: string | null,
  keyId: string | null,
): Promise<boolean> {
  if (!signature || !keyId) {
    console.error("Circle webhook: missing X-Circle-Signature or X-Circle-Key-Id header");
    return false;
  }

  const publicKey = await getPublicKey(keyId);
  if (!publicKey) return false;

  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(rawBody, "utf8");
    verifier.end();

    const verified = verifier.verify(publicKey, Buffer.from(signature, "base64"));
    if (!verified) {
      console.error(`Circle webhook: signature did not verify against key ${keyId}`);
    }
    return verified;
  } catch (err) {
    console.error(`Circle webhook: signature verification errored for key ${keyId}`, err);
    return false;
  }
}
