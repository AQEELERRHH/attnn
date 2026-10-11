/**
 * Test environment. Imported FIRST by every integration test, before any app module,
 * because lib/db/client.ts and lib/chain.ts read the environment when imported.
 *
 * Safety: integration tests drop and recreate the database schema. They only run
 * against TEST_DATABASE_URL, and refuse any host that isn't local or the CI service
 * container, so they can never touch the shared Supabase database.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL is not set. Integration tests need a throwaway local Postgres (see tests/README.md).");
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "postgres", "::1"].includes(host)) {
  throw new Error(`Refusing to run integration tests against ${host}: TEST_DATABASE_URL must be a local or CI database.`);
}

process.env.DATABASE_URL = url;
process.env.ARC_NETWORK = "testnet";
process.env.ARC_RPC_URL = "http://127.0.0.1:9"; // never reached: the chain is faked
process.env.ATTN_ESCROW_CONTRACT = "0xe5c0000000000000000000000000000000000001";
process.env.ATTN_REGISTRY_CONTRACT = "0x7e60000000000000000000000000000000000002";
process.env.ATTN_LEGACY_ESCROW_CONTRACTS = "none";
process.env.CIRCLE_API_KEY = "TEST_API_KEY:test:test";
process.env.CIRCLE_ENTITY_SECRET = "test";
process.env.AISA_API_URL = "http://127.0.0.1:9"; // AI unavailable → rule-based fallbacks
process.env.AISA_API_KEY = "test";
process.env.INNGEST_EVENT_KEY = "test";
// NODE_ENV is left alone: lib/db/client.ts then caches one connection pool per process.

export const ESCROW = process.env.ATTN_ESCROW_CONTRACT.toLowerCase();
