-- Attnn migration 0003: x402 payment records.
-- Additive only (one new table + index). Safe to run more than once.
-- Can be pasted into the Supabase SQL Editor as-is.
CREATE TABLE IF NOT EXISTS "x402_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_hash" text NOT NULL,
	"resource" text NOT NULL,
	"payer" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"network" text NOT NULL,
	"transaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_payments_signature_hash_unique" UNIQUE("signature_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x402_payments_resource_idx" ON "x402_payments" USING btree ("resource","created_at");