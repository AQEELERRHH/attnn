CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bidder_configs" ADD COLUMN IF NOT EXISTS "run_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "settlement_submitted_at" timestamp with time zone;