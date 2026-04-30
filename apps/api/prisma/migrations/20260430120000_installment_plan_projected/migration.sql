-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "originatingBatchId" TEXT,
    "installmentTotal" INTEGER NOT NULL,
    "amountEach" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "installmentPlanId" TEXT,
ADD COLUMN "isProjected" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_originatingBatchId_fkey" FOREIGN KEY ("originatingBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "InstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "InstallmentPlan_userId_idx" ON "InstallmentPlan"("userId");

CREATE INDEX "InstallmentPlan_sourceId_idx" ON "InstallmentPlan"("sourceId");

CREATE INDEX "Transaction_installmentPlanId_idx" ON "Transaction"("installmentPlanId");
