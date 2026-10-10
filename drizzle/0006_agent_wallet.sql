ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_user_purpose_uq" ON "wallets" USING btree ("user_id","purpose");
