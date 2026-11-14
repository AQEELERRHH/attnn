CREATE TABLE IF NOT EXISTS "gas_sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"sponsor_wallet_id" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"circle_tx_id" text,
	"error" text,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gas_sponsorships" ADD CONSTRAINT "gas_sponsorships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gas_sponsorships_user_uq" ON "gas_sponsorships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gas_sponsorships_reserved_idx" ON "gas_sponsorships" USING btree ("reserved_at");--> statement-breakpoint
ALTER TABLE "gas_sponsorships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- As for external_bid_intents (0013): no policies, and Supabase's public API roles get no
-- privileges at all. The app connects as the table owner and is unaffected.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
  REVOKE ALL ON TABLE "gas_sponsorships" FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  REVOKE ALL ON TABLE "gas_sponsorships" FROM authenticated;
 END IF;
END $$;
