-- Attnn migration 0002: counter re-bids.
-- Additive only (one nullable column, a foreign key and an index). Safe to run
-- more than once. Can be pasted into the Supabase SQL Editor as-is.
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "replaces_bid_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bids" ADD CONSTRAINT "bids_replaces_bid_id_bids_id_fk" FOREIGN KEY ("replaces_bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bids_replaces_bid_id_uq" ON "bids" USING btree ("replaces_bid_id") WHERE "bids"."replaces_bid_id" IS NOT NULL;