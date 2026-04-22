INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'posto gasolina', 'transport', 'EXPENSE', 4000, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'gasolina', 'transport', 'EXPENSE', 4010, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'uber', 'transport', 'EXPENSE', 4020, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '99 pop', 'transport', 'EXPENSE', 4030, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '99pop', 'transport', 'EXPENSE', 4040, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cabify', 'transport', 'EXPENSE', 4050, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'pedagio', 'transport', 'EXPENSE', 4060, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'pedágio', 'transport', 'EXPENSE', 4070, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'estacionamento', 'transport', 'EXPENSE', 4080, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'taxi', 'transport', 'EXPENSE', 4090, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'posto', 'transport', 'EXPENSE', 4690, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
