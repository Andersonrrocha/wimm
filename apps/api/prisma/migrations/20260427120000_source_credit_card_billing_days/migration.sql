-- Billing cycle fields for credit card sources (optional for other source types).
ALTER TABLE "Source" ADD COLUMN "closingDay" INTEGER,
ADD COLUMN "dueDay" INTEGER;
