-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "billingCycleMonth" INTEGER,
ADD COLUMN "billingCycleYear" INTEGER,
ADD COLUMN "expectedDueDate" TIMESTAMP(3);
