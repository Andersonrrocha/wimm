import { readFileSync } from 'fs'
import { join } from 'path'
import { CHECK_CONSTRAINTS, checkConstraintNames } from './check-constraints'

const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20260729120000_enums_to_text/migration.sql',
)

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
   */
  it('matches the values the PostgreSQL migration enforces', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    for (const c of CHECK_CONSTRAINTS) {
      expect(sql).toContain(`ADD CONSTRAINT "${c.name}"`)
      for (const value of c.values) {
        expect(sql).toContain(`'${value}'`)
      }
    }
  })

  it('exposes names sorted and unique', () => {
    const names = checkConstraintNames()
    expect(names).toEqual([...new Set(names)].sort())
    expect(names).toHaveLength(14)
  })
})
