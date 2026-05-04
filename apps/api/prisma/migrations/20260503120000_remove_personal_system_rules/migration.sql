-- Remove categorization rules that were seeded as SYSTEM but are personal/regional to
-- the original developer. They will be re-inserted as user-scoped CategorizationRule
-- rows for that user via `pnpm --filter @wimm/api seed:personal -- --userId=<uuid>`.
--
-- Categories targeted:
--   - Personal merchants (Anderson-specific): fort, mp alimportados, platano variants,
--     dona barbara, diagnostica
--   - Local Rio Grande do Sul retailers (not generic-BR): rissul, kern, zaffari,
--     unidasul, panvel, sao joao / saojoao
--   - Banrisul-only descriptor format: " sh " (Shell shorthand on that issuer's
--     statements; other banks use full "shell")
DELETE FROM "SystemCategorizationRule"
WHERE "pattern" IN (
  'fort',
  'mp alimportados',
  'platano imoveis',
  'platano imóveis',
  'platanoimoveis',
  'dona barbara',
  'diagnostica',
  'rissul',
  'kern',
  'zaffari',
  'unidasul',
  'panvel',
  'sao joao',
  'saojoao',
  ' sh '
);
