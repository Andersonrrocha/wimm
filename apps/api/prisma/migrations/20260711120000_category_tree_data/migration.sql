-- Creates the 2-level category hierarchy for all existing users.
-- Migrates transactions from converted-to-parent categories (transport, health) to their _other leaves.
-- Bacfills null transaction categoryIds to the top-level 'other' catch-all.
-- Updates system categorization rules to target leaf keys.

DO $$
DECLARE
  u_id TEXT;
  u_locale TEXT;
  v_pt BOOLEAN;

  v_food_id TEXT;
  v_transport_id TEXT;
  v_health_id TEXT;
  v_subscriptions_id TEXT;
  v_transport_other_id TEXT;
  v_health_other_id TEXT;
  v_other_id TEXT;

  v_food_name TEXT;
  v_restaurants_name TEXT;
  v_food_other_name TEXT;
  v_housing_name TEXT;
  v_fuel_name TEXT;
  v_public_transport_name TEXT;
  v_transport_other_name TEXT;
  v_pharmacy_name TEXT;
  v_medical_name TEXT;
  v_health_other_name TEXT;
  v_leisure_name TEXT;
  v_subscriptions_name TEXT;
  v_software_name TEXT;
  v_subscriptions_other_name TEXT;
  v_other_name TEXT;
BEGIN
  FOR u_id, u_locale IN SELECT id, "preferredLocale" FROM "User" LOOP
    v_pt := u_locale != 'en';

    IF v_pt THEN
      v_food_name              := 'Alimentação';
      v_restaurants_name       := 'Restaurantes';
      v_food_other_name        := 'Alimentação — Outros';
      v_housing_name           := 'Moradia';
      v_fuel_name              := 'Combustível';
      v_public_transport_name  := 'Transporte público';
      v_transport_other_name   := 'Transporte — Outros';
      v_pharmacy_name          := 'Farmácia';
      v_medical_name           := 'Saúde médica';
      v_health_other_name      := 'Saúde — Outros';
      v_leisure_name           := 'Lazer';
      v_subscriptions_name     := 'Assinaturas';
      v_software_name          := 'Software';
      v_subscriptions_other_name := 'Assinaturas — Outros';
      v_other_name             := 'Outros';
    ELSE
      v_food_name              := 'Food';
      v_restaurants_name       := 'Restaurants';
      v_food_other_name        := 'Food — Other';
      v_housing_name           := 'Housing';
      v_fuel_name              := 'Fuel';
      v_public_transport_name  := 'Public transport';
      v_transport_other_name   := 'Transport — Other';
      v_pharmacy_name          := 'Pharmacy';
      v_medical_name           := 'Healthcare';
      v_health_other_name      := 'Health — Other';
      v_leisure_name           := 'Leisure';
      v_subscriptions_name     := 'Subscriptions';
      v_software_name          := 'Software';
      v_subscriptions_other_name := 'Subscriptions — Other';
      v_other_name             := 'Other';
    END IF;

    -- ===== FOOD =====
    SELECT id INTO v_food_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'food';
    IF v_food_id IS NULL THEN
      v_food_id := gen_random_uuid()::text;
      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (v_food_id, u_id, v_food_name, 'EXPENSE', 'food', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;
      SELECT id INTO v_food_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'food';
    END IF;

    IF v_food_id IS NOT NULL THEN
      -- Reparent existing 'market' under food
      UPDATE "Category"
      SET "parentId" = v_food_id, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = u_id AND "categoryKey" = 'market'
        AND ("parentId" IS NULL OR "parentId" != v_food_id);

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_restaurants_name, 'EXPENSE', 'restaurants', v_food_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_food_other_name, 'EXPENSE', 'food_other', v_food_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;
    END IF;

    -- ===== HOUSING (leaf) =====
    INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, u_id, v_housing_name, 'EXPENSE', 'housing', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING;

    -- ===== TRANSPORT (existing key, becomes parent) =====
    SELECT id INTO v_transport_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'transport';

    IF v_transport_id IS NOT NULL THEN
      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_fuel_name, 'EXPENSE', 'fuel', v_transport_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_public_transport_name, 'EXPENSE', 'public_transport', v_transport_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_transport_other_name, 'EXPENSE', 'transport_other', v_transport_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      SELECT id INTO v_transport_other_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'transport_other';

      IF v_transport_other_id IS NOT NULL THEN
        UPDATE "Transaction"
        SET "categoryId" = v_transport_other_id, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "userId" = u_id AND "categoryId" = v_transport_id;
      END IF;
    END IF;

    -- ===== HEALTH (existing key, becomes parent) =====
    SELECT id INTO v_health_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'health';

    IF v_health_id IS NOT NULL THEN
      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_pharmacy_name, 'EXPENSE', 'pharmacy', v_health_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_medical_name, 'EXPENSE', 'medical', v_health_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_health_other_name, 'EXPENSE', 'health_other', v_health_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      SELECT id INTO v_health_other_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'health_other';

      IF v_health_other_id IS NOT NULL THEN
        UPDATE "Transaction"
        SET "categoryId" = v_health_other_id, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "userId" = u_id AND "categoryId" = v_health_id;
      END IF;
    END IF;

    -- ===== LEISURE (leaf) =====
    INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, u_id, v_leisure_name, 'EXPENSE', 'leisure', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING;

    -- ===== SUBSCRIPTIONS (new parent) =====
    SELECT id INTO v_subscriptions_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'subscriptions';
    IF v_subscriptions_id IS NULL THEN
      v_subscriptions_id := gen_random_uuid()::text;
      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (v_subscriptions_id, u_id, v_subscriptions_name, 'EXPENSE', 'subscriptions', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;
      SELECT id INTO v_subscriptions_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'subscriptions';
    END IF;

    IF v_subscriptions_id IS NOT NULL THEN
      UPDATE "Category"
      SET "parentId" = v_subscriptions_id, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = u_id AND "categoryKey" = 'streaming'
        AND ("parentId" IS NULL OR "parentId" != v_subscriptions_id);

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_software_name, 'EXPENSE', 'software', v_subscriptions_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;

      INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, u_id, v_subscriptions_other_name, 'EXPENSE', 'subscriptions_other', v_subscriptions_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;
    END IF;

    -- ===== OTHER (leaf — global fallback) =====
    INSERT INTO "Category" (id, "userId", name, type, "categoryKey", "parentId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, u_id, v_other_name, 'EXPENSE', 'other', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_other_id FROM "Category" WHERE "userId" = u_id AND "categoryKey" = 'other';

    -- Backfill null categoryIds to 'other'
    IF v_other_id IS NOT NULL THEN
      UPDATE "Transaction"
      SET "categoryId" = v_other_id, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = u_id AND "categoryId" IS NULL;
    END IF;

  END LOOP;
END;
$$;

-- Pharmacy patterns: health → pharmacy leaf key
UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'pharmacy', "updatedAt" = CURRENT_TIMESTAMP
WHERE "pattern" IN ('panvel', 'sao joao', 'saojoao', 'drogaria', 'farmacia')
  AND "categoryKey" = 'health';

-- Fuel brand patterns: transport → fuel leaf key
UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'fuel', "updatedAt" = CURRENT_TIMESTAMP
WHERE "pattern" IN (
  'shell', 'ipiranga', 'raizen', 'raízen', 'vibra', 'petrobras',
  'br mania', 'br distribuidora', 'boxter', 'cosan', 'setta',
  'carcio', 'redetop', 'phisalia',
  'posto gasolina', 'gasolina', 'posto'
) AND "categoryKey" = 'transport';

-- Ride and parking patterns: transport → public_transport or transport_other
UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'public_transport', "updatedAt" = CURRENT_TIMESTAMP
WHERE "pattern" IN ('uber', '99 pop', '99pop', 'cabify', 'taxi')
  AND "categoryKey" = 'transport';

UPDATE "SystemCategorizationRule"
SET "categoryKey" = 'transport_other', "updatedAt" = CURRENT_TIMESTAMP
WHERE "pattern" IN ('pedagio', 'pedágio', 'estacionamento')
  AND "categoryKey" = 'transport';
