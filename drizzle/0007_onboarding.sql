ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "checklist_dismissed_at" timestamp with time zone;--> statement-breakpoint
-- People who already use Attnn. (a market, an agent or any bid) skip the first-run welcome.
UPDATE "users" u SET "onboarding_seen_at" = now()
WHERE "onboarding_seen_at" IS NULL
  AND (
    EXISTS (SELECT 1 FROM "profiles" p WHERE p."user_id" = u."id")
    OR EXISTS (SELECT 1 FROM "bidder_configs" c WHERE c."user_id" = u."id")
    OR EXISTS (SELECT 1 FROM "bids" b WHERE b."bidder_user_id" = u."id" OR b."creator_user_id" = u."id")
  );
