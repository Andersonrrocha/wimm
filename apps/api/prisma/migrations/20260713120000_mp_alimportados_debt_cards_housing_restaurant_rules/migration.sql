-- mp alimportados: generic marketplace (not games) for DBs that already ran the earlier games batch
UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'shopping_other', "updatedAt" = CURRENT_TIMESTAMP
WHERE LOWER(TRIM("pattern")) = 'mp alimportados';

-- Cartões under Débitos
INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Credit cards' ELSE 'Cartões' END,
  'EXPENSE',
  'debt_cards',
  d.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" d
JOIN "User" u ON u.id = d."userId"
WHERE d."categoryKey" = 'debts' AND d."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = d."userId" AND x."categoryKey" = 'debt_cards'
  );

-- Housing + restaurants (system rules; CONTAINS on lowercase description)
INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'platano imoveis', 'housing', 'EXPENSE', 2700, 'HOUSING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'platano imóveis', 'housing', 'EXPENSE', 2701, 'HOUSING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'platanoimoveis', 'housing', 'EXPENSE', 2702, 'HOUSING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'dona barbara', 'housing', 'EXPENSE', 2710, 'HOUSING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'pizza', 'restaurants', 'EXPENSE', 2160, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'pizzaria', 'restaurants', 'EXPENSE', 2161, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'burguer', 'restaurants', 'EXPENSE', 2162, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'burger', 'restaurants', 'EXPENSE', 2163, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mcdonalds', 'restaurants', 'EXPENSE', 2164, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'subway', 'restaurants', 'EXPENSE', 2165, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sushi', 'restaurants', 'EXPENSE', 2166, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'restaurante', 'restaurants', 'EXPENSE', 2167, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lanchonete', 'restaurants', 'EXPENSE', 2168, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lancheria', 'restaurants', 'EXPENSE', 2169, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lanche', 'restaurants', 'EXPENSE', 2170, 'FOOD_RESTAURANTS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
