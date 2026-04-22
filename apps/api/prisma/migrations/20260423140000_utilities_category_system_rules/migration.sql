-- Default category key `utilities` (Contas e utilidades) — phone, internet, power, water.
-- Patterns are CONTAINS on trimmed lowercase description. Avoid bare "oi" / "net" (false positives).
INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'claro', 'utilities', 'EXPENSE', 3100, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'vivo', 'utilities', 'EXPENSE', 3105, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'vivo fibra', 'utilities', 'EXPENSE', 3110, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'oi movel', 'utilities', 'EXPENSE', 3115, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'oi móvel', 'utilities', 'EXPENSE', 3120, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'oi celular', 'utilities', 'EXPENSE', 3125, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'oi fibra', 'utilities', 'EXPENSE', 3130, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'telemar', 'utilities', 'EXPENSE', 3135, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'vero', 'utilities', 'EXPENSE', 3140, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'virtua', 'utilities', 'EXPENSE', 3145, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'net virtua', 'utilities', 'EXPENSE', 3150, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'net combo', 'utilities', 'EXPENSE', 3155, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'rge', 'utilities', 'EXPENSE', 3160, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cpfl', 'utilities', 'EXPENSE', 3165, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ceee', 'utilities', 'EXPENSE', 3170, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'aesul', 'utilities', 'EXPENSE', 3175, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'dmae', 'utilities', 'EXPENSE', 3180, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'corsan', 'utilities', 'EXPENSE', 3185, 'UTILITIES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
