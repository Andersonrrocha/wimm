-- Rename health leaf medical → self_care; add transport maintenance; add debts tree;
-- split online_shopping into sub-leaves; retarget transactions/rules and system rules.

-- 1) Health leaf: medical → self_care. If both keys exist (app ran before migration), merge into self_care.
UPDATE "Transaction" t
SET
  "categoryId" = sc.id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Category" med
JOIN "Category" sc ON sc."userId" = med."userId" AND sc."categoryKey" = 'self_care'
WHERE t."categoryId" = med.id AND med."categoryKey" = 'medical';

UPDATE "Recurrence" r
SET
  "categoryId" = sc.id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Category" med
JOIN "Category" sc ON sc."userId" = med."userId" AND sc."categoryKey" = 'self_care'
WHERE r."categoryId" = med.id AND med."categoryKey" = 'medical';

UPDATE "CategorizationRule" cr
SET
  "categoryId" = sc.id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Category" med
JOIN "Category" sc ON sc."userId" = med."userId" AND sc."categoryKey" = 'self_care'
WHERE cr."categoryId" = med.id AND med."categoryKey" = 'medical';

DELETE FROM "Category" med
USING "Category" sc
WHERE med."categoryKey" = 'medical'
  AND sc."userId" = med."userId"
  AND sc."categoryKey" = 'self_care';

UPDATE "Category" c
SET
  "categoryKey" = 'self_care',
  name = CASE
    WHEN u."preferredLocale" = 'en' THEN 'Self-care'
    ELSE 'Auto cuidado'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "User" u
WHERE c."userId" = u.id AND c."categoryKey" = 'medical';

-- 2) Maintenance under transport
INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Maintenance' ELSE 'Manutenção' END,
  'EXPENSE',
  'maintenance',
  t.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" t
JOIN "User" u ON u.id = t."userId"
WHERE t."categoryKey" = 'transport'
  AND t."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = t."userId" AND x."categoryKey" = 'maintenance'
  );

-- 3) Debts parent + children
INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u.id,
  CASE WHEN u."preferredLocale" = 'en' THEN 'Debts' ELSE 'Débitos' END,
  'EXPENSE',
  'debts',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u.id AND c."categoryKey" = 'debts'
);

INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Loans' ELSE 'Empréstimos' END,
  'EXPENSE',
  'debt_loans',
  d.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" d
JOIN "User" u ON u.id = d."userId"
WHERE d."categoryKey" = 'debts' AND d."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = d."userId" AND x."categoryKey" = 'debt_loans'
  );

INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Car' ELSE 'Carro' END,
  'EXPENSE',
  'debt_car',
  d.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" d
JOIN "User" u ON u.id = d."userId"
WHERE d."categoryKey" = 'debts' AND d."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = d."userId" AND x."categoryKey" = 'debt_car'
  );

INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Motorcycle' ELSE 'Moto' END,
  'EXPENSE',
  'debt_motorcycle',
  d.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" d
JOIN "User" u ON u.id = d."userId"
WHERE d."categoryKey" = 'debts' AND d."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = d."userId" AND x."categoryKey" = 'debt_motorcycle'
  );

-- 4) Online shopping: add sub-leaves and move assignments off the parent row
INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  os."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Apparel' ELSE 'Vestuário' END,
  'EXPENSE',
  'shopping_clothing',
  os.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" os
JOIN "User" u ON u.id = os."userId"
WHERE os."categoryKey" = 'online_shopping' AND os."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = os."userId" AND x."categoryKey" = 'shopping_clothing'
  );

INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  os."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Games' ELSE 'Jogos' END,
  'EXPENSE',
  'shopping_games',
  os.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" os
JOIN "User" u ON u.id = os."userId"
WHERE os."categoryKey" = 'online_shopping' AND os."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = os."userId" AND x."categoryKey" = 'shopping_games'
  );

INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  os."userId",
  CASE WHEN u."preferredLocale" = 'en' THEN 'Home' ELSE 'Casa' END,
  'EXPENSE',
  'shopping_home',
  os.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" os
JOIN "User" u ON u.id = os."userId"
WHERE os."categoryKey" = 'online_shopping' AND os."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = os."userId" AND x."categoryKey" = 'shopping_home'
  );

INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  os."userId",
  CASE
    WHEN u."preferredLocale" = 'en' THEN 'Online shopping — Other'
    ELSE 'Compras online — Outros'
  END,
  'EXPENSE',
  'shopping_other',
  os.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Category" os
JOIN "User" u ON u.id = os."userId"
WHERE os."categoryKey" = 'online_shopping' AND os."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x."userId" = os."userId" AND x."categoryKey" = 'shopping_other'
  );

UPDATE "Transaction" t
SET
  "categoryId" = so.id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Category" os
JOIN "Category" so
  ON so."userId" = os."userId" AND so."categoryKey" = 'shopping_other'
WHERE t."categoryId" = os.id
  AND os."categoryKey" = 'online_shopping'
  AND os."parentId" IS NULL;

UPDATE "Recurrence" r
SET
  "categoryId" = so.id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Category" os
JOIN "Category" so
  ON so."userId" = os."userId" AND so."categoryKey" = 'shopping_other'
WHERE r."categoryId" = os.id
  AND os."categoryKey" = 'online_shopping'
  AND os."parentId" IS NULL;

UPDATE "CategorizationRule" cr
SET
  "categoryId" = so.id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Category" os
JOIN "Category" so
  ON so."userId" = os."userId" AND so."categoryKey" = 'shopping_other'
WHERE cr."categoryId" = os.id
  AND os."categoryKey" = 'online_shopping'
  AND os."parentId" IS NULL;

-- 5) System rules: generic online shopping → shopping_other; refine games / apparel
UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'shopping_other', "updatedAt" = CURRENT_TIMESTAMP
WHERE "categoryKey" = 'online_shopping';

UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'shopping_games', "updatedAt" = CURRENT_TIMESTAMP
WHERE "pattern" IN ('playstation', 'sonyplaysta', 'mp alimportados');

UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'shopping_clothing', "updatedAt" = CURRENT_TIMESTAMP
WHERE "pattern" IN ('shein', 'roadget');
