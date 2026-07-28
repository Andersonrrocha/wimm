-- Contract step: no code reads the Decimal columns after the mapper switch
-- (Task 9) and the dual-write removal (Task 10). Verified against
-- wimm_phase0 (real data, 57 Transaction rows, 0 Recurrence, 0
-- InstallmentPlan): zero NULL amountCents/amountEachCents before this ran.

ALTER TABLE "Transaction" ALTER COLUMN "amountCents" SET NOT NULL;
ALTER TABLE "Transaction" DROP COLUMN "amount";

ALTER TABLE "Recurrence" ALTER COLUMN "amountCents" SET NOT NULL;
ALTER TABLE "Recurrence" DROP COLUMN "amount";

ALTER TABLE "InstallmentPlan" ALTER COLUMN "amountEachCents" SET NOT NULL;
ALTER TABLE "InstallmentPlan" DROP COLUMN "amountEach";
