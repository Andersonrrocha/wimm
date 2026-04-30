-- Banrisul / card-statement descriptors → online_shopping (CONTAINS on normalized description).
-- Amazon marketplace, Amazon BR, PlayStation / Sony on statements, Mercado Pago seller prefixes.
INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'amazonmktplc', 'online_shopping', 'EXPENSE', 2039, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'amazon br', 'online_shopping', 'EXPENSE', 2040, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'playstation', 'online_shopping', 'EXPENSE', 2041, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mp alimportados', 'online_shopping', 'EXPENSE', 2042, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sonyplaysta', 'online_shopping', 'EXPENSE', 2043, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
