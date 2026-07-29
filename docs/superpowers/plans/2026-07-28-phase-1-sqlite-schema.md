# Phase 1 — SQLite Schema, Client and Constraints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a SQLite schema derived from the PostgreSQL one, a second Prisma client, a SQLite migration chain whose baseline carries all 14 `CHECK` constraints, and a guard that fails the build when any of those drift apart.

**Architecture:** `schema.sqlite.prisma` is generated from `schema.prisma` by rewriting two lines and is committed so diffs are reviewable. The 14 constraint definitions move into one TypeScript module consumed by the injector, the existing PostgreSQL assertion script, and the drift guard — replacing three separate copies of a security-relevant list. Injection is scoped per `CREATE TABLE` block, because three tables share a `"kind" TEXT NOT NULL` column.

**Tech Stack:** TypeScript 5.5, Prisma 7.7 (`prisma-client` generator, driver adapters), `@prisma/adapter-better-sqlite3`, `better-sqlite3`, Jest 30, pnpm 9, Turbo, GitHub Actions.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scopes: `database`, `api`, `workspace`.
- **Nothing in `apps/api/src` outside `src/prisma/` may change.** No service, no controller, no mapper. This phase produces artifacts and guards; it changes no behavior.
- `apps/desktop` and `apps/mobile` must not be touched.
- No new dependencies beyond the two already installed in `035fff9`.
- The API test suite stays **unit-only and offline**. The drift guard is a script, like `assert-check-constraints.ts`.
- Baseline: `@wimm/shared` 28/28 (4 suites), `@wimm/api` 246/246 (34 suites), `pnpm build` and `pnpm lint` green.
- `apps/api/src/generated/` is **gitignored**. Both clients are build products; neither is committed. `schema.sqlite.prisma` and the baseline migration **are** committed.

## Verified facts this plan depends on

A throwaway prototype established these before the plan was written. Do not re-litigate them:

1. Swapping `provider = "postgresql"` to `"sqlite"` yields a schema `prisma validate` accepts.
2. `prisma migrate diff --from-empty --to-schema <file> --script` emits 236 lines of clean SQLite DDL, 10 tables, **zero** `CHECK` constraints.
3. The adapter's export is **`PrismaBetterSqlite3`** — not `PrismaBetterSQLite3`. The wrong spelling fails as `is not a constructor`.
4. **`"kind" TEXT NOT NULL,` appears three times** in the generated DDL (`Transaction`, `Recurrence`, `SystemCategorizationRule`). Injection must be per-table.
5. A generator's `output` resolves relative to the schema file, and the generated client must live inside the workspace — it imports `@prisma/client/runtime/client`.
6. End to end, a `.db` built from the injected DDL and driven through Prisma + the adapter created a `User` (default `chartDateMode` applied) and a `Transaction` (`amountCents: 15045`), and the injected `CHECK` rejected `kind: 'GARBAGE'`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/api/src/prisma/check-constraints.ts` | The 14 constraint definitions — single source of truth |
| `apps/api/src/prisma/check-constraints.spec.ts` | Asserts the definitions match the PostgreSQL migration |
| `apps/api/scripts/generate-sqlite-schema.ts` | Derives `schema.sqlite.prisma` |
| `apps/api/scripts/inject-check-constraints.ts` | Table-scoped `CHECK` injection into generated DDL |
| `apps/api/src/prisma/inject-check-constraints.spec.ts` | Proves injection targets the right table |
| `apps/api/scripts/assert-schema-parity.ts` | The drift guard |
| `apps/api/prisma/schema.sqlite.prisma` | Generated, committed |
| `apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql` | Generated + injected, committed |

**Modified:**

| File | Change |
|---|---|
| `apps/api/scripts/assert-check-constraints.ts` | Consume the shared module instead of its own list |
| `apps/api/package.json` | Script entries |
| `.github/workflows/ci.yml` | Run the drift guard |

---

## Task 1: Shared constraint definitions

Three copies of this list exist or would exist: the PostgreSQL migration SQL, `assert-check-constraints.ts`, and the injector. Two too many for something the domain's runtime safety depends on.

**Files:**
- Create: `apps/api/src/prisma/check-constraints.ts`, `apps/api/src/prisma/check-constraints.spec.ts`
- Modify: `apps/api/scripts/assert-check-constraints.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CHECK_CONSTRAINTS: readonly CheckConstraint[]` where `CheckConstraint = { name: string; table: string; column: string; values: readonly string[]; nullable: boolean }`, and `checkConstraintNames(): string[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/prisma/check-constraints.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wimm/api test check-constraints`
Expected: FAIL — `Cannot find module './check-constraints'`.

- [ ] **Step 3: Write the module**

Create `apps/api/src/prisma/check-constraints.ts`:

```ts
/**
 * The CHECK constraints guarding the columns that were PostgreSQL enums before
 * phase 0. Single source of truth, consumed by:
 *   - scripts/assert-check-constraints.ts  (asserts PostgreSQL still has them)
 *   - scripts/inject-check-constraints.ts  (writes them into SQLite DDL)
 *   - scripts/assert-schema-parity.ts      (drift guard)
 *
 * These are the runtime guarantee behind every `string`-typed enum column in
 * apps/api. Changing a value here is a data migration, never a rename.
 */
export type CheckConstraint = {
  name: string
  table: string
  column: string
  values: readonly string[]
  /** Only User.subscriptionPlan; its CHECK must permit NULL. */
  nullable: boolean
}

export const CHECK_CONSTRAINTS: readonly CheckConstraint[] = [
  { name: 'User_chartDateMode_check', table: 'User', column: 'chartDateMode', values: ['BILLING_CYCLE', 'PURCHASE_DATE'], nullable: false },
  { name: 'User_subscriptionStatus_check', table: 'User', column: 'subscriptionStatus', values: ['ACTIVE', 'TRIALING', 'EXPIRED', 'CANCELED'], nullable: false },
  { name: 'User_subscriptionPlan_check', table: 'User', column: 'subscriptionPlan', values: ['MONTHLY', 'ANNUAL', 'LIFETIME'], nullable: true },
  { name: 'User_aiCategorizationMode_check', table: 'User', column: 'aiCategorizationMode', values: ['OFF', 'SERVER', 'BYOK'], nullable: false },
  { name: 'Source_type_check', table: 'Source', column: 'type', values: ['BANK_ACCOUNT', 'CREDIT_CARD', 'CASH', 'MANUAL'], nullable: false },
  { name: 'Category_type_check', table: 'Category', column: 'type', values: ['INCOME', 'EXPENSE'], nullable: false },
  { name: 'SystemCategorizationRule_kind_check', table: 'SystemCategorizationRule', column: 'kind', values: ['INCOME', 'EXPENSE'], nullable: false },
  { name: 'CategorizationRule_matchType_check', table: 'CategorizationRule', column: 'matchType', values: ['CONTAINS', 'EQUALS'], nullable: false },
  { name: 'ImportBatch_format_check', table: 'ImportBatch', column: 'format', values: ['CSV', 'OFX', 'PDF_BANRISUL_CC', 'PDF_CRESOL_STATEMENT'], nullable: false },
  { name: 'ImportBatch_status_check', table: 'ImportBatch', column: 'status', values: ['COMPLETED'], nullable: false },
  { name: 'Recurrence_kind_check', table: 'Recurrence', column: 'kind', values: ['INCOME', 'EXPENSE'], nullable: false },
  { name: 'Recurrence_frequency_check', table: 'Recurrence', column: 'frequency', values: ['WEEKLY', 'MONTHLY', 'YEARLY'], nullable: false },
  { name: 'Recurrence_endMode_check', table: 'Recurrence', column: 'endMode', values: ['INDEFINITE', 'UNTIL_DATE'], nullable: false },
  { name: 'Transaction_kind_check', table: 'Transaction', column: 'kind', values: ['INCOME', 'EXPENSE'], nullable: false },
] as const

export function checkConstraintNames(): string[] {
  return CHECK_CONSTRAINTS.map((c) => c.name).sort()
}
```

- [ ] **Step 4: Refactor the assertion script to consume it**

In `apps/api/scripts/assert-check-constraints.ts`, delete the local `EXPECTED` array and import instead:

```ts
import { checkConstraintNames } from '../src/prisma/check-constraints'
```

Replace every use of `EXPECTED` with `const EXPECTED = checkConstraintNames()` computed once at the top of `main()`. Leave the failure message, the `convalidated` handling, and the exit-code structure exactly as they are — those were reviewed and are correct.

- [ ] **Step 5: Verify both**

Run: `pnpm --filter @wimm/api test check-constraints && pnpm --filter @wimm/api run assert:constraints`
Expected: tests pass; the script still reports `All 14 CHECK constraints present and validated.`

Then the full suite: `pnpm --filter @wimm/api test` — expect 246 + 4 = 250.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/prisma apps/api/scripts
git commit -m "refactor(database): make check constraint definitions a single source of truth"
```

---

## Task 2: Generate the SQLite schema

**Files:**
- Create: `apps/api/scripts/generate-sqlite-schema.ts`, `apps/api/prisma/schema.sqlite.prisma`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `apps/api/prisma/schema.prisma`.
- Produces: `apps/api/prisma/schema.sqlite.prisma` (committed) and the script `pnpm --filter @wimm/api run gen:sqlite-schema`.

**Correction to the spec:** the transform rewrites **two** lines, not one. The `datasource` provider *and* the generator's `output` — otherwise both schemas generate into `src/generated/prisma` and clobber each other.

- [ ] **Step 1: Write the script**

Create `apps/api/scripts/generate-sqlite-schema.ts`:

```ts
/**
 * Derive prisma/schema.sqlite.prisma from prisma/schema.prisma.
 *
 * Phase 0 made the datamodel dialect-portable, so the only differences are the
 * datasource provider and the generator output path (the two clients must not
 * write to the same directory). Deriving rather than maintaining means the two
 * schemas cannot drift; assert-schema-parity.ts enforces that the committed file
 * matches what this script produces.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const PRISMA_DIR = join(__dirname, '../prisma')
const SOURCE = join(PRISMA_DIR, 'schema.prisma')
const TARGET = join(PRISMA_DIR, 'schema.sqlite.prisma')

const HEADER = `// GENERATED FILE — do not edit.
// Produced by scripts/generate-sqlite-schema.ts from schema.prisma.
// Run: pnpm --filter @wimm/api run gen:sqlite-schema
`

export function deriveSqliteSchema(source: string): string {
  let out = source
  const before = out

  out = out.replace(/provider = "postgresql"/, 'provider = "sqlite"')
  if (out === before) throw new Error('datasource provider "postgresql" not found')

  const afterProvider = out
  out = out.replace(
    /output( *)= "\.\.\/src\/generated\/prisma"/,
    'output$1= "../src/generated/prisma-sqlite"',
  )
  if (out === afterProvider) throw new Error('generator output path not found')

  return HEADER + out
}

function main(): void {
  writeFileSync(TARGET, deriveSqliteSchema(readFileSync(SOURCE, 'utf8')), 'utf8')
  console.log(`Wrote ${TARGET}`)
}

main()
```

- [ ] **Step 2: Add the package script**

In `apps/api/package.json` scripts, next to `assert:constraints`:

```json
    "gen:sqlite-schema": "tsx scripts/generate-sqlite-schema.ts",
```

- [ ] **Step 3: Generate and validate**

Run:

```bash
pnpm --filter @wimm/api run gen:sqlite-schema
pnpm --filter @wimm/api exec prisma validate --schema prisma/schema.sqlite.prisma
```

Expected: the file is written, and Prisma reports it valid.

Then confirm the derivation is exactly two lines plus the header:

```bash
diff <(tail -n +4 apps/api/prisma/schema.sqlite.prisma) apps/api/prisma/schema.prisma
```

Expected: exactly two differing lines — the provider and the output. If more differ, the transform is doing something unintended; stop and report.

- [ ] **Step 4: Generate the second client and prove it works**

Run:

```bash
pnpm --filter @wimm/api exec prisma generate --schema prisma/schema.sqlite.prisma
ls apps/api/src/generated/prisma-sqlite/client.ts
```

Expected: the client exists. It is gitignored, like the PostgreSQL one.

Confirm the existing client was not clobbered:

```bash
ls apps/api/src/generated/prisma/client.ts && pnpm --filter @wimm/api test
```

Expected: 250 passing — the PostgreSQL client is intact.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.sqlite.prisma apps/api/scripts/generate-sqlite-schema.ts apps/api/package.json
git commit -m "feat(database): derive the sqlite schema from the postgres schema"
```

---

## Task 3: Table-scoped CHECK injection

The prototype proved this must be per-table: `"kind" TEXT NOT NULL,` appears in three `CREATE TABLE` blocks. A global replace would put `Transaction`'s constraint into `Recurrence` — syntactically valid, semantically wrong, silently.

**Files:**
- Create: `apps/api/scripts/inject-check-constraints.ts`, `apps/api/src/prisma/inject-check-constraints.spec.ts`

**Interfaces:**
- Consumes: `CHECK_CONSTRAINTS` from Task 1.
- Produces: `injectCheckConstraints(ddl: string): string`, exported for testing and used by the script's CLI entry.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/prisma/inject-check-constraints.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wimm/api test inject-check-constraints`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the injector**

Create `apps/api/scripts/inject-check-constraints.ts`:

```ts
/**
 * Add the CHECK constraints to generated SQLite DDL.
 *
 * Prisma does not model CHECK, and SQLite has no ALTER TABLE ADD CONSTRAINT —
 * a constraint must exist when the table is created. So the generated DDL is
 * post-processed here.
 *
 * Injection is scoped to each CREATE TABLE block on purpose: `"kind" TEXT NOT
 * NULL` appears in three tables, and a global replace would put one table's
 * constraint into another — valid SQL, wrong meaning, no error.
 */
import { readFileSync, writeFileSync } from 'fs'
import { CHECK_CONSTRAINTS, type CheckConstraint } from '../src/prisma/check-constraints'

function renderCheck(c: CheckConstraint): string {
  const list = c.values.map((v) => `'${v}'`).join(', ')
  const test = `"${c.column}" IN (${list})`
  return c.nullable ? `CHECK ("${c.column}" IS NULL OR ${test})` : `CHECK (${test})`
}

export function injectCheckConstraints(ddl: string): string {
  return CHECK_CONSTRAINTS.reduce((acc, c) => {
    const block = new RegExp(`(CREATE TABLE "${c.table}" \\([\\s\\S]*?\\n\\);)`)
    const m = block.exec(acc)
    if (!m) throw new Error(`No CREATE TABLE block for "${c.table}"`)

    const original = m[1]
    if (original.includes(renderCheck(c))) return acc // idempotent

    const column = new RegExp(`(\\n    "${c.column}"[^,\\n]*)`)
    if (!column.test(original)) {
      throw new Error(`Table "${c.table}" has no column "${c.column}" to constrain`)
    }

    return acc.replace(original, original.replace(column, `$1 ${renderCheck(c)}`))
  }, ddl)
}

function main(): void {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: inject-check-constraints <migration.sql>')
    process.exit(1)
  }
  const injected = injectCheckConstraints(readFileSync(file, 'utf8'))
  writeFileSync(file, injected, 'utf8')
  console.log(`Injected ${CHECK_CONSTRAINTS.length} CHECK constraints into ${file}`)
}

if (require.main === module) main()
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @wimm/api test inject-check-constraints`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/inject-check-constraints.ts apps/api/src/prisma/inject-check-constraints.spec.ts
git commit -m "feat(database): inject check constraints into generated sqlite ddl"
```

---

## Task 4: The SQLite baseline migration

**Files:**
- Create: `apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `schema.sqlite.prisma` (Task 2), `injectCheckConstraints` (Task 3).
- Produces: a committed baseline, and `pnpm --filter @wimm/api run gen:sqlite-baseline`.

- [ ] **Step 1: Add the generation script entry**

In `apps/api/package.json`:

```json
    "gen:sqlite-baseline": "mkdir -p prisma/migrations-sqlite/0000_baseline && prisma migrate diff --from-empty --to-schema prisma/schema.sqlite.prisma --script > prisma/migrations-sqlite/0000_baseline/migration.sql && tsx scripts/inject-check-constraints.ts prisma/migrations-sqlite/0000_baseline/migration.sql",
```

**Note the `2>` behaviour:** `prisma migrate diff` writes progress to stderr. Redirecting only stdout is correct — do **not** use `2>&1`, which contaminates the SQL file with CLI text. This was observed during prototyping.

- [ ] **Step 2: Generate the baseline**

Run: `pnpm --filter @wimm/api run gen:sqlite-baseline`

Then verify:

```bash
head -2 apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql
grep -c "CREATE TABLE" apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql
grep -c "CHECK" apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql
```

Expected: the file starts with `-- CreateTable` (not CLI noise), 10 tables, 14 `CHECK`.

- [ ] **Step 3: Prove the baseline actually builds a working database**

This is the step that matters. Write a throwaway script, run it, then delete it:

```ts
// apps/api/__baseline-check.ts
import Database from 'better-sqlite3'
import { readFileSync, rmSync } from 'fs'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma-sqlite/client'

async function main() {
  const file = '/tmp/wimm-baseline-check.db'
  rmSync(file, { force: true })
  const raw = new Database(file)
  raw.exec(readFileSync('prisma/migrations-sqlite/0000_baseline/migration.sql', 'utf8'))
  raw.close()

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) })
  const u = await prisma.user.create({ data: { email: 'a@b.c', username: 'probe', passwordHash: 'x' } })
  console.log('user default chartDateMode:', u.chartDateMode)
  await prisma.transaction.create({
    data: { userId: u.id, kind: 'EXPENSE', amountCents: 15045, description: 'p', occurredAt: new Date() },
  })
  let rejected = false
  try {
    await prisma.transaction.create({
      data: { userId: u.id, kind: 'GARBAGE', amountCents: 1, description: 'b', occurredAt: new Date() },
    })
  } catch { rejected = true }
  console.log('CHECK rejected bad kind:', rejected)
  await prisma.$disconnect()
  rmSync(file, { force: true })
  if (!rejected) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

Run from `apps/api`: `pnpm exec tsx ./__baseline-check.ts`, then `rm ./__baseline-check.ts`.

Expected output: `user default chartDateMode: BILLING_CYCLE` and `CHECK rejected bad kind: true`.

Report both lines. If the `CHECK` does not reject, **stop** — the injector produced syntactically valid but non-enforcing SQL, and everything downstream is built on sand.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/migrations-sqlite apps/api/package.json
git commit -m "feat(database): add the sqlite baseline migration with check constraints"
```

---

## Task 5: The drift guard

Three ways this can rot, all with the same cause — someone changed the schema and updated one side.

**Files:**
- Create: `apps/api/scripts/assert-schema-parity.ts`
- Modify: `apps/api/package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `deriveSqliteSchema` (Task 2), `CHECK_CONSTRAINTS` (Task 1), the committed schema and baseline.
- Produces: `pnpm --filter @wimm/api run assert:parity`, exit 0 or 1.

- [ ] **Step 1: Write the guard**

Create `apps/api/scripts/assert-schema-parity.ts`. It must check, and report each independently rather than stopping at the first failure:

1. **Derived schema is current** — `deriveSqliteSchema(read(schema.prisma))` equals the committed `schema.sqlite.prisma`, byte for byte.
2. **Baseline carries every constraint** — for each entry in `CHECK_CONSTRAINTS`, its rendered `CHECK` text appears inside that table's `CREATE TABLE` block in the committed baseline.
3. **Baseline is current** — regenerating the DDL from `schema.sqlite.prisma` and injecting produces the committed baseline byte for byte.

Failure output must name which of the three failed and the exact command that fixes it (`pnpm --filter @wimm/api run gen:sqlite-schema`, or `gen:sqlite-baseline`). Exit 1 if any check fails; disconnect nothing — this guard touches no database.

Add to `apps/api/package.json`:

```json
    "assert:parity": "tsx scripts/assert-schema-parity.ts",
```

- [ ] **Step 2: Verify it passes on the current tree**

Run: `pnpm --filter @wimm/api run assert:parity`
Expected: exit 0, reporting all three checks passed.

- [ ] **Step 3: Prove each of the three can fail**

A guard that has never failed is a comment. Test all three, restoring after each:

1. Append a blank line to `prisma/schema.sqlite.prisma` → check 1 fails → `git checkout` the file.
2. Delete one `CHECK (` occurrence from the baseline → check 2 fails → `git checkout` the file.
3. Add a nullable `String?` field to a model in `schema.prisma`, run `gen:sqlite-schema` only (not the baseline) → check 3 fails → `git checkout` both files.

Report the failure message from each. Confirm `git status` is clean afterwards.

- [ ] **Step 4: Wire it into CI**

In `.github/workflows/ci.yml`, add after the `Build` step (the SQLite client must exist, and `Build` produces it) and before `Test`:

```yaml
      - name: Check schema parity
        run: pnpm --filter @wimm/api run assert:parity
```

Also add SQLite client generation to the API build so CI has it — in `apps/api/package.json`, the `build` script currently starts with `prisma generate`. Append the second generation:

```
prisma generate && prisma generate --schema prisma/schema.sqlite.prisma && ...
```

- [ ] **Step 5: Prove the CI sequence works from a clean state**

The lesson from the last CI defect: local runs pass because build products already exist. Prove it without them, and **use `--force` so Turbo's cache cannot silently skip the work**:

```bash
rm -rf apps/api/src/generated
pnpm build --force && pnpm lint --force && pnpm --filter @wimm/api run assert:parity && pnpm --filter @wimm/api test
```

Expected: every step exits 0, and `apps/api/src/generated/prisma-sqlite/` exists afterwards. Report the exit codes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/assert-schema-parity.ts apps/api/package.json .github/workflows/ci.yml
git commit -m "feat(workspace): guard schema and baseline parity in ci"
```

---

## Task 6: Verification

- [ ] **Step 1: Clients untouched**

```bash
git diff --stat 513df95..HEAD -- apps/desktop apps/mobile
```

Expected: no output.

- [ ] **Step 2: No behavior changed**

```bash
git diff --stat 513df95..HEAD -- apps/api/src | grep -v "src/prisma" || echo "only src/prisma touched"
```

Expected: only `src/prisma` appears. This phase adds artifacts and guards; it changes no service.

- [ ] **Step 3: Full workspace**

Run: `pnpm build --force && pnpm lint --force && pnpm --filter @wimm/shared test && pnpm --filter @wimm/api test && pnpm --filter @wimm/api run assert:constraints && pnpm --filter @wimm/api run assert:parity`

Expected: all green. API suite at 246 + 4 + 6 = 256.

---

## Exit criteria

- `schema.sqlite.prisma` is committed, validates, and differs from `schema.prisma` by exactly the provider and the generator output.
- The SQLite baseline is committed, creates 10 tables, and carries all 14 `CHECK` constraints.
- A database built from that baseline enforces the constraints through Prisma — proven, not assumed.
- `assert:parity` passes, and each of its three checks was observed failing.
- The `CHECK` list exists in exactly one place in TypeScript.
- No service code changed; no client touched.
