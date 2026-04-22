INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'fort', 'market', 'EXPENSE', 2145, 'FOOD_MARKET', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
