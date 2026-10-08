-- Which own-credential source BYOK categorization uses when more than one is
-- available. Nullable with no default on purpose: NULL is the "not chosen"
-- state, so every existing user lands there, and that only matters for a user
-- who has BOTH an Anthropic key and a connected ChatGPT plan -- with one
-- source, `AiCategorizerSelector` uses it without asking.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "aiByokSource" TEXT;

-- CheckConstraint: `aiByokSource` is an enum-shaped TEXT column, so it follows
-- the Phase 0 convention (see 20260729120000_enums_to_text) -- every such
-- column is TEXT with a CHECK, declared in
-- apps/api/src/prisma/check-constraints.ts and verified live by
-- `pnpm --filter @wimm/api run assert:constraints`. The CHECK must permit
-- NULL, exactly like `User_subscriptionPlan_check`: here NULL is a meaningful
-- state ("not chosen"), not a missing value.
ALTER TABLE "User" ADD CONSTRAINT "User_aiByokSource_check"
  CHECK ("aiByokSource" IS NULL OR "aiByokSource" IN ('ANTHROPIC_KEY', 'CHATGPT_PLAN'));
