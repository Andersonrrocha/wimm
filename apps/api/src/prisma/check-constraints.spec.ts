import { CHECK_CONSTRAINTS, checkConstraintNames } from './check-constraints'

describe('CHECK constraint definitions', () => {
  it('declares exactly 18', () => {
    expect(CHECK_CONSTRAINTS).toHaveLength(18)
  })

  it('has one nullable constraint, on User.subscriptionPlan', () => {
    const nullable = CHECK_CONSTRAINTS.filter((c) => c.nullable)
    expect(nullable.map((c) => c.name)).toEqual(['User_subscriptionPlan_check'])
  })

  it('exposes names sorted and unique', () => {
    const names = checkConstraintNames()
    expect(names).toEqual([...new Set(names)].sort())
    expect(names).toHaveLength(18)
  })

  // Value correctness (table, column, values, nullable) is NOT checked here
  // against any migration file. This module used to be compared against a
  // frozen historical migration
  // (prisma/migrations/20260729120000_enums_to_text/migration.sql), but that
  // made the wrong thing the oracle: when a later migration legitimately
  // widens a value set, the frozen file goes stale by design, so comparing
  // against it punishes the developer who correctly updates
  // CHECK_CONSTRAINTS and says nothing when someone forgets to. Live
  // PostgreSQL is the actual runtime guarantee, so that's what this is
  // verified against — by `pnpm --filter @wimm/api run assert:constraints`
  // (apps/api/scripts/assert-check-constraints.ts), run in CI after
  // `prisma migrate deploy`. Do not re-add a comparison against a migration
  // file here; it reintroduces the inverted incentive this replaced.
})
