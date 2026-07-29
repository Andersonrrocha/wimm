import { injectCheckConstraints, renderCheck } from '../../scripts/inject-check-constraints'
import { CHECK_CONSTRAINTS } from './check-constraints'

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

  it('does not throw when a table is missing from the DDL entirely, and injects only what it can', () => {
    // Only "User" is present; the other 9 tables in schema.sqlite.prisma (Transaction,
    // Recurrence, Source, Category, SystemCategorizationRule, CategorizationRule,
    // ImportBatch, InstallmentPlan, RefreshToken) never appear. This pins the tolerant
    // behavior the 3-table fixture above relies on: a missing table is silently
    // skipped, not an error — the CLI (main(), covered separately) is what turns a
    // silent skip into a hard failure.
    const userOnly = `CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartDateMode" TEXT NOT NULL DEFAULT 'BILLING_CYCLE',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "subscriptionPlan" TEXT,
    "aiCategorizationMode" TEXT NOT NULL DEFAULT 'OFF'
);
`
    let out = ''
    expect(() => {
      out = injectCheckConstraints(userOnly)
    }).not.toThrow()

    // All 4 of User's constraints landed...
    const userConstraints = CHECK_CONSTRAINTS.filter((c) => c.table === 'User')
    expect(userConstraints).toHaveLength(4)
    for (const c of userConstraints) {
      expect(out).toContain(renderCheck(c))
    }

    // ...and nothing else did — the other 10 constraints have no table to land in.
    const checkCount = (out.match(/CHECK \(/g) ?? []).length
    expect(checkCount).toBe(4)
  })

  it('injects all 14 constraints when every table from schema.sqlite.prisma is present', () => {
    // Hand-written rather than generated via `prisma migrate diff`: this fixture only
    // needs to be structurally accurate (10 CREATE TABLE blocks, real column names),
    // and hand-writing keeps the test fast, hermetic, and independent of the Prisma
    // engine binary being available in the test environment. `apps/api/prisma/
    // migrations-sqlite/` doesn't exist yet (it's produced by a later task), so there
    // is no committed baseline to load instead.
    const fullDdl = `-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "chartDateMode" TEXT NOT NULL DEFAULT 'BILLING_CYCLE',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "subscriptionPlan" TEXT,
    "aiCategorizationMode" TEXT NOT NULL DEFAULT 'OFF'
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SystemCategorizationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "kind" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CategorizationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED'
);

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "installmentTotal" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Recurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "endMode" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL
);
`
    expect(CHECK_CONSTRAINTS).toHaveLength(14)

    const out = injectCheckConstraints(fullDdl)
    for (const c of CHECK_CONSTRAINTS) {
      expect(out).toContain(renderCheck(c))
    }

    const checkCount = (out.match(/CHECK \(/g) ?? []).length
    expect(checkCount).toBe(14)
  })
})
