-- Drop BYOK and the per-user encrypted Anthropic key. AI categorization is
-- now a single server-backed toggle (OFF or ON). Anyone previously on the
-- removed SERVER or BYOK modes collapses to ON; OFF stays OFF. Future
-- gating behind a paywall is independent of this column.

ALTER TABLE "User" DROP COLUMN "aiApiKeyEncrypted";

ALTER TYPE "AiCategorizationMode" RENAME TO "AiCategorizationMode_old";
CREATE TYPE "AiCategorizationMode" AS ENUM ('OFF', 'ON');

ALTER TABLE "User"
  ALTER COLUMN "aiCategorizationMode" DROP DEFAULT,
  ALTER COLUMN "aiCategorizationMode" TYPE "AiCategorizationMode"
    USING (CASE WHEN "aiCategorizationMode"::text = 'OFF' THEN 'OFF' ELSE 'ON' END)::"AiCategorizationMode",
  ALTER COLUMN "aiCategorizationMode" SET DEFAULT 'OFF';

DROP TYPE "AiCategorizationMode_old";
