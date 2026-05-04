-- AI categorization is opt-in: every existing user lands on OFF until they
-- enable it explicitly in settings. The encrypted API key column is null
-- unless the user pastes one through the BYOK flow.
--
-- Quota / usage counters are intentionally NOT in this migration — they
-- belong to the paywall sprint along with `aiUsageMonth` / `aiUsageCount`.

CREATE TYPE "AiCategorizationMode" AS ENUM ('OFF', 'SERVER', 'BYOK');

ALTER TABLE "User"
  ADD COLUMN "aiCategorizationMode" "AiCategorizationMode" NOT NULL DEFAULT 'OFF',
  ADD COLUMN "aiApiKeyEncrypted" TEXT;
