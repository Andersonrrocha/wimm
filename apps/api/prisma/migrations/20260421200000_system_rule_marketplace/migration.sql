INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'marketplace', 'online_shopping', 'EXPENSE', 1990, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
