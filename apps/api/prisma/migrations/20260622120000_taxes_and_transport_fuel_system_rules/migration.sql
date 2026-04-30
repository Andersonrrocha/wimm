-- Default category key `taxes` (Impostos) — Receita Federal and common collection strings.
-- Patterns are CONTAINS on trimmed lowercase description.
INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'receita federal', 'taxes', 'EXPENSE', 3200, 'TAXES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'receitafederal', 'taxes', 'EXPENSE', 3205, 'TAXES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'secretaria da receita', 'taxes', 'EXPENSE', 3210, 'TAXES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'darf', 'taxes', 'EXPENSE', 3215, 'TAXES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'gnre', 'taxes', 'EXPENSE', 3220, 'TAXES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'imposto de renda', 'taxes', 'EXPENSE', 3225, 'TAXES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'irpf', 'taxes', 'EXPENSE', 3230, 'TAXES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Fuel retail brands (Brazil) → default `transport` (before generic "posto gasolina" at 4000).
INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'shell', 'transport', 'EXPENSE', 3970, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ipiranga', 'transport', 'EXPENSE', 3971, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'raizen', 'transport', 'EXPENSE', 3972, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'raízen', 'transport', 'EXPENSE', 3973, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'vibra', 'transport', 'EXPENSE', 3974, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'petrobras', 'transport', 'EXPENSE', 3975, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'br mania', 'transport', 'EXPENSE', 3976, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'br distribuidora', 'transport', 'EXPENSE', 3977, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'boxter', 'transport', 'EXPENSE', 3978, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cosan', 'transport', 'EXPENSE', 3979, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'setta', 'transport', 'EXPENSE', 3980, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'carcio', 'transport', 'EXPENSE', 3981, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'redetop', 'transport', 'EXPENSE', 3982, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'phisalia', 'transport', 'EXPENSE', 3983, 'TRANSPORT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
