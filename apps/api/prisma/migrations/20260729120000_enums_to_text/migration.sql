-- Enum columns become TEXT so the same schema targets PostgreSQL and SQLite.
-- CHECK constraints preserve the database-level guarantee the enum type provided.
-- Defaults must be dropped before the type change: they carry the old enum type.

ALTER TABLE "User" ALTER COLUMN "chartDateMode" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "chartDateMode" TYPE TEXT USING "chartDateMode"::TEXT;
ALTER TABLE "User" ALTER COLUMN "chartDateMode" SET DEFAULT 'BILLING_CYCLE';
ALTER TABLE "User" ADD CONSTRAINT "User_chartDateMode_check"
  CHECK ("chartDateMode" IN ('BILLING_CYCLE', 'PURCHASE_DATE'));

ALTER TABLE "User" ALTER COLUMN "subscriptionStatus" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "subscriptionStatus" TYPE TEXT USING "subscriptionStatus"::TEXT;
ALTER TABLE "User" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD CONSTRAINT "User_subscriptionStatus_check"
  CHECK ("subscriptionStatus" IN ('ACTIVE', 'TRIALING', 'EXPIRED', 'CANCELED'));

ALTER TABLE "User" ALTER COLUMN "subscriptionPlan" TYPE TEXT USING "subscriptionPlan"::TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_subscriptionPlan_check"
  CHECK ("subscriptionPlan" IS NULL OR "subscriptionPlan" IN ('MONTHLY', 'ANNUAL', 'LIFETIME'));

ALTER TABLE "User" ALTER COLUMN "aiCategorizationMode" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "aiCategorizationMode" TYPE TEXT USING "aiCategorizationMode"::TEXT;
ALTER TABLE "User" ALTER COLUMN "aiCategorizationMode" SET DEFAULT 'OFF';
ALTER TABLE "User" ADD CONSTRAINT "User_aiCategorizationMode_check"
  CHECK ("aiCategorizationMode" IN ('OFF', 'SERVER', 'BYOK'));

ALTER TABLE "Source" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Source" ADD CONSTRAINT "Source_type_check"
  CHECK ("type" IN ('BANK_ACCOUNT', 'CREDIT_CARD', 'CASH', 'MANUAL'));

ALTER TABLE "Category" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Category" ADD CONSTRAINT "Category_type_check"
  CHECK ("type" IN ('INCOME', 'EXPENSE'));

ALTER TABLE "SystemCategorizationRule" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;
ALTER TABLE "SystemCategorizationRule" ADD CONSTRAINT "SystemCategorizationRule_kind_check"
  CHECK ("kind" IN ('INCOME', 'EXPENSE'));

ALTER TABLE "CategorizationRule" ALTER COLUMN "matchType" TYPE TEXT USING "matchType"::TEXT;
ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_matchType_check"
  CHECK ("matchType" IN ('CONTAINS', 'EQUALS'));

ALTER TABLE "ImportBatch" ALTER COLUMN "format" TYPE TEXT USING "format"::TEXT;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_format_check"
  CHECK ("format" IN ('CSV', 'OFX', 'PDF_BANRISUL_CC', 'PDF_CRESOL_STATEMENT'));

ALTER TABLE "ImportBatch" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ImportBatch" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "ImportBatch" ALTER COLUMN "status" SET DEFAULT 'COMPLETED';
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_status_check"
  CHECK ("status" IN ('COMPLETED'));

ALTER TABLE "Recurrence" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_kind_check"
  CHECK ("kind" IN ('INCOME', 'EXPENSE'));

ALTER TABLE "Recurrence" ALTER COLUMN "frequency" TYPE TEXT USING "frequency"::TEXT;
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_frequency_check"
  CHECK ("frequency" IN ('WEEKLY', 'MONTHLY', 'YEARLY'));

ALTER TABLE "Recurrence" ALTER COLUMN "endMode" TYPE TEXT USING "endMode"::TEXT;
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_endMode_check"
  CHECK ("endMode" IN ('INDEFINITE', 'UNTIL_DATE'));

ALTER TABLE "Transaction" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_kind_check"
  CHECK ("kind" IN ('INCOME', 'EXPENSE'));

DROP TYPE "ChartDateMode";
DROP TYPE "SubscriptionStatus";
DROP TYPE "SubscriptionPlan";
DROP TYPE "AiCategorizationMode";
DROP TYPE "SourceType";
DROP TYPE "CategoryType";
DROP TYPE "TransactionKind";
DROP TYPE "RecurrenceFrequency";
DROP TYPE "RecurrenceEndMode";
DROP TYPE "CategorizationMatchType";
DROP TYPE "ImportBatchFormat";
DROP TYPE "ImportBatchStatus";
