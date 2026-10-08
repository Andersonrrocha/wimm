import { CHECK_CONSTRAINTS, checkConstraintNames } from './check-constraints'

describe('CHECK constraint definitions', () => {
  it('declares exactly 19', () => {
    expect(CHECK_CONSTRAINTS).toHaveLength(19)
  })

  // Nullable is the exception, not the default: a CHECK that permits NULL on
  // a NOT NULL column would be indistinguishable from the strict form, so the
  // two columns that legitimately need it are named rather than counted.
  it('has two nullable constraints, on User.subscriptionPlan and User.aiByokSource', () => {
    const nullable = CHECK_CONSTRAINTS.filter((c) => c.nullable)
    expect(nullable.map((c) => c.name).sort()).toEqual([
      'User_aiByokSource_check',
      'User_subscriptionPlan_check',
    ])
  })

  it('exposes names sorted and unique', () => {
    const names = checkConstraintNames()
    expect(names).toEqual([...new Set(names)].sort())
    expect(names).toHaveLength(19)
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
