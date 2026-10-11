/**
 * A fresh database for each test file: drops the public schema and applies every
 * migration in drizzle/ in order, exactly as production gets them.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

export async function resetDatabase(): Promise<void> {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("drop schema if exists public cascade; create schema public;");
    const dir = path.resolve("drizzle");
    const files = readdirSync(dir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort();
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), "utf8");
      for (const statement of text.split("--> statement-breakpoint")) {
        if (statement.trim()) await sql.unsafe(statement);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Ids for seeded rows, so tests read clearly. */
export const ids = {
  bidder: "00000000-0000-0000-0000-00000000000b",
  creator: "00000000-0000-0000-0000-00000000000c",
  other: "00000000-0000-0000-0000-00000000000d",
};
export const addr = {
  bidderMain: "0xb100000000000000000000000000000000000001",
  bidderAgent: "0xb200000000000000000000000000000000000002",
  creatorMain: "0xc100000000000000000000000000000000000001",
};

/** Empties the app tables between tests (keeps the schema). */
export async function truncateAll(): Promise<void> {
  const { db } = await import("../../lib/db/client.ts");
  const { sql } = await import("drizzle-orm");
  await db.execute(
    sql.raw("truncate table bids, profiles, bidder_configs, wallets, app_settings, rate_limits, agent_logs, sessions, accounts, users cascade"),
  );
}

/** Closes the app's connection pool so the test process can exit. */
export async function closeDb(): Promise<void> {
  const conn = (globalThis as unknown as { conn?: { end: (o: object) => Promise<void> } }).conn;
  await conn?.end({ timeout: 5 });
}
