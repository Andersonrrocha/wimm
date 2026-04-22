-- International and major BR marketplaces → online_shopping (CONTAINS on normalized description).
-- Descriptors often include brand names, legal names (e.g. Roadget for SHEIN), Shopee*, SParcelado, AliExpress, Temu, Wish.com, etc.
INSERT INTO "SystemCategorizationRule" ("id", "pattern", "categoryKey", "kind", "priority", "ruleGroup", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'shein', 'online_shopping', 'EXPENSE', 2012, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'roadget', 'online_shopping', 'EXPENSE', 2013, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'shopee', 'online_shopping', 'EXPENSE', 2014, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sparcelado', 'online_shopping', 'EXPENSE', 2015, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'aliexpress', 'online_shopping', 'EXPENSE', 2016, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ali express', 'online_shopping', 'EXPENSE', 2017, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'temu', 'online_shopping', 'EXPENSE', 2018, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'wish.com', 'online_shopping', 'EXPENSE', 2019, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'order.wish', 'online_shopping', 'EXPENSE', 2020, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ebay', 'online_shopping', 'EXPENSE', 2021, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'dhgate', 'online_shopping', 'EXPENSE', 2022, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lazada', 'online_shopping', 'EXPENSE', 2023, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'banggood', 'online_shopping', 'EXPENSE', 2024, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lightinthebox', 'online_shopping', 'EXPENSE', 2025, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'light in the box', 'online_shopping', 'EXPENSE', 2026, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'tiktok shop', 'online_shopping', 'EXPENSE', 2027, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'tiktokshop', 'online_shopping', 'EXPENSE', 2028, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'etsy', 'online_shopping', 'EXPENSE', 2029, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mercadoshops', 'online_shopping', 'EXPENSE', 2030, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'magazineluiza', 'online_shopping', 'EXPENSE', 2031, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'magazine luiza', 'online_shopping', 'EXPENSE', 2032, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'magalu', 'online_shopping', 'EXPENSE', 2033, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'americanas', 'online_shopping', 'EXPENSE', 2034, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'submarino', 'online_shopping', 'EXPENSE', 2035, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'casasbahia', 'online_shopping', 'EXPENSE', 2036, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'casas bahia', 'online_shopping', 'EXPENSE', 2037, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'kabum', 'online_shopping', 'EXPENSE', 2038, 'ONLINE_SHOPPING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("pattern") DO UPDATE SET
  "categoryKey" = EXCLUDED."categoryKey",
  "kind" = EXCLUDED."kind",
  "priority" = EXCLUDED."priority",
  "ruleGroup" = EXCLUDED."ruleGroup",
  "updatedAt" = CURRENT_TIMESTAMP;
