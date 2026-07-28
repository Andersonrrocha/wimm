-- Expand step: add integer-cent columns and backfill from the Decimal source.
-- Decimal(14,2) * 100 is exact in PostgreSQL numeric arithmetic, so ROUND is
-- defensive rather than lossy.

ALTER TABLE "Transaction" ADD COLUMN "amountCents" INTEGER;
UPDATE "Transaction" SET "amountCents" = ROUND("amount" * 100)::INTEGER;

ALTER TABLE "Recurrence" ADD COLUMN "amountCents" INTEGER;
UPDATE "Recurrence" SET "amountCents" = ROUND("amount" * 100)::INTEGER;

ALTER TABLE "InstallmentPlan" ADD COLUMN "amountEachCents" INTEGER;
UPDATE "InstallmentPlan" SET "amountEachCents" = ROUND("amountEach" * 100)::INTEGER;
