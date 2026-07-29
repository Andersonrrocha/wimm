import { injectCheckConstraints } from '../../scripts/inject-check-constraints'

/** Two tables sharing a `kind` column — the exact shape that breaks a global regex. */
const DDL = `-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Recurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "endMode" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartDateMode" TEXT NOT NULL DEFAULT 'BILLING_CYCLE',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "subscriptionPlan" TEXT,
    "aiCategorizationMode" TEXT NOT NULL DEFAULT 'OFF'
);
`

function tableBlock(ddl: string, table: string): string {
  const m = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(ddl)
  if (!m) throw new Error(`no block for ${table}`)
  return m[1]
}

describe('injectCheckConstraints', () => {
  it('scopes each constraint to its own table', () => {
    const out = injectCheckConstraints(DDL)
    expect(tableBlock(out, 'Transaction')).toContain(`CHECK ("kind" IN ('INCOME', 'EXPENSE'))`)
    expect(tableBlock(out, 'Recurrence')).toContain(`CHECK ("frequency" IN ('WEEKLY', 'MONTHLY', 'YEARLY'))`)
    // Recurrence also has `kind`; it must get its own, not Transaction's leftovers.
    expect(tableBlock(out, 'Recurrence')).toContain(`CHECK ("kind" IN ('INCOME', 'EXPENSE'))`)
  })

  it('does not put a constraint in a table that lacks the column', () => {
    const out = injectCheckConstraints(DDL)
    expect(tableBlock(out, 'User')).not.toContain(`CHECK ("kind"`)
    expect(tableBlock(out, 'Transaction')).not.toContain(`CHECK ("frequency"`)
  })

  it('permits NULL on the one nullable constraint', () => {
    const user = tableBlock(injectCheckConstraints(DDL), 'User')
    expect(user).toContain(`CHECK ("subscriptionPlan" IS NULL OR "subscriptionPlan" IN ('MONTHLY', 'ANNUAL', 'LIFETIME'))`)
  })

  it('preserves a column default while adding the constraint', () => {
    const user = tableBlock(injectCheckConstraints(DDL), 'User')
    expect(user).toContain(`DEFAULT 'BILLING_CYCLE'`)
    expect(user).toContain(`CHECK ("chartDateMode" IN ('BILLING_CYCLE', 'PURCHASE_DATE'))`)
  })

  it('is idempotent', () => {
    const once = injectCheckConstraints(DDL)
    expect(injectCheckConstraints(once)).toBe(once)
  })

  it('throws when a declared constraint has no matching column', () => {
    expect(() => injectCheckConstraints(`CREATE TABLE "Transaction" (\n    "id" TEXT NOT NULL\n);\n`)).toThrow(
      /Transaction/,
    )
  })
})
