-- Private messages and replies (escrow v2): only keccak256(salt || text) goes on-chain;
-- the text and its salt stay here. reply_candidates keeps every reply + salt an accept
-- was reserved with until the bid settles. All nullable: existing rows are untouched.
-- Safe to re-run.
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "message_salt" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "reply_salt" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "reply_candidates" jsonb;
