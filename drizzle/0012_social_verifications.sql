-- Creator social verification: a creator proves they control an X or LinkedIn account
-- before their market goes live (lib/social-verify.ts). Only the public account id,
-- handle and name are stored, never a token. One row per user + provider; one provider
-- account can verify only one user. Row Level Security like every other table (0009).
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS "social_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"handle" text,
	"display_name" text,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "social_verifications" ADD CONSTRAINT "social_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_verifications_user_provider_uq" ON "social_verifications" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_verifications_provider_account_uq" ON "social_verifications" USING btree ("provider","provider_account_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "social_verifications" ADD CONSTRAINT "social_verifications_provider_check" CHECK ("provider" IN ('x', 'linkedin'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "social_verifications" ENABLE ROW LEVEL SECURITY;
