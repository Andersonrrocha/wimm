-- CreateTable
CREATE TABLE "CsvSourceMapping" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL,
    "hasHeader" BOOLEAN NOT NULL,
    "encoding" TEXT NOT NULL,
    "dateColumn" INTEGER NOT NULL,
    "descriptionColumn" INTEGER NOT NULL,
    "decimalSeparator" TEXT NOT NULL,
    "dateOrder" TEXT NOT NULL,
    "signConfig" TEXT NOT NULL,
    "columnCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsvSourceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CsvSourceMapping_sourceId_key" ON "CsvSourceMapping"("sourceId");

-- AddForeignKey
ALTER TABLE "CsvSourceMapping" ADD CONSTRAINT "CsvSourceMapping_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint: delimiter/encoding/decimalSeparator/dateOrder are the
-- enum-shaped scalar fields of a GenericCsvMapping (Task 3,
-- apps/api/src/imports/parsers/generic-csv-mapper.ts). Following the Phase 0
-- convention (see 20260729120000_enums_to_text), every former-enum column is
-- TEXT with a CHECK, declared in apps/api/src/prisma/check-constraints.ts and
-- verified live by `pnpm --filter @wimm/api run assert:constraints`.
-- `signConfig` deliberately has none: it is the sign-convention discriminated
-- union, stored as one opaque JSON blob rather than decomposed into
-- per-variant nullable columns, so an invalid combination stays
-- unrepresentable at this layer too (see the model doc comment in
-- schema.prisma).
ALTER TABLE "CsvSourceMapping" ADD CONSTRAINT "CsvSourceMapping_delimiter_check"
  CHECK ("delimiter" IN (',', ';'));

ALTER TABLE "CsvSourceMapping" ADD CONSTRAINT "CsvSourceMapping_encoding_check"
  CHECK ("encoding" IN ('utf8', 'latin1'));

ALTER TABLE "CsvSourceMapping" ADD CONSTRAINT "CsvSourceMapping_decimalSeparator_check"
  CHECK ("decimalSeparator" IN ('.', ','));

ALTER TABLE "CsvSourceMapping" ADD CONSTRAINT "CsvSourceMapping_dateOrder_check"
  CHECK ("dateOrder" IN ('DMY', 'MDY', 'YMD'));
