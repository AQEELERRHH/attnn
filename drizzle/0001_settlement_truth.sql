ALTER TYPE "public"."bid_status" ADD VALUE 'placing';--> statement-breakpoint
ALTER TYPE "public"."bid_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "min_bid" SET DEFAULT '5000000';--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "escrow_address" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "settlement_action" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "settlement_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "fail_reason" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bids_escrow_onchain_id_uq" ON "bids" USING btree ("escrow_address","on_chain_bid_id") WHERE "bids"."escrow_address" IS NOT NULL AND "bids"."on_chain_bid_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_status_idx" ON "bids" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_bidder_created_idx" ON "bids" USING btree ("bidder_user_id","created_at");--> statement-breakpoint
-- Data fix: AttnnEscrow rejects bids below MIN_BID ($5 = 5000000 atomic USDC).
-- Creator floors below that could only produce reverting bids, so raise them.
UPDATE "profiles" SET "min_bid" = '5000000' WHERE CAST("min_bid" AS NUMERIC) < 5000000;
