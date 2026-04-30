ALTER TABLE "Category" ADD COLUMN "parentId" TEXT;

ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Category_userId_parentId_idx" ON "Category"("userId", "parentId");
