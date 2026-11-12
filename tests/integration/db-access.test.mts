/**
 * Database access for Supabase's public API roles (anon, authenticated), the way a Supabase
 * project is set up: those roles get every privilege on new tables in "public" by default,
 * and the REST API runs queries as them for anyone holding the public anon key.
 *
 * Builds the schema from the real migrations with those default grants in place, then
 * proves, as each role:
 *   - external_bid_intents (private bid messages, migration 0013): no privileges at all;
 *   - gas_sponsorships (who Attnn. paid a network fee for, migration 0014): the same;
 *   - bids (now with bids from outside agents): RLS returns no rows and refuses writes;
 *   - the table owner (how the app connects) still reads and writes both.
 */
import "../helpers/env.mts";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { resetDatabase } from "../helpers/db.mts";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
const ROLES = ["anon", "authenticated"] as const;

async function buildLikeSupabase() {
  for (const role of ROLES) {
    await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$;`);
  }
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  await sql.unsafe("grant usage on schema public to anon, authenticated;");
  // Supabase's defaults: every new table in public is fully granted to the API roles.
  await sql.unsafe("alter default privileges in schema public grant all on tables to anon, authenticated;");
  const dir = path.resolve("drizzle");
  for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    for (const statement of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await sql.unsafe(statement);
    }
  }
}

/** Runs `query` as `role` inside a transaction that is always rolled back. */
async function as(role: string, query: string): Promise<{ rows: number } | { error: string }> {
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      const rows = await tx.unsafe(query);
      throw Object.assign(new Error("rollback"), { result: { rows: rows.length } });
    });
  } catch (err) {
    const e = err as Error & { result?: { rows: number } };
    if (e.result) return e.result;
    return { error: e.message };
  }
}

describe("database access for Supabase's public API roles", () => {
  before(async () => {
    await buildLikeSupabase();
    // Data as the app writes it (the table owner).
    await sql.unsafe(`
      insert into users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'creator@test');
      insert into external_bid_intents (bidder_address, creator_user_id, creator_address, amount_usdc, message, message_salt, message_hash, escrow_address)
        values ('0xa9e0000000000000000000000000000000000a9e', '00000000-0000-0000-0000-00000000000c', '0xc1', '5000000', 'private message', '0x01', '0x02', '0xe5');
      insert into bids (bidder_user_id, creator_user_id, bidder_address, creator_address, amount_usdc, message, status)
        values (null, '00000000-0000-0000-0000-00000000000c', '0xa9e0000000000000000000000000000000000a9e', '0xc1', '5000000', 'private message', 'pending');
    `);
  });
  after(async () => {
    await sql.end({ timeout: 5 });
    await resetDatabase(); // leave the usual schema for the next test file
  });

  for (const role of ROLES) {
    test(`${role}: no privileges at all on external_bid_intents`, async () => {
      const read = await as(role, "select * from external_bid_intents");
      assert.ok("error" in read && /permission denied/.test(read.error), JSON.stringify(read));
      const write = await as(role, "insert into external_bid_intents (bidder_address, creator_user_id, creator_address, amount_usdc, message_salt, message_hash, escrow_address) values ('0x1', '00000000-0000-0000-0000-00000000000c', '0x2', '1', '0x3', '0x4', '0x5')");
      assert.ok("error" in write && /permission denied/.test(write.error), JSON.stringify(write));
      const wipe = await as(role, "delete from external_bid_intents returning id");
      assert.ok("error" in wipe && /permission denied/.test(wipe.error), JSON.stringify(wipe));
    });

    test(`${role}: no privileges at all on gas_sponsorships`, async () => {
      const read = await as(role, "select * from gas_sponsorships");
      assert.ok("error" in read && /permission denied/.test(read.error), JSON.stringify(read));
      const write = await as(role, "insert into gas_sponsorships (user_id, wallet_address, sponsor_wallet_id, amount_usdc, status) values ('00000000-0000-0000-0000-00000000000c', '0x1', 'w', '1', 'failed')");
      assert.ok("error" in write && /permission denied/.test(write.error), JSON.stringify(write));
      const wipe = await as(role, "delete from gas_sponsorships returning id");
      assert.ok("error" in wipe && /permission denied/.test(wipe.error), JSON.stringify(wipe));
    });

    test(`${role}: bids (including outside agents' bids) are invisible and read-only through RLS`, async () => {
      const read = await as(role, "select * from bids");
      assert.deepEqual(read, { rows: 0 }, "RLS with no policies: no rows");
      const write = await as(role, "insert into bids (creator_user_id, bidder_address, creator_address, amount_usdc) values ('00000000-0000-0000-0000-00000000000c', '0x1', '0x2', '1')");
      assert.ok("error" in write && /row-level security/.test(write.error), JSON.stringify(write));
      const change = await as(role, "update bids set status = 'refunded' returning id");
      assert.deepEqual(change, { rows: 0 }, "no row can be changed");
    });
  }

  test("the table owner (how the app connects) is unaffected", async () => {
    const [intents] = await sql.unsafe("select count(*)::int as n from external_bid_intents");
    const [external] = await sql.unsafe("select count(*)::int as n from bids where bidder_user_id is null");
    assert.equal(intents!.n, 1);
    assert.equal(external!.n, 1);
  });

  test("RLS is on for every table, the new one included", async () => {
    const off = await sql.unsafe("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and relname not like '\\_\\_%'");
    assert.deepEqual(off.map((r) => r.relname), []);
  });
});
