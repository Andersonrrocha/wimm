-- New enums backing chart-date preference and paywall scaffolding.
-- Defaults are chosen so the rollout is a no-op for existing users:
--   chartDateMode = BILLING_CYCLE preserves today's hardcoded report behaviour
--   subscriptionStatus = ACTIVE keeps everyone unblocked until the paywall lands

CREATE TYPE "ChartDateMode" AS ENUM ('BILLING_CYCLE', 'PURCHASE_DATE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'EXPIRED', 'CANCELED');
CREATE TYPE "SubscriptionPlan" AS ENUM ('MONTHLY', 'ANNUAL', 'LIFETIME');

ALTER TABLE "User"
  ADD COLUMN "chartDateMode" "ChartDateMode" NOT NULL DEFAULT 'BILLING_CYCLE',
  ADD COLUMN "onboardedAt" TIMESTAMP(3),
  ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "subscriptionPlan" "SubscriptionPlan",
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "founderNumber" INTEGER;

CREATE UNIQUE INDEX "User_founderNumber_key" ON "User"("founderNumber");

-- Backfill existing users to "onboarded" so they don't see the welcome flow
-- mid-session. Anderson and any current friends were already past that step
-- conceptually.
UPDATE "User" SET "onboardedAt" = NOW() WHERE "onboardedAt" IS NULL;

-- Anderson is Founder #1 by definition (first WIMM user). Picks the oldest
-- account so the migration is deterministic regardless of seed order.
UPDATE "User"
  SET "founderNumber" = 1, "subscriptionPlan" = 'LIFETIME'
  WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);
