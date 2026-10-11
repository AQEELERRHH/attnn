-- Salts for the on-chain fingerprints of bid messages and replies (v2 escrow: only
-- keccak256(salt || text) goes on-chain; the text and salt stay here). Nullable, so
-- existing rows are untouched. Safe to re-run.
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "message_salt" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "reply_salt" text;
