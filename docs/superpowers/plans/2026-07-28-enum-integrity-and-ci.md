# Enum Integrity and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make corrupt enum data fail loudly at the read boundary instead of silently producing wrong money or wrong dates, guard the 14 `CHECK` constraints against silent loss, and give the repository its first test CI.

**Architecture:** Recurrence rows are parsed with `parseEnum` at the two points where they leave the database — the forecast query and the materialization query — so the internal row-shape types can go back to narrow union types. `nextOccurrence` then takes `RecurrenceFrequency`, drops its `default:` branch, and gains a `never` exhaustiveness assertion. Separately, a standalone script asserts the 14 constraints exist, invoked by a new GitHub Actions workflow that also runs lint, build, and tests.

**Tech Stack:** TypeScript 5.5, NestJS 10, Prisma 7.7, PostgreSQL 16, Jest 30, pnpm 9 workspaces, Turbo, GitHub Actions.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scopes are domain-based. This plan uses `reports`, `recurrences`, `database`, and `workspace`.
- **No client-facing API contract change.** `apps/desktop` and `apps/mobile` must not be touched.
- **No expected output value in any spec may change.** Input fixtures may change; expectations may not. A moved expectation means a real bug — stop and report it.
- `parseEnum(enumObject, value, fieldName)` from `@wimm/shared` throws `RangeError` naming the field. Use it; never a bare `as` cast.
- Rebuild `@wimm/shared` before typechecking the API: `pnpm --filter @wimm/shared run build`.
- The API test suite stays **unit-only and offline**. No test may require a database.
- Baseline: `@wimm/shared` 28/28 (4 suites), `@wimm/api` 226/226 (33 suites), `tsc --noEmit` clean, `pnpm build` and `pnpm lint` green.
- PostgreSQL is already running locally as container `wimm-postgres`; `DATABASE_URL` points at `wimm_phase0`. Do not run `pnpm db:up`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/api/scripts/assert-check-constraints.ts` | Assert the 14 `CHECK` constraints exist and are validated |
| `.github/workflows/ci.yml` | Lint, build, test, and constraint assertion on push and PR |

**Modified:**

| File | Change |
|---|---|
| `apps/api/src/reports/reports.service.ts` | Parse enums on the forecast `findMany` result |
| `apps/api/src/reports/future-commitments.util.ts` | `RecurrenceRowForForecast` back to narrow types; replace the stale doc comment |
| `apps/api/src/recurrences/recurrences.service.ts` | Parse enums in `materializeForUser`; narrow `materializeOne`'s parameter |
| `apps/api/src/recurrences/recurrence-dates.ts` | `nextOccurrence` takes `RecurrenceFrequency`; drop `default:`; add `never` assertion |
| `apps/api/src/reports/future-commitments.util.spec.ts` | Fixture types only |
| `apps/api/src/recurrences/recurrences.service.spec.ts` | Fixture types only |

---

## Task 1: Parse recurrence enums at both read boundaries

Two boundaries, not one. The forecast path is read-only. The materialization path **writes** — `nextOccurrence` advances the `cursor` that becomes `occurredAt` on rows created by `prisma.transaction.create`, so a corrupt frequency persists real transactions on wrong dates. Both are closed here.

`nextOccurrence` keeps its `frequency: string` parameter in this task. Narrow types are assignable to `string`, so everything compiles and stays green; Task 2 narrows it once both callers already supply narrow values.

**Files:**
- Modify: `apps/api/src/reports/future-commitments.util.ts` (the `RecurrenceRowForForecast` type, lines 16-32)
- Modify: `apps/api/src/reports/reports.service.ts` (the `findMany` at lines 317-329)
- Modify: `apps/api/src/recurrences/recurrences.service.ts` (`materializeForUser` at lines 180-194, `materializeOne`'s parameter at lines ~205-216)
- Modify: `apps/api/src/reports/future-commitments.util.spec.ts`
- Modify: `apps/api/src/recurrences/recurrences.service.spec.ts`

**Interfaces:**
- Consumes: `parseEnum`, `TransactionKind`, `RecurrenceFrequency`, `RecurrenceEndMode` from `@wimm/shared`.
- Produces: `RecurrenceRowForForecast` with `kind: TransactionKind`, `frequency: RecurrenceFrequency`, `endMode: RecurrenceEndMode`; `materializeOne` accepting the same three narrow types.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/reports/future-commitments.util.spec.ts`:

```ts
import { parseEnum, RecurrenceFrequency, TransactionKind } from '@wimm/shared'

describe('recurrence enum parsing at the read boundary', () => {
  it('rejects a corrupt kind instead of counting it as income', () => {
    expect(() => parseEnum(TransactionKind, 'GARBAGE', 'kind')).toThrow(RangeError)
  })

  it('names the offending field and value', () => {
    expect(() => parseEnum(TransactionKind, 'GARBAGE', 'kind')).toThrow(/kind/)
    expect(() => parseEnum(TransactionKind, 'GARBAGE', 'kind')).toThrow(/GARBAGE/)
  })

  it('rejects a corrupt frequency instead of defaulting to monthly', () => {
    expect(() =>
      parseEnum(RecurrenceFrequency, 'FORTNIGHTLY', 'frequency'),
    ).toThrow(RangeError)
  })

  it('passes valid values through unchanged', () => {
    expect(parseEnum(TransactionKind, 'EXPENSE', 'kind')).toBe('EXPENSE')
    expect(parseEnum(RecurrenceFrequency, 'WEEKLY', 'frequency')).toBe('WEEKLY')
  })
})
```

- [ ] **Step 2: Run to verify it passes already**

Run: `pnpm --filter @wimm/api test future-commitments`
Expected: PASS. `parseEnum` already exists and behaves this way — these tests pin the behavior the boundary depends on. They are not the RED step; Step 3's type change is what fails first.

- [ ] **Step 3: Narrow the forecast row type and watch it fail**

In `apps/api/src/reports/future-commitments.util.ts`, replace the doc comment and type at lines 16-32 with:

```ts
/**
 * Shape of a `Recurrence` row as selected for the forecast calculation.
 *
 * `kind`, `frequency`, and `endMode` are the narrow `@wimm/shared` union types,
 * not `string`. Callers parse them with `parseEnum` at the query boundary, so
 * everything below can rely on them. A corrupt value fails there — loudly, naming
 * the field — instead of silently taking an `else` branch or a `default:` case.
 */
export type RecurrenceRowForForecast = {
  id: string
  kind: TransactionKind
  amountCents: number
  frequency: RecurrenceFrequency
  startDate: Date
  endMode: RecurrenceEndMode
  endDate: Date | null
  sourceId: string | null
}
```

Add `RecurrenceFrequency` to the existing `@wimm/shared` import on line 1, which currently reads:

```ts
import { RecurrenceEndMode, TransactionKind } from '@wimm/shared'
```

and becomes:

```ts
import {
  RecurrenceEndMode,
  type RecurrenceFrequency,
  TransactionKind,
} from '@wimm/shared'
```

Run: `pnpm --filter @wimm/api run lint`
Expected: FAIL — `reports.service.ts` passes `string` fields where the narrow types are now required.

- [ ] **Step 4: Parse at the forecast boundary**

In `apps/api/src/reports/reports.service.ts`, the query at lines 317-329 currently reads:

```ts
    const recurrences = await this.prisma.recurrence.findMany({
      where: { userId, active: true },
      select: {
        id: true,
        kind: true,
        amountCents: true,
        frequency: true,
        startDate: true,
        endMode: true,
        endDate: true,
        sourceId: true,
      },
    })
```

Append a mapping step immediately after it:

```ts
    const recurrences = (
      await this.prisma.recurrence.findMany({
        where: { userId, active: true },
        select: {
          id: true,
          kind: true,
          amountCents: true,
          frequency: true,
          startDate: true,
          endMode: true,
          endDate: true,
          sourceId: true,
        },
      })
    ).map((r) => ({
      ...r,
      kind: parseEnum(TransactionKind, r.kind, 'kind'),
      frequency: parseEnum(RecurrenceFrequency, r.frequency, 'frequency'),
      endMode: parseEnum(RecurrenceEndMode, r.endMode, 'endMode'),
    }))
```

Add the needed names to the `@wimm/shared` import at the top of the file (it already imports `fromCents`):

```ts
import {
  fromCents,
  parseEnum,
  RecurrenceEndMode,
  RecurrenceFrequency,
  TransactionKind,
} from '@wimm/shared'
```

- [ ] **Step 5: Narrow the materialization parameter and parse its boundary**

In `apps/api/src/recurrences/recurrences.service.ts`, `materializeOne`'s parameter declares the recurrence row inline (around lines 205-216) with `kind: string`, `frequency: string`, `endMode: string`. Change those three to `TransactionKind`, `RecurrenceFrequency`, and `RecurrenceEndMode`. Delete the stale comment above it that says widening "loses no completeness guarantee" — it is now false.

Then in `materializeForUser` (lines 180-194), both branches must parse. The current code reads:

```ts
    const recs = dto.recurrenceId
      ? [await this.findRowForUser(userId, dto.recurrenceId)]
      : await this.prisma.recurrence.findMany({
          where: { userId, active: true },
        })
```

becomes:

```ts
    const rawRecs = dto.recurrenceId
      ? [await this.findRowForUser(userId, dto.recurrenceId)]
      : await this.prisma.recurrence.findMany({
          where: { userId, active: true },
        })

    // Parse here, not inside materializeOne: this is where rows leave the
    // database. `nextOccurrence` drives the `occurredAt` of transactions this
    // path creates, so a corrupt frequency would persist rows on wrong dates.
    const recs = rawRecs.map((r) => ({
      ...r,
      kind: parseEnum(TransactionKind, r.kind, 'kind'),
      frequency: parseEnum(RecurrenceFrequency, r.frequency, 'frequency'),
      endMode: parseEnum(RecurrenceEndMode, r.endMode, 'endMode'),
    }))
```

Add `parseEnum`, `RecurrenceFrequency`, and `TransactionKind` to the file's existing `@wimm/shared` import (it already imports `RecurrenceEndMode` and `toCents`).

`findRowForUser` itself stays unparsed — `updateForUser` and `deleteForUser` share it and do not need narrow enums.

- [ ] **Step 6: Fix spec fixtures if the compiler asks**

Run: `pnpm --filter @wimm/shared run build && pnpm --filter @wimm/api run lint`
Expected: clean.

`future-commitments.util.spec.ts` already builds fixtures from `TransactionKind.EXPENSE` and `'MONTHLY' as const`, which satisfy the narrow types — it likely needs no change. If `recurrences.service.spec.ts` fixtures fail to typecheck, change only the fixture values (e.g. a bare `'MONTHLY'` string to `'MONTHLY' as const`). **Change no expected value.**

- [ ] **Step 7: Run the full suite**

Run: `pnpm --filter @wimm/api test`
Expected: 226 + 4 new = 230 passing across 33 suites.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/reports apps/api/src/recurrences
git commit -m "fix(recurrences): parse recurrence enums at both read boundaries"
```

---

## Task 2: Make `nextOccurrence` exhaustive

Both callers now supply `RecurrenceFrequency`, so the parameter can be narrowed and the silent `default:` removed.

**Files:**
- Modify: `apps/api/src/recurrences/recurrence-dates.ts` (lines 36-52)

**Interfaces:**
- Consumes: `RecurrenceFrequency` from `@wimm/shared`; narrow values supplied by Task 1's boundary parses.
- Produces: `nextOccurrence(d: Date, frequency: RecurrenceFrequency): Date`. Adding a frequency to the union without handling it here becomes a compile error.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/recurrences/recurrence-dates.spec.ts` (create the file if it does not exist):

```ts
import { addMonthsUtc, addWeeksUtc, addYearsUtc, nextOccurrence } from './recurrence-dates'

describe('nextOccurrence', () => {
  const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0))

  it('advances weekly', () => {
    expect(nextOccurrence(start, 'WEEKLY')).toEqual(addWeeksUtc(start, 1))
  })

  it('advances monthly', () => {
    expect(nextOccurrence(start, 'MONTHLY')).toEqual(addMonthsUtc(start, 1))
  })

  it('advances yearly', () => {
    expect(nextOccurrence(start, 'YEARLY')).toEqual(addYearsUtc(start, 1))
  })

  it('throws rather than silently defaulting on an unknown frequency', () => {
    // Cast is deliberate: the type system forbids this, and the test exists to
    // prove the runtime does too, for data that reaches us from a database
    // without a CHECK constraint (the SQLite build planned for phase 1).
    expect(() =>
      nextOccurrence(start, 'FORTNIGHTLY' as unknown as 'WEEKLY'),
    ).toThrow(/FORTNIGHTLY/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wimm/api test recurrence-dates`
Expected: FAIL on the last test — the current `default:` returns `addMonthsUtc(d, 1)` instead of throwing. The first three pass.

- [ ] **Step 3: Rewrite `nextOccurrence`**

In `apps/api/src/recurrences/recurrence-dates.ts`, replace the doc comment and function at lines 36-52 with:

```ts
/**
 * Advance a date by one recurrence step.
 *
 * The parameter is the narrow `RecurrenceFrequency` union, and the switch is
 * exhaustive with no `default:`. Adding a frequency to the union without
 * handling it here is a compile error. The runtime throw covers values that
 * reach us from a database with no CHECK constraint to reject them.
 */
export function nextOccurrence(d: Date, frequency: RecurrenceFrequency): Date {
  switch (frequency) {
    case 'WEEKLY':
      return addWeeksUtc(d, 1)
    case 'MONTHLY':
      return addMonthsUtc(d, 1)
    case 'YEARLY':
      return addYearsUtc(d, 1)
  }
  const unreachable: never = frequency
  throw new Error(`Unhandled recurrence frequency: ${String(unreachable)}`)
}
```

Add the type import at the top of the file:

```ts
import type { RecurrenceFrequency } from '@wimm/shared'
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @wimm/api test recurrence-dates`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `pnpm --filter @wimm/api run lint && pnpm --filter @wimm/api test`
Expected: clean typecheck; 234 passing across 34 suites.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/recurrences
git commit -m "fix(recurrences): make nextOccurrence exhaustive instead of defaulting to monthly"
```

---

## Task 3: Constraint assertion script

Deliberately not a Jest spec. The API suite is unit-only, fully mocked, and runs offline in about six seconds; a database-dependent test would forfeit that on every local run.

**Files:**
- Create: `apps/api/scripts/assert-check-constraints.ts`
- Modify: `apps/api/package.json` (add a script entry)

**Interfaces:**
- Consumes: `DATABASE_URL` from the environment, via the same client-construction pattern `apps/api/scripts/seed-personal-rules.ts` already uses — `dotenv/config`, `PrismaPg`, and `PrismaClient` imported from `../src/generated/prisma/client`.
- Produces: `pnpm --filter @wimm/api run assert:constraints`. Exit 0 when all 14 constraints exist and are validated; exit 1 with a list of the missing ones otherwise.

**Why not the `pg` client directly:** `pg` is present only as a transitive dependency of `@prisma/adapter-pg`, and `@types/pg` resolves only through pnpm hoisting. Importing it would work today and break the moment the hoist layout changes, and adding it explicitly would mean a new dependency declaration. Reusing the established script pattern avoids both.

- [ ] **Step 1: Write the script**

Create `apps/api/scripts/assert-check-constraints.ts`:

```ts
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

async function main(): Promise<void> {
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
      process.exit(1)
    }

    console.log(`All ${EXPECTED.length} CHECK constraints present and validated.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: Add the package script**

In `apps/api/package.json`, add to `"scripts"`, next to the existing `"seed:personal"` entry:

```json
    "assert:constraints": "tsx scripts/assert-check-constraints.ts",
```

- [ ] **Step 3: Verify it passes against the real database**

Run: `pnpm --filter @wimm/api run assert:constraints`
Expected: `All 14 CHECK constraints present and validated.`, exit 0.

- [ ] **Step 4: Prove it actually fails when a constraint is missing**

A guard that cannot fail is not a guard. Drop one constraint, re-run, restore it:

```bash
docker exec wimm-postgres psql -U user -d wimm_phase0 -c 'ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_kind_check";'
```

Run: `pnpm --filter @wimm/api run assert:constraints`
Expected: exit 1, listing `Transaction_kind_check` under `Missing (1):`.

Restore it:

```bash
docker exec wimm-postgres psql -U user -d wimm_phase0 -c 'ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_kind_check" CHECK ("kind" IN (''INCOME'', ''EXPENSE''));'
```

Run: `pnpm --filter @wimm/api run assert:constraints`
Expected: back to exit 0, all 14 present. Record both outputs in your report.

- [ ] **Step 5: Confirm the unit suite is still offline-clean**

Run: `pnpm --filter @wimm/api test`
Expected: 234 passing. The script must not have been picked up by Jest — `testRegex` is `src/.*\.spec\.ts$` and the script lives in `scripts/`, so it should not be. Confirm the suite count did not change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts apps/api/package.json
git commit -m "feat(database): assert check constraints survive schema regeneration"
```

---

## Task 4: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the root Turbo scripts (`pnpm lint`, `pnpm build`, `pnpm test`) and `pnpm --filter @wimm/api run assert:constraints` from Task 3.
- Produces: a required-status-check candidate on `develop` and `main`.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

jobs:
  verify:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: user
          POSTGRES_PASSWORD: password
          POSTGRES_DB: wimm
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U user -d wimm"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgresql://user:password@localhost:5432/wimm

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # The API typechecks against @wimm/shared's built dist, not its source.
      - name: Build shared package
        run: pnpm --filter @wimm/shared run build

      - name: Lint
        run: pnpm lint

      - name: Build
        run: pnpm build

      - name: Test
        run: pnpm test

      - name: Apply migrations
        run: pnpm --filter @wimm/api exec prisma migrate deploy

      - name: Assert CHECK constraints
        run: pnpm --filter @wimm/api run assert:constraints
```

`pnpm/action-setup` deliberately pins no `version`: `package.json` declares `packageManager: "pnpm@9.0.0"` and the action honours it. The existing `release-desktop.yml` pins `version: 10`, which disagrees with that declaration — left alone here, but worth reconciling separately.

- [ ] **Step 2: Validate the YAML parses**

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');if(!/^name: CI$/m.test(s))throw new Error('name missing');if(!/assert:constraints/.test(s))throw new Error('constraint step missing');console.log('workflow looks structurally sound')"
```

Expected: `workflow looks structurally sound`.

If `yamllint` or `actionlint` is available on this machine, run it and include the output. If not, say so in your report rather than claiming validation you did not perform.

- [ ] **Step 3: Verify the steps run locally in the same order**

The workflow cannot be executed here, so verify its commands do work by running them in sequence against the local environment:

```bash
pnpm --filter @wimm/shared run build && pnpm lint && pnpm build && pnpm test && pnpm --filter @wimm/api run assert:constraints
```

Expected: every step exits 0. This proves the command sequence is correct; only the GitHub-hosted Postgres service remains unverified.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(workspace): add ci workflow running lint, build, tests and constraint guard"
```

---

## Task 5: Verification

**Files:** none modified.

- [ ] **Step 1: Confirm clients untouched**

```bash
git diff --stat 9e1365e..HEAD -- apps/desktop apps/mobile
```

Expected: no output.

- [ ] **Step 2: Full workspace green**

Run: `pnpm build && pnpm lint && pnpm --filter @wimm/shared test && pnpm --filter @wimm/api test`
Expected: all green; api at 234 across 34 suites.

- [ ] **Step 3: Confirm no `default:` fallback remains on a domain enum**

```bash
grep -rn -A1 "^\s*default:" apps/api/src --include='*.ts' | grep -v spec
```

Expected: no output. `recurrence-dates.ts` held the only one.

- [ ] **Step 4: Report**

```bash
git status --short
```

If nothing is listed, the work is complete with no further commit needed.

---

## Exit criteria

- `nextOccurrence` takes `RecurrenceFrequency` and has no `default:` branch.
- Both recurrence read boundaries parse `kind`, `frequency`, and `endMode` with `parseEnum`.
- `pnpm --filter @wimm/api run assert:constraints` passes, and was proven to fail when a constraint is dropped.
- `.github/workflows/ci.yml` exists and its command sequence runs green locally.
- `apps/desktop` and `apps/mobile` unchanged.
- The API test suite still runs offline with no database.
