ALTER TABLE "Category" ADD COLUMN "categoryKey" TEXT;

CREATE UNIQUE INDEX "Category_userId_categoryKey_key" ON "Category"("userId", "categoryKey");

CREATE TABLE "SystemCategorizationRule" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "priority" INTEGER NOT NULL,
    "ruleGroup" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemCategorizationRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemCategorizationRule_pattern_key" ON "SystemCategorizationRule"("pattern");

CREATE INDEX "SystemCategorizationRule_active_priority_pattern_idx" ON "SystemCategorizationRule"("active", "priority", "pattern");

INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'youtube premium', 'streaming', 'EXPENSE', 100, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'amazon prime', 'streaming', 'EXPENSE', 110, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'prime video', 'streaming', 'EXPENSE', 120, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hbo max', 'streaming', 'EXPENSE', 130, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'disney+', 'streaming', 'EXPENSE', 140, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'apple tv', 'streaming', 'EXPENSE', 150, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'appletv', 'streaming', 'EXPENSE', 160, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'netflix', 'streaming', 'EXPENSE', 200, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'spotify', 'streaming', 'EXPENSE', 210, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'crunchyroll', 'streaming', 'EXPENSE', 220, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hbo', 'streaming', 'EXPENSE', 230, 'SUBSCRIPTIONS_STREAMING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mercadolivre', 'online_shopping', 'EXPENSE', 2000, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mercado livre', 'online_shopping', 'EXPENSE', 2010, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'supermercado', 'market', 'EXPENSE', 2100, 'FOOD_MARKET', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'rissul', 'market', 'EXPENSE', 2110, 'FOOD_MARKET', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'kern', 'market', 'EXPENSE', 2120, 'FOOD_MARKET', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'zaffari', 'market', 'EXPENSE', 2130, 'FOOD_MARKET', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'unidasul', 'market', 'EXPENSE', 2140, 'FOOD_MARKET', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mercado', 'market', 'EXPENSE', 2890, 'FOOD_MARKET', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'panvel', 'health', 'EXPENSE', 3000, 'HEALTH_PHARMACY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sao joao', 'health', 'EXPENSE', 3010, 'HEALTH_PHARMACY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'saojoao', 'health', 'EXPENSE', 3020, 'HEALTH_PHARMACY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'drogaria', 'health', 'EXPENSE', 3030, 'HEALTH_PHARMACY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'farmacia', 'health', 'EXPENSE', 3090, 'HEALTH_PHARMACY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO NOTHING;
