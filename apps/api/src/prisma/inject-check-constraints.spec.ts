import { injectCheckConstraints, renderCheck, stripForeignKeysPragma } from '../../scripts/inject-check-constraints'
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

/**
 * Assert a table's block carries exactly the CHECK clauses CHECK_CONSTRAINTS
 * declares for it — no more, no fewer — and that each expected clause is
 * present.
 *
 * A plain `toContain` on a rendered clause cannot catch misrouting: several
 * tables share column names (`kind` on Transaction, Recurrence and
 * SystemCategorizationRule), so their constraints render to byte-identical
 * strings. A constraint that leaked from one table into another would satisfy
 * `toContain` in both places. Counting CHECK clauses per block is what makes
 * that leak visible — the donor block ends up short one clause, the
 * recipient block carries one extra.
 */
function expectTableConstraints(out: string, table: string): void {
  const block = tableBlock(out, table)
  const expected = CHECK_CONSTRAINTS.filter((c) => c.table === table)
  const actual = block.match(/CHECK \(/g) ?? []
  expect(actual).toHaveLength(expected.length)
  for (const c of expected) {
    expect(block).toContain(renderCheck(c))
  }
}

describe('injectCheckConstraints', () => {
  it('scopes each constraint to its own table', () => {
    const out = injectCheckConstraints(DDL)
    // Recurrence also has `kind`; it must get its own, not Transaction's leftovers.
    // Transaction_kind_check and Recurrence_kind_check render to the identical
    // string, so only a per-block count — not string presence — can tell a
    // correctly scoped constraint apart from one that leaked from the other table.
    expectTableConstraints(out, 'Transaction')
    expectTableConstraints(out, 'Recurrence')
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

    // Assert per table, not just presence across the whole output: several tables
    // here share column names (`kind` on Transaction, Recurrence and
    // SystemCategorizationRule) and render identical CHECK clauses, so a global
    // `toContain` plus a total count cannot tell a correctly-routed constraint from
    // one that landed in the wrong block. Includes InstallmentPlan and RefreshToken,
    // which declare zero constraints — a leak into either would show up here too.
    for (const table of [
      'User',
      'Source',
      'Category',
      'SystemCategorizationRule',
      'CategorizationRule',
      'ImportBatch',
      'InstallmentPlan',
      'Recurrence',
      'Transaction',
      'RefreshToken',
    ]) {
      expectTableConstraints(out, table)
    }

    const checkCount = (out.match(/CHECK \(/g) ?? []).length
    expect(checkCount).toBe(14)
  })
})

describe('stripForeignKeysPragma', () => {
  // The exact shape `prisma migrate diff --script` emits (captured verbatim from a
  // real run against this repo's schema.sqlite.prisma, forcing a table rebuild by
  // changing an existing column's default) around any table rebuild it cannot
  // express as `ADD COLUMN`. This is what `applyPendingMigrations` rejects outright
  // today (`assertNoForeignKeysPragma`) -- stripping it here is what stops every
  // generated rebuild migration from being dead on arrival.
  const REBUILD_DDL = `-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "isProjected" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("id", "userId", "isProjected") SELECT "id", "userId", "isProjected" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
`

  it('strips every PRAGMA foreign_keys=ON/OFF line', () => {
    const out = stripForeignKeysPragma(REBUILD_DDL)
    expect(out).not.toMatch(/PRAGMA\s+foreign_keys/i)
  })

  it('leaves PRAGMA defer_foreign_keys alone', () => {
    const out = stripForeignKeysPragma(REBUILD_DDL)
    expect(out).toContain('PRAGMA defer_foreign_keys=ON;')
    expect(out).toContain('PRAGMA defer_foreign_keys=OFF;')
  })

  it('leaves the rest of the DDL (CREATE/INSERT/DROP/ALTER) intact and in order', () => {
    const out = stripForeignKeysPragma(REBUILD_DDL)
    expect(out).toContain('CREATE TABLE "new_Transaction"')
    expect(out).toContain('INSERT INTO "new_Transaction"')
    expect(out).toContain('DROP TABLE "Transaction";')
    expect(out).toContain('ALTER TABLE "new_Transaction" RENAME TO "Transaction";')

    const dropIndex = out.indexOf('DROP TABLE "Transaction";')
    const renameIndex = out.indexOf('ALTER TABLE "new_Transaction" RENAME TO "Transaction";')
    expect(dropIndex).toBeGreaterThan(-1)
    expect(renameIndex).toBeGreaterThan(dropIndex)
  })

  it('is a no-op on DDL that never had a PRAGMA foreign_keys line', () => {
    const plain = 'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);\n'
    expect(stripForeignKeysPragma(plain)).toBe(plain)
  })

  it('composes with injectCheckConstraints so the generation pipeline strips then injects', () => {
    const out = injectCheckConstraints(stripForeignKeysPragma(REBUILD_DDL))
    expect(out).not.toMatch(/PRAGMA\s+foreign_keys/i)
    expect(out).toContain('PRAGMA defer_foreign_keys=ON;')
  })
})
