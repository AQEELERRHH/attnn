ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "reply_source" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "reply_rating" integer;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "reply_rated_at" timestamp with time zone;
