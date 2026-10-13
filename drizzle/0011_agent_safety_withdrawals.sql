-- D2: bids.suggested_reply holds the creator agent's AI draft until the creator approves it.
-- D4: one 24-hour allowance for money leaving a wallet: withdrawals (sends and agent
-- top-ups; hand-placed bids are read from bids, made idempotent by bids.request_key),
-- confirmed send addresses and emailed security codes. New tables get Row Level
-- Security like every other table (0009). Safe to re-run.
CREATE TABLE IF NOT EXISTS "withdrawal_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdrawal_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'send' NOT NULL,
	"request_key" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"circle_tx_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "request_key" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "suggested_reply" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdrawal_addresses" ADD CONSTRAINT "withdrawal_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdrawal_codes" ADD CONSTRAINT "withdrawal_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawal_addresses_user_address_uq" ON "withdrawal_addresses" USING btree ("user_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "withdrawal_codes_user_subject_uq" ON "withdrawal_codes" USING btree ("user_id","subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_user_created_idx" ON "withdrawals" USING btree ("user_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bids" ADD CONSTRAINT "bids_request_key_unique" UNIQUE("request_key");
EXCEPTION
 WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "withdrawals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "withdrawal_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "withdrawal_codes" ENABLE ROW LEVEL SECURITY;
