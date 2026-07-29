/**
 * Assert that the CHECK constraints guarding the former enum columns still exist.
 *
 * Phase 0 replaced 12 PostgreSQL enums with TEXT columns and widened several
 * internal row-shape types to bare `string`, on the argument that the database
 * guarantees validity. These constraints ARE that guarantee. They live only in
 * migration SQL — Prisma does not model CHECK — so a squashed or regenerated
 * baseline would drop all 14 silently.
 *
 * Run in CI after `prisma migrate deploy`.
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const EXPECTED = [
  'CategorizationRule_matchType_check',
  'Category_type_check',
  'ImportBatch_format_check',
  'ImportBatch_status_check',
  'Recurrence_endMode_check',
  'Recurrence_frequency_check',
  'Recurrence_kind_check',
  'Source_type_check',
  'SystemCategorizationRule_kind_check',
  'Transaction_kind_check',
  'User_aiCategorizationMode_check',
  'User_chartDateMode_check',
  'User_subscriptionPlan_check',
  'User_subscriptionStatus_check',
] as const

type ConstraintRow = { conname: string; convalidated: boolean }

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    const rows = await prisma.$queryRaw<ConstraintRow[]>`
      SELECT conname, convalidated
        FROM pg_constraint
       WHERE contype = 'c' AND connamespace = 'public'::regnamespace
    `

    const found = new Map(rows.map((r) => [r.conname, r.convalidated]))
    const missing = EXPECTED.filter((name) => !found.has(name))
    const unvalidated = EXPECTED.filter((name) => found.get(name) === false)

    if (missing.length > 0 || unvalidated.length > 0) {
      console.error(
        'CHECK constraint verification FAILED.\n\n' +
          'These constraints are the runtime guarantee behind the `string`-typed\n' +
          'enum columns in apps/api/src. Without them, a corrupt value reaches the\n' +
          'domain layer. Do not delete this assertion to make CI green — restore\n' +
          'the constraints, which are defined in\n' +
          'apps/api/prisma/migrations/20260729120000_enums_to_text/migration.sql\n',
      )
      if (missing.length > 0) {
        console.error(`Missing (${missing.length}):`)
        for (const name of missing) console.error(`  - ${name}`)
      }
      if (unvalidated.length > 0) {
        console.error(`Present but NOT VALIDATED (${unvalidated.length}):`)
        for (const name of unvalidated) console.error(`  - ${name}`)
      }
      return 1
    }

    console.log(`All ${EXPECTED.length} CHECK constraints present and validated.`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
