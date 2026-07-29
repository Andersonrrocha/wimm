/**
 * Assert that the CHECK constraints guarding the former enum columns still
 * exist in live PostgreSQL AND still allow exactly what CHECK_CONSTRAINTS
 * declares — not merely that a constraint with the right name is present.
 *
 * Phase 0 replaced 12 PostgreSQL enums with TEXT columns and widened several
 * internal row-shape types to bare `string`, on the argument that the database
 * guarantees validity. These constraints ARE that guarantee. They live only in
 * migration SQL — Prisma does not model CHECK — so a squashed or regenerated
 * baseline would drop all 14 silently.
 *
 * The database is the oracle here, not the migration file that first created
 * these constraints: a later migration can legitimately widen a value set
 * (say, `User.subscriptionStatus` gaining `'PAUSED'`), and the moment it does,
 * `apps/api/src/prisma/check-constraints.ts` must be updated to match what
 * PostgreSQL now enforces. Comparing against a frozen historical migration
 * instead would fail exactly when someone does that correctly, and stay quiet
 * when a `CHECK_CONSTRAINTS` entry drifts from reality — the wrong incentive.
 * So this script reads `pg_get_constraintdef` off the live database, parses
 * it, and compares table, column, allowed values, and nullability against the
 * module directly. It also flags any CHECK in the database that the module
 * does not declare, so a 15th enum-shaped column can't go unguarded.
 *
 * Run in CI after `prisma migrate deploy`.
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { CHECK_CONSTRAINTS } from '../src/prisma/check-constraints'

type RawRow = {
  conname: string
  table_name: string
  def: string
  convalidated: boolean
}

type ParsedDef = {
  column: string
  values: string[]
  nullable: boolean
}

type LiveConstraint = {
  table: string
  def: string
  validated: boolean
  parsed: ParsedDef | null
}

/**
 * Matches the `<column> = ANY (ARRAY[...])` or `<column> = '<value>'::text`
 * fragment that `pg_get_constraintdef` renders for `IN (...)` / `=` checks.
 * The column is bare when it needs no quoting and double-quoted when it's
 * camelCase. Only one such comparison ever appears per constraint (the
 * nullable form adds an `IS NULL` branch, never a second comparison), so the
 * first match is the whole story.
 */
const COMPARISON_RE = /"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=\s*(?:ANY\s*\(ARRAY\[(.*?)\]\)|'([^']*)'::text)/

/** Parses a single quoted-literal list, e.g. `'A'::text, 'B'::text` -> ['A', 'B']. */
function parseValueList(list: string): string[] {
  return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1])
}

/**
 * Parses a `pg_get_constraintdef` result into column/values/nullable, or
 * returns null when the definition doesn't match the enum-guard shape this
 * project uses (e.g. a numeric range check) — such a constraint is reported
 * as unparseable rather than crashing the whole assertion.
 */
function parseConstraintDef(def: string): ParsedDef | null {
  const match = COMPARISON_RE.exec(def)
  if (!match) return null

  const [, column, arrayList, singleValue] = match
  const values = arrayList !== undefined ? parseValueList(arrayList) : [singleValue]
  const nullable = /\bIS NULL\b/.test(def)

  return { column, values, nullable }
}

function sameValueSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((v) => setB.has(v))
}

function sortedList(values: readonly string[]): string {
  return [...values].sort().join(', ')
}

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT conname, conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS def, convalidated
        FROM pg_constraint
       WHERE contype = 'c' AND conrelid <> 0 AND connamespace = 'public'::regnamespace
    `

    const live = new Map<string, LiveConstraint>(
      rows.map((row) => [
        row.conname,
        {
          table: row.table_name.replace(/"/g, ''),
          def: row.def,
          validated: row.convalidated,
          parsed: parseConstraintDef(row.def),
        },
      ]),
    )

    const declaredNames = new Set(CHECK_CONSTRAINTS.map((c) => c.name))

    const missing: string[] = []
    const extra: string[] = []
    const wrongTable: string[] = []
    const wrongColumn: string[] = []
    const wrongValues: string[] = []
    const wrongNullable: string[] = []
    const notValidated: string[] = []

    for (const declared of CHECK_CONSTRAINTS) {
      const row = live.get(declared.name)
      if (!row) {
        missing.push(`  - ${declared.name}`)
        continue
      }

      if (!row.validated) notValidated.push(`  - ${declared.name}`)

      if (row.table !== declared.table) {
        wrongTable.push(`  - ${declared.name}: declared table "${declared.table}", database has "${row.table}"`)
      }

      if (!row.parsed) {
        wrongValues.push(`  - ${declared.name}: could not parse definition: ${row.def}`)
        continue
      }

      if (row.parsed.column !== declared.column) {
        wrongColumn.push(`  - ${declared.name}: declared column "${declared.column}", database has "${row.parsed.column}"`)
      }

      if (!sameValueSet(declared.values, row.parsed.values)) {
        wrongValues.push(
          `  - ${declared.name}: declared [${sortedList(declared.values)}], database allows [${sortedList(row.parsed.values)}]`,
        )
      }

      if (row.parsed.nullable !== declared.nullable) {
        wrongNullable.push(
          `  - ${declared.name}: declared nullable=${declared.nullable}, database allows NULL=${row.parsed.nullable}`,
        )
      }
    }

    for (const [name, row] of live) {
      if (declaredNames.has(name)) continue
      const location = row.parsed ? `${row.table}.${row.parsed.column}` : `${row.table} (${row.def})`
      extra.push(`  - ${name} on ${location}`)
    }

    const groups: Array<[string, string[]]> = [
      ['Missing', missing],
      ['Extra (in the database but not declared in check-constraints.ts)', extra],
      ['Wrong table', wrongTable],
      ['Wrong column', wrongColumn],
      ['Wrong values', wrongValues],
      ['Wrong nullable', wrongNullable],
      ['Present but NOT VALIDATED', notValidated],
    ]

    const failing = groups.filter(([, items]) => items.length > 0)

    if (failing.length > 0) {
      console.error(
        'CHECK constraint verification FAILED.\n\n' +
          'These constraints are the runtime guarantee behind the `string`-typed\n' +
          'enum columns in apps/api/src. Without them, a corrupt value reaches the\n' +
          'domain layer. Do not delete this assertion to make CI green — restore\n' +
          'the constraints, which were first defined in\n' +
          'apps/api/prisma/migrations/20260729120000_enums_to_text/migration.sql\n' +
          'and must match apps/api/src/prisma/check-constraints.ts exactly.\n',
      )
      for (const [label, items] of failing) {
        console.error(`${label} (${items.length}):`)
        for (const line of items) console.error(line)
        console.error('')
      }
      return 1
    }

    console.log(`All ${CHECK_CONSTRAINTS.length} CHECK constraints present, validated, and matching live PostgreSQL.`)
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
