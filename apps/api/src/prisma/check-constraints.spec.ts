import { readFileSync } from 'fs'
import { join } from 'path'
import { CHECK_CONSTRAINTS, checkConstraintNames } from './check-constraints'

const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20260729120000_enums_to_text/migration.sql',
)

type ParsedCheckConstraint = {
  name: string
  values: string[]
  nullable: boolean
}

/**
 * Extracts every `ADD CONSTRAINT "<name>" CHECK (...)` statement from the
 * migration SQL, keyed by constraint name, with the single-quoted literals
 * and the "IS NULL" branch scoped to that statement only.
 *
 * This repository controls the migration file, so the parser assumes
 * well-formed input and throws rather than skipping when a statement doesn't
 * match the expected shape — a migration this can't read is a defect to
 * surface, not to silently pass over.
 */
function parseCheckConstraints(sql: string): Map<string, ParsedCheckConstraint> {
  const statementPattern = /ADD CONSTRAINT "(\w+)"\s+CHECK \((.*?)\);/gs
  const parsed = new Map<string, ParsedCheckConstraint>()

  for (const match of sql.matchAll(statementPattern)) {
    const [, name, body] = match
    if (parsed.has(name)) throw new Error(`Duplicate CHECK constraint name in migration: "${name}"`)
    const values = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1])
    if (values.length === 0) throw new Error(`CHECK constraint "${name}" has no quoted values: ${body}`)
    parsed.set(name, { name, values, nullable: /\bIS NULL\b/.test(body) })
  }

  const occurrences = (sql.match(/ADD CONSTRAINT/g) ?? []).length
  if (occurrences !== parsed.size) {
    throw new Error(
      `Found ${occurrences} "ADD CONSTRAINT" occurrences in the migration but only parsed ${parsed.size} ` +
        'CHECK statements — a statement does not match the expected `ADD CONSTRAINT "<name>" CHECK (...);` shape.',
    )
  }
  if (parsed.size === 0) throw new Error(`No CHECK constraints found in migration: ${MIGRATION}`)

  return parsed
}

describe('CHECK constraint definitions', () => {
  it('declares exactly 14', () => {
    expect(CHECK_CONSTRAINTS).toHaveLength(14)
  })

  it('has one nullable constraint, on User.subscriptionPlan', () => {
    const nullable = CHECK_CONSTRAINTS.filter((c) => c.nullable)
    expect(nullable.map((c) => c.name)).toEqual(['User_subscriptionPlan_check'])
  })

  /**
   * The migration is what PostgreSQL actually enforces. If this module and the
   * migration disagree, one of them is lying about what the database allows —
   * and every `string`-typed enum column in apps/api rests on that guarantee.
   *
   * This parses each `ADD CONSTRAINT ... CHECK (...)` statement individually so
   * a comparison never leaks across constraints (e.g. a value that belongs to
   * one column's CHECK must not "cover" the same value expected in another
   * column's CHECK), and compares in both directions so neither a value dropped
   * from the module nor a value dropped from the migration goes unnoticed.
   */
  it('matches the values the PostgreSQL migration enforces, per constraint, in both directions', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const parsed = parseCheckConstraints(sql)

    const sqlNames = [...parsed.keys()].sort()
    const moduleNames = CHECK_CONSTRAINTS.map((c) => c.name).sort()
    expect(sqlNames).toEqual(moduleNames)

    for (const c of CHECK_CONSTRAINTS) {
      const fromSql = parsed.get(c.name)
      if (!fromSql) throw new Error(`Constraint "${c.name}" not found in migration SQL`)
      expect(new Set(fromSql.values)).toEqual(new Set(c.values))
      expect(fromSql.nullable).toBe(c.nullable)
    }
  })

  it('exposes names sorted and unique', () => {
    const names = checkConstraintNames()
    expect(names).toEqual([...new Set(names)].sort())
    expect(names).toHaveLength(14)
  })
})
