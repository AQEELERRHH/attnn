-- External bid API (lib/external-bids.ts): an outside agent bids from its OWN wallet.
--   - bids.bidder_user_id becomes optional: an outside agent has no Attnn. account, so
--     its escrowed bid has no bidder user; bidder_address is its wallet.
--   - external_bid_intents keeps the private message, its salt and the fingerprint the
--     agent was told to send, until the bid is verified escrowed on Arc.
-- Row Level Security like every other table (0009). Safe to re-run.
CREATE TABLE IF NOT EXISTS "external_bid_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bidder_address" text NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"creator_address" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"message" text,
	"message_salt" text NOT NULL,
	"message_hash" text NOT NULL,
	"escrow_address" text NOT NULL,
	"request_key" text,
	"bid_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_bid_intents_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "external_bid_intents_bid_id_unique" UNIQUE("bid_id")
);
--> statement-breakpoint
ALTER TABLE "bids" ALTER COLUMN "bidder_user_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_bid_intents" ADD CONSTRAINT "external_bid_intents_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_bid_intents" ADD CONSTRAINT "external_bid_intents_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_bid_intents_bidder_idx" ON "external_bid_intents" USING btree ("bidder_address","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_bid_intents_hash_idx" ON "external_bid_intents" USING btree ("message_hash");
--> statement-breakpoint
ALTER TABLE "external_bid_intents" ENABLE ROW LEVEL SECURITY;
