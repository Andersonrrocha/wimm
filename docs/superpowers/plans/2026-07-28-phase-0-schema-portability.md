# Phase 0 — Schema Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Prisma schema portable across PostgreSQL and SQLite by replacing all 12 enums with `String` and all money `Decimal` fields with integer cents, without changing any client-facing API contract.

**Architecture:** Enum identity moves from Prisma-generated enums to const-object/type pairs exported by `@wimm/shared`, so the 178 existing `Enum.MEMBER` call sites keep compiling and only import lines change. Money changes representation in storage only — `amountCents Int` — while the wire contract stays a two-decimal string. Because services currently return raw Prisma rows and rely on `Prisma.Decimal.toJSON()` to produce that string, explicit DTO mappers are introduced *before* the storage change so the wire format is pinned by tests first. The storage swap then uses expand/contract, because the hosted database holds real financial history.

**Tech Stack:** TypeScript 5.5, NestJS 10, Prisma 7.7 (`prisma-client` generator, driver adapters), PostgreSQL, Jest 30 (api) / Jest 29 (shared), pnpm workspaces, Turbo.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scopes are domain-based. This plan uses `shared`, `api`, `transactions`, `recurrences`, `reports`, and `database`.
- **The public API contract must not change.** `Transaction.amount`, `Recurrence.amount`, and `ImportPreviewRow.amount` stay `string` (two decimals). `CommitImportRow.amount` stays `number`. No desktop or mobile change is permitted by this plan.
- **Transaction fingerprints must remain byte-identical.** `computeImportFingerprint` and `computeProjectedInstallmentFingerprint` feed deduplication; any drift silently duplicates every user's re-imported history.
- Services must not return raw Prisma rows (`CLAUDE.md`). Task 6 fixes the existing violations this plan depends on.
- Prisma models have no `@@map`, so PostgreSQL table names are the model names verbatim and require double quotes in raw SQL (`"Transaction"`).
- `@wimm/shared` must be rebuilt before API typechecks or tests resolve new exports: `pnpm --filter @wimm/shared run build`.
- Migration directories are timestamped and must sort after `20260714120000_system_rules_shell_diagnostica`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `packages/shared/src/enums.ts` | Const-object + type pairs for all 12 domain enums |
| `packages/shared/src/enums.spec.ts` | Asserts every const value matches the database-persisted literal |
| `packages/shared/src/money.ts` | `toCents` / `fromCents` conversion between wire decimals and stored cents |
| `packages/shared/src/money.spec.ts` | Rounding, sign, and float-hazard coverage |
| `apps/api/src/imports/fingerprint.spec.ts` | Golden-hash regression guarding dedupe stability |
| `apps/api/src/transactions/transaction.mapper.ts` | Prisma row to `Transaction` DTO |
| `apps/api/src/transactions/transaction.mapper.spec.ts` | Pins the wire shape, `amount` included |
| `apps/api/src/recurrences/recurrence.mapper.ts` | Prisma row to `Recurrence` DTO |
| `apps/api/src/recurrences/recurrence.mapper.spec.ts` | Pins the wire shape |
| `apps/api/prisma/migrations/20260729120000_enums_to_text/migration.sql` | Enum columns to `TEXT` with `CHECK` constraints |
| `apps/api/prisma/migrations/20260729130000_add_amount_cents/migration.sql` | Add and backfill cent columns |
| `apps/api/prisma/migrations/20260729140000_drop_amount_decimal/migration.sql` | Drop `Decimal` columns, make cent columns required |

**Modified:**

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | Re-export `./enums` and `./money`; delete the 12 inline union aliases |
| `apps/api/prisma/schema.prisma` | Remove 12 `enum` blocks; 14 fields to `String`; 3 money fields to `Int` |
| 37 files under `apps/api/src` | Enum imports repointed from `@prisma/client` to `@wimm/shared` |
| `apps/api/src/transactions/transactions.service.ts` | Return mapped DTOs; money conversion at persistence boundary |
| `apps/api/src/recurrences/recurrences.service.ts` | Return mapped DTOs; money conversion at persistence boundary |
| `apps/api/src/imports/imports.service.ts` | Money conversion at persistence boundary |
| `apps/api/src/reports/reports.service.ts` | Aggregate over cent columns; format via `fromCents` |
| `apps/api/src/reports/future-commitments.util.ts` | Accumulate integer cents instead of `Prisma.Decimal` |
| `apps/api/src/reports/reports.service.spec.ts` | Mock cent aggregates |
| `apps/api/src/reports/future-commitments.util.spec.ts` | Fixtures in cents |
| `apps/api/src/transactions/transactions.service.spec.ts` | Fixtures in cents |

**Untouched by design:** `apps/desktop`, `apps/mobile`, `apps/api/src/imports/fingerprint.ts`.

---

## Task 1: Const-object enums in `@wimm/shared`

TypeScript declaration merging lets a `const` and a `type` share a name, so `TransactionKind` works as both a value (`TransactionKind.EXPENSE`) and a type (`kind: TransactionKind`). This is what keeps the 178 existing call sites in Task 2 from needing edits.

**Files:**
- Create: `packages/shared/src/enums.ts`
- Create: `packages/shared/src/enums.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: value-and-type exports `ChartDateMode`, `SubscriptionStatus`, `SubscriptionPlan`, `AiCategorizationMode`, `SourceType`, `CategoryType`, `TransactionKind`, `RecurrenceFrequency`, `RecurrenceEndMode`, `CategorizationMatchType`, `ImportBatchFormat`, `ImportBatchStatus`. Each is a const object whose keys equal its values, plus a type alias of the value union.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/enums.spec.ts`:

```ts
import {
  AiCategorizationMode,
  CategorizationMatchType,
  CategoryType,
  ChartDateMode,
  ImportBatchFormat,
  ImportBatchStatus,
  RecurrenceEndMode,
  RecurrenceFrequency,
  SourceType,
  SubscriptionPlan,
  SubscriptionStatus,
  TransactionKind,
} from './enums'

/**
 * These literals are persisted in the database. Changing one is a data
 * migration, never a rename. This test exists to make that impossible by accident.
 */
describe('domain enums', () => {
  it('exposes the persisted literals', () => {
    expect(ChartDateMode).toEqual({
      BILLING_CYCLE: 'BILLING_CYCLE',
      PURCHASE_DATE: 'PURCHASE_DATE',
    })
    expect(SubscriptionStatus).toEqual({
      ACTIVE: 'ACTIVE',
      TRIALING: 'TRIALING',
      EXPIRED: 'EXPIRED',
      CANCELED: 'CANCELED',
    })
    expect(SubscriptionPlan).toEqual({
      MONTHLY: 'MONTHLY',
      ANNUAL: 'ANNUAL',
      LIFETIME: 'LIFETIME',
    })
    expect(AiCategorizationMode).toEqual({
      OFF: 'OFF',
      SERVER: 'SERVER',
      BYOK: 'BYOK',
    })
    expect(SourceType).toEqual({
      BANK_ACCOUNT: 'BANK_ACCOUNT',
      CREDIT_CARD: 'CREDIT_CARD',
      CASH: 'CASH',
      MANUAL: 'MANUAL',
    })
    expect(CategoryType).toEqual({ INCOME: 'INCOME', EXPENSE: 'EXPENSE' })
    expect(TransactionKind).toEqual({ INCOME: 'INCOME', EXPENSE: 'EXPENSE' })
    expect(RecurrenceFrequency).toEqual({
      WEEKLY: 'WEEKLY',
      MONTHLY: 'MONTHLY',
      YEARLY: 'YEARLY',
    })
    expect(RecurrenceEndMode).toEqual({
      INDEFINITE: 'INDEFINITE',
      UNTIL_DATE: 'UNTIL_DATE',
    })
    expect(CategorizationMatchType).toEqual({
      CONTAINS: 'CONTAINS',
      EQUALS: 'EQUALS',
    })
    expect(ImportBatchFormat).toEqual({
      CSV: 'CSV',
      OFX: 'OFX',
      PDF_BANRISUL_CC: 'PDF_BANRISUL_CC',
      PDF_CRESOL_STATEMENT: 'PDF_CRESOL_STATEMENT',
    })
    expect(ImportBatchStatus).toEqual({ COMPLETED: 'COMPLETED' })
  })

  it('uses each key as its own value', () => {
    const all = [
      ChartDateMode,
      SubscriptionStatus,
      SubscriptionPlan,
      AiCategorizationMode,
      SourceType,
      CategoryType,
      TransactionKind,
      RecurrenceFrequency,
      RecurrenceEndMode,
      CategorizationMatchType,
      ImportBatchFormat,
      ImportBatchStatus,
    ]
    for (const e of all) {
      for (const [key, value] of Object.entries(e)) {
        expect(key).toBe(value)
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wimm/shared test`
Expected: FAIL — `Cannot find module './enums'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/enums.ts`:

```ts
/**
 * Domain enums as const objects plus matching type aliases.
 *
 * Declaration merging makes each name usable as a value (`TransactionKind.EXPENSE`)
 * and as a type (`kind: TransactionKind`), which is what lets the API import these
 * in place of Prisma-generated enums without touching call sites.
 *
 * Values are persisted verbatim in the database.
 */

export const ChartDateMode = {
  BILLING_CYCLE: 'BILLING_CYCLE',
  PURCHASE_DATE: 'PURCHASE_DATE',
} as const
export type ChartDateMode = (typeof ChartDateMode)[keyof typeof ChartDateMode]

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  TRIALING: 'TRIALING',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
} as const
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]

export const SubscriptionPlan = {
  MONTHLY: 'MONTHLY',
  ANNUAL: 'ANNUAL',
  LIFETIME: 'LIFETIME',
} as const
export type SubscriptionPlan =
  (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan]

export const AiCategorizationMode = {
  OFF: 'OFF',
  SERVER: 'SERVER',
  BYOK: 'BYOK',
} as const
export type AiCategorizationMode =
  (typeof AiCategorizationMode)[keyof typeof AiCategorizationMode]

export const SourceType = {
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  CREDIT_CARD: 'CREDIT_CARD',
  CASH: 'CASH',
  MANUAL: 'MANUAL',
} as const
export type SourceType = (typeof SourceType)[keyof typeof SourceType]

export const CategoryType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const
export type CategoryType = (typeof CategoryType)[keyof typeof CategoryType]

export const TransactionKind = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const
export type TransactionKind =
  (typeof TransactionKind)[keyof typeof TransactionKind]

export const RecurrenceFrequency = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const
export type RecurrenceFrequency =
  (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency]

export const RecurrenceEndMode = {
  INDEFINITE: 'INDEFINITE',
  UNTIL_DATE: 'UNTIL_DATE',
} as const
export type RecurrenceEndMode =
  (typeof RecurrenceEndMode)[keyof typeof RecurrenceEndMode]

export const CategorizationMatchType = {
  CONTAINS: 'CONTAINS',
  EQUALS: 'EQUALS',
} as const
export type CategorizationMatchType =
  (typeof CategorizationMatchType)[keyof typeof CategorizationMatchType]

export const ImportBatchFormat = {
  CSV: 'CSV',
  OFX: 'OFX',
  PDF_BANRISUL_CC: 'PDF_BANRISUL_CC',
  PDF_CRESOL_STATEMENT: 'PDF_CRESOL_STATEMENT',
} as const
export type ImportBatchFormat =
  (typeof ImportBatchFormat)[keyof typeof ImportBatchFormat]

export const ImportBatchStatus = {
  COMPLETED: 'COMPLETED',
} as const
export type ImportBatchStatus =
  (typeof ImportBatchStatus)[keyof typeof ImportBatchStatus]
```

- [ ] **Step 4: Wire the barrel and remove the old aliases**

In `packages/shared/src/index.ts`, delete these four lines (around line 27):

```ts
export type ChartDateMode = 'BILLING_CYCLE' | 'PURCHASE_DATE'
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'EXPIRED' | 'CANCELED'
export type SubscriptionPlan = 'MONTHLY' | 'ANNUAL' | 'LIFETIME'
export type AiCategorizationMode = 'OFF' | 'SERVER' | 'BYOK'
```

Search the rest of `index.ts` for the remaining eight union aliases (`SourceType`, `CategoryType`, `TransactionKind`, `RecurrenceFrequency`, `RecurrenceEndMode`, `CategorizationMatchType`, `ImportBatchFormat`, `ImportBatchStatus`) and delete each declaration line. Leave every `interface` that *references* them untouched.

Add at the top of `packages/shared/src/index.ts`:

```ts
export * from './enums'
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @wimm/shared test && pnpm --filter @wimm/shared run lint`
Expected: PASS, and `tsc --noEmit` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/enums.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): expose domain enums as const objects"
```

---

## Task 2: Repoint API enum imports to `@wimm/shared`

Pure import rewrite. No behavior change, no value-site edits. This must land before Task 3, because once the schema drops the enum blocks, `@prisma/client` stops exporting these names entirely.

**Files:**
- Modify: 37 files under `apps/api/src` that import from `@prisma/client`

**Interfaces:**
- Consumes: the twelve value-and-type exports from Task 1.
- Produces: no new symbols. After this task, no file under `apps/api/src` imports a domain enum from `@prisma/client`; only `Prisma`, `PrismaClient`, and model types remain imported from there.

- [ ] **Step 1: Build shared so the API can resolve the new exports**

Run: `pnpm --filter @wimm/shared run build`
Expected: exits 0, `packages/shared/dist/enums.d.ts` exists.

- [ ] **Step 2: List every file to change**

Run:

```bash
grep -rlnE "from '@prisma/client'" apps/api/src
```

Expected: 37 paths.

- [ ] **Step 3: Rewrite the imports**

For each file, split its `@prisma/client` import. The domain enums move to `@wimm/shared`; `Prisma` and `PrismaClient` stay.

Example — `apps/api/src/imports/fingerprint.ts` line 2 currently reads:

```ts
import { TransactionKind } from '@prisma/client'
```

becomes:

```ts
import { TransactionKind } from '@wimm/shared'
```

Example — `apps/api/src/reports/future-commitments.util.ts` lines 1–2 currently read:

```ts
import { Prisma, RecurrenceEndMode, TransactionKind } from '@prisma/client'
import type { RecurrenceFrequency } from '@prisma/client'
```

become:

```ts
import { Prisma } from '@prisma/client'
import {
  RecurrenceEndMode,
  TransactionKind,
  type RecurrenceFrequency,
} from '@wimm/shared'
```

The names to move are exactly: `TransactionKind`, `SourceType`, `CategoryType`, `RecurrenceFrequency`, `RecurrenceEndMode`, `CategorizationMatchType`, `ImportBatchFormat`, `ImportBatchStatus`, `ChartDateMode`, `AiCategorizationMode`, `SubscriptionStatus`, `SubscriptionPlan`.

Leave in place: `Prisma`, `PrismaClient`, `SystemCategorizationRule`, and any other model type.

**Do not touch usage sites.** `TransactionKind.EXPENSE` still resolves, because Task 1 exports a const object.

- [ ] **Step 4: Verify no enum import remains**

Run:

```bash
grep -rnE "from '@prisma/client'" apps/api/src | grep -vE "\b(Prisma|PrismaClient|SystemCategorizationRule)\b"
```

Expected: no output.

- [ ] **Step 5: Typecheck and run the full API suite**

Run: `pnpm --filter @wimm/api run lint && pnpm --filter @wimm/api test`
Expected: `tsc --noEmit` clean; all 30 spec files pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "refactor(api): import domain enums from shared instead of prisma client"
```

---

## Task 3: Enums to `TEXT` with `CHECK` constraints

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260729120000_enums_to_text/migration.sql`

**Interfaces:**
- Consumes: nothing at the type level — Task 2 already removed every dependency on generated enums.
- Produces: generated Prisma types for the 14 affected fields become `string`, which the shared union types satisfy.

- [ ] **Step 1: Edit the schema**

Delete all 12 `enum` blocks from `apps/api/prisma/schema.prisma` (including their doc comments).

Change these 14 field declarations to `String`, preserving nullability and defaults:

```prisma
// model User
chartDateMode        String   @default("BILLING_CYCLE")
subscriptionStatus   String   @default("ACTIVE")
subscriptionPlan     String?
aiCategorizationMode String   @default("OFF")

// model Source
type           String

// model Category
type                 String

// model SystemCategorizationRule
kind        String

// model CategorizationRule
matchType   String

// model ImportBatch
format       String
status       String  @default("COMPLETED")

// model Recurrence
kind         String
frequency    String
endMode      String

// model Transaction
kind           String
```

- [ ] **Step 2: Write the migration**

Create `apps/api/prisma/migrations/20260729120000_enums_to_text/migration.sql`:

```sql
-- Enum columns become TEXT so the same schema targets PostgreSQL and SQLite.
-- CHECK constraints preserve the database-level guarantee the enum type provided.
-- Defaults must be dropped before the type change: they carry the old enum type.

ALTER TABLE "User" ALTER COLUMN "chartDateMode" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "chartDateMode" TYPE TEXT USING "chartDateMode"::TEXT;
ALTER TABLE "User" ALTER COLUMN "chartDateMode" SET DEFAULT 'BILLING_CYCLE';
ALTER TABLE "User" ADD CONSTRAINT "User_chartDateMode_check"
  CHECK ("chartDateMode" IN ('BILLING_CYCLE', 'PURCHASE_DATE'));

ALTER TABLE "User" ALTER COLUMN "subscriptionStatus" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "subscriptionStatus" TYPE TEXT USING "subscriptionStatus"::TEXT;
ALTER TABLE "User" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD CONSTRAINT "User_subscriptionStatus_check"
  CHECK ("subscriptionStatus" IN ('ACTIVE', 'TRIALING', 'EXPIRED', 'CANCELED'));

ALTER TABLE "User" ALTER COLUMN "subscriptionPlan" TYPE TEXT USING "subscriptionPlan"::TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_subscriptionPlan_check"
  CHECK ("subscriptionPlan" IS NULL OR "subscriptionPlan" IN ('MONTHLY', 'ANNUAL', 'LIFETIME'));

ALTER TABLE "User" ALTER COLUMN "aiCategorizationMode" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "aiCategorizationMode" TYPE TEXT USING "aiCategorizationMode"::TEXT;
ALTER TABLE "User" ALTER COLUMN "aiCategorizationMode" SET DEFAULT 'OFF';
ALTER TABLE "User" ADD CONSTRAINT "User_aiCategorizationMode_check"
  CHECK ("aiCategorizationMode" IN ('OFF', 'SERVER', 'BYOK'));

ALTER TABLE "Source" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Source" ADD CONSTRAINT "Source_type_check"
  CHECK ("type" IN ('BANK_ACCOUNT', 'CREDIT_CARD', 'CASH', 'MANUAL'));

ALTER TABLE "Category" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Category" ADD CONSTRAINT "Category_type_check"
  CHECK ("type" IN ('INCOME', 'EXPENSE'));

ALTER TABLE "SystemCategorizationRule" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;
ALTER TABLE "SystemCategorizationRule" ADD CONSTRAINT "SystemCategorizationRule_kind_check"
  CHECK ("kind" IN ('INCOME', 'EXPENSE'));

ALTER TABLE "CategorizationRule" ALTER COLUMN "matchType" TYPE TEXT USING "matchType"::TEXT;
ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_matchType_check"
  CHECK ("matchType" IN ('CONTAINS', 'EQUALS'));

ALTER TABLE "ImportBatch" ALTER COLUMN "format" TYPE TEXT USING "format"::TEXT;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_format_check"
  CHECK ("format" IN ('CSV', 'OFX', 'PDF_BANRISUL_CC', 'PDF_CRESOL_STATEMENT'));

ALTER TABLE "ImportBatch" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ImportBatch" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "ImportBatch" ALTER COLUMN "status" SET DEFAULT 'COMPLETED';
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_status_check"
  CHECK ("status" IN ('COMPLETED'));

ALTER TABLE "Recurrence" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_kind_check"
  CHECK ("kind" IN ('INCOME', 'EXPENSE'));

ALTER TABLE "Recurrence" ALTER COLUMN "frequency" TYPE TEXT USING "frequency"::TEXT;
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_frequency_check"
  CHECK ("frequency" IN ('WEEKLY', 'MONTHLY', 'YEARLY'));

ALTER TABLE "Recurrence" ALTER COLUMN "endMode" TYPE TEXT USING "endMode"::TEXT;
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_endMode_check"
  CHECK ("endMode" IN ('INDEFINITE', 'UNTIL_DATE'));

ALTER TABLE "Transaction" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_kind_check"
  CHECK ("kind" IN ('INCOME', 'EXPENSE'));

DROP TYPE "ChartDateMode";
DROP TYPE "SubscriptionStatus";
DROP TYPE "SubscriptionPlan";
DROP TYPE "AiCategorizationMode";
DROP TYPE "SourceType";
DROP TYPE "CategoryType";
DROP TYPE "TransactionKind";
DROP TYPE "RecurrenceFrequency";
DROP TYPE "RecurrenceEndMode";
DROP TYPE "CategorizationMatchType";
DROP TYPE "ImportBatchFormat";
DROP TYPE "ImportBatchStatus";
```

- [ ] **Step 3: Apply the migration and regenerate the client**

Run:

```bash
pnpm db:up
pnpm --filter @wimm/api exec prisma migrate deploy
pnpm --filter @wimm/api exec prisma generate
```

Expected: migration applies cleanly; generation succeeds.

> **Known caveat:** the `CHECK` constraints exist only in migration SQL, not in `schema.prisma`. A later `prisma migrate dev` may report them as drift. Never let `migrate dev` reset this database; use `migrate deploy` against the hosted instance.

- [ ] **Step 4: Typecheck and run the suite**

Run: `pnpm --filter @wimm/api run lint && pnpm --filter @wimm/api test`
Expected: clean typecheck; all specs pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(database): replace enums with text columns and check constraints"
```

---

## Task 4: Money conversion helpers in `@wimm/shared`

`toCents` parses the wire representation digit-by-digit rather than multiplying floats, because `Math.round(1.005 * 100)` yields `100`, not `101`. Number input goes through `toFixed(2)` first, which is precisely what the services already do — so behavior is preserved, not changed.

**Files:**
- Create: `packages/shared/src/money.ts`
- Create: `packages/shared/src/money.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toCents(amount: string | number): number` and `fromCents(cents: number): string`. `fromCents` always returns exactly two decimal places. `toCents` throws `RangeError` on non-finite or unparseable input.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/money.spec.ts`:

```ts
import { fromCents, toCents } from './money'

describe('toCents', () => {
  it('parses decimal strings exactly', () => {
    expect(toCents('0.00')).toBe(0)
    expect(toCents('1.00')).toBe(100)
    expect(toCents('150.45')).toBe(15045)
    expect(toCents('0.01')).toBe(1)
    expect(toCents('-42.50')).toBe(-4250)
  })

  it('accepts fewer than two decimal places', () => {
    expect(toCents('7')).toBe(700)
    expect(toCents('7.5')).toBe(750)
  })

  it('is immune to binary float error on string input', () => {
    // 0.1 + 0.2 === 0.30000000000000004; the string path never multiplies.
    expect(toCents('0.30')).toBe(30)
    expect(toCents('1.005')).toBe(101)
    expect(toCents('2.675')).toBe(268)
  })

  it('rounds number input the way the services already do', () => {
    expect(toCents(150.45)).toBe(15045)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(-42.5)).toBe(-4250)
  })

  it('rejects unusable input', () => {
    expect(() => toCents(Number.NaN)).toThrow(RangeError)
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => toCents('abc')).toThrow(RangeError)
    expect(() => toCents('')).toThrow(RangeError)
  })
})

describe('fromCents', () => {
  it('always renders two decimal places', () => {
    expect(fromCents(0)).toBe('0.00')
    expect(fromCents(1)).toBe('0.01')
    expect(fromCents(100)).toBe('1.00')
    expect(fromCents(15045)).toBe('150.45')
    expect(fromCents(-4250)).toBe('-42.50')
  })

  it('round-trips with toCents', () => {
    for (const cents of [0, 1, 99, 100, 15045, -1, -4250, 999999999]) {
      expect(toCents(fromCents(cents))).toBe(cents)
    }
  })

  it('rejects non-integer input', () => {
    expect(() => fromCents(1.5)).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wimm/shared test money`
Expected: FAIL — `Cannot find module './money'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/money.ts`:

```ts
/**
 * Money crosses the wire as a two-decimal string and is stored as integer cents.
 *
 * String input is parsed digit-by-digit rather than multiplied, because
 * `Math.round(1.005 * 100)` is 100 — binary floating point cannot represent
 * 1.005 exactly. Number input is normalized through `toFixed(2)` first, matching
 * what the services did when money was a Prisma Decimal.
 */

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/

export function toCents(amount: string | number): number {
  const text =
    typeof amount === 'number'
      ? Number.isFinite(amount)
        ? amount.toFixed(2)
        : ''
      : amount.trim()

  const match = DECIMAL_PATTERN.exec(text)
  if (!match) {
    throw new RangeError(`Cannot convert ${JSON.stringify(amount)} to cents`)
  }

  const [, sign, whole, fraction = ''] = match
  const hundredths = Number(`${fraction}00`.slice(0, 2))
  // A third decimal digit rounds the hundredths place, half away from zero.
  const roundsUp = fraction.length > 2 && Number(fraction[2]) >= 5
  const cents = Number(whole) * 100 + hundredths + (roundsUp ? 1 : 0)

  return sign === '-' ? -cents : cents
}

export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Expected integer cents, received ${cents}`)
  }

  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100)
  const fraction = absolute % 100

  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/shared/src/index.ts`, directly below the `export * from './enums'` line added in Task 1:

```ts
export * from './money'
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @wimm/shared test && pnpm --filter @wimm/shared run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/money.ts packages/shared/src/money.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): add integer-cent money conversion helpers"
```

---

## Task 5: Golden-hash regression test for fingerprints

Written **before** any money change so it guards Tasks 7–10. Fingerprints drive deduplication; if a hash shifts, every user re-importing a statement gets duplicates instead of matches, silently.

**Files:**
- Create: `apps/api/src/imports/fingerprint.spec.ts`

**Interfaces:**
- Consumes: `computeImportFingerprint(userId, sourceId, occurredAt, kind, amountAbsolute, description)` and `computeProjectedInstallmentFingerprint(userId, installmentPlanId, installmentCurrent, occurredAt, kind, amountAbsolute)` from `./fingerprint`, both unchanged by this plan.
- Produces: no source symbols. Produces the invariant that later tasks must not break.

- [ ] **Step 1: Write the test with placeholder hashes**

Create `apps/api/src/imports/fingerprint.spec.ts`:

```ts
import {
  computeImportFingerprint,
  computeProjectedInstallmentFingerprint,
  dateKeyUtc,
  normalizeDescription,
} from './fingerprint'

/**
 * Golden hashes. These values are load-bearing: they are stored on every
 * existing Transaction row and are how re-imports are recognized as duplicates.
 * A failure here means deduplication broke for every user, not that the test
 * is stale. Never regenerate these to make the suite green.
 */
describe('fingerprint stability', () => {
  const userId = '3f1b9c72-0000-4000-8000-000000000001'
  const sourceId = '3f1b9c72-0000-4000-8000-000000000002'
  const occurredAt = new Date('2026-03-15T13:45:00.000Z')

  it('computes a stable import fingerprint', () => {
    expect(
      computeImportFingerprint(
        userId,
        sourceId,
        occurredAt,
        'EXPENSE',
        150.45,
        '  Mercado   Central  ',
      ),
    ).toBe('REPLACE_WITH_ACTUAL_HASH_1')
  })

  it('ignores time of day', () => {
    const sameDay = new Date('2026-03-15T23:59:59.999Z')
    expect(
      computeImportFingerprint(userId, sourceId, sameDay, 'EXPENSE', 150.45, 'Mercado Central'),
    ).toBe(
      computeImportFingerprint(userId, sourceId, occurredAt, 'EXPENSE', 150.45, 'Mercado Central'),
    )
  })

  it('treats sign as irrelevant to the amount component', () => {
    expect(
      computeImportFingerprint(userId, sourceId, occurredAt, 'EXPENSE', -150.45, 'Mercado Central'),
    ).toBe(
      computeImportFingerprint(userId, sourceId, occurredAt, 'EXPENSE', 150.45, 'Mercado Central'),
    )
  })

  it('computes a stable projected installment fingerprint', () => {
    expect(
      computeProjectedInstallmentFingerprint(
        userId,
        '3f1b9c72-0000-4000-8000-000000000003',
        2,
        occurredAt,
        'EXPENSE',
        75.2,
      ),
    ).toBe('REPLACE_WITH_ACTUAL_HASH_2')
  })

  it('normalizes descriptions by collapsing whitespace and lowercasing', () => {
    expect(normalizeDescription('  Mercado   Central  ')).toBe('mercado central')
  })

  it('keys dates by UTC calendar day', () => {
    expect(dateKeyUtc(occurredAt)).toBe('2026-03-15')
  })
})
```

- [ ] **Step 2: Run to capture the real hashes**

Run: `pnpm --filter @wimm/api test fingerprint`
Expected: FAIL on the two golden assertions. The failure output prints the received hash for each.

Copy each received hash into the test, replacing `REPLACE_WITH_ACTUAL_HASH_1` and `REPLACE_WITH_ACTUAL_HASH_2`. These are recorded from the current implementation, which is the behavior being frozen.

- [ ] **Step 3: Run again to verify it passes**

Run: `pnpm --filter @wimm/api test fingerprint`
Expected: PASS, 6 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/imports/fingerprint.spec.ts
git commit -m "test(imports): freeze fingerprint hashes against dedupe regressions"
```

---

## Task 6: Explicit DTO mappers for Transaction and Recurrence

**This task is why the plan is safe.** `transactions.service.ts` currently returns raw Prisma rows (`return row` at line 69, `return this.prisma.transaction.create({...})` at line 82). The contract's `amount: string` exists only because `Prisma.Decimal.toJSON()` serializes to a string. Swapping storage to `Int` without a mapper would silently change the wire format from `"150.45"` to `15045` and break both clients.

Introducing the mapper now — while money is still `Decimal` — makes the change behavior-preserving and pins the wire shape with tests. Task 9 then changes only the mapper's internals. This also resolves the existing `CLAUDE.md` violation.

**Files:**
- Create: `apps/api/src/transactions/transaction.mapper.ts`
- Create: `apps/api/src/transactions/transaction.mapper.spec.ts`
- Create: `apps/api/src/recurrences/recurrence.mapper.ts`
- Create: `apps/api/src/recurrences/recurrence.mapper.spec.ts`
- Modify: `apps/api/src/transactions/transactions.service.ts:61,69,82,138`
- Modify: `apps/api/src/recurrences/recurrences.service.ts` (all return paths)

**Interfaces:**
- Consumes: `Transaction` and `Recurrence` DTOs from `@wimm/shared`.
- Produces: `toTransactionDto(row: TransactionRow): Transaction` and `toRecurrenceDto(row: RecurrenceRow): Recurrence`, where `TransactionRow` and `RecurrenceRow` are the Prisma model types. Both convert `Date` to ISO string and `Prisma.Decimal` to a two-decimal string.

- [ ] **Step 1: Write the failing mapper test**

Create `apps/api/src/transactions/transaction.mapper.spec.ts`:

```ts
import { Prisma } from '@prisma/client'
import { toTransactionDto } from './transaction.mapper'

describe('toTransactionDto', () => {
  const row = {
    id: 't-1',
    userId: 'u-1',
    sourceId: 's-1',
    categoryId: 'c-1',
    importBatchId: null,
    recurrenceId: null,
    kind: 'EXPENSE' as const,
    amount: new Prisma.Decimal('150.45'),
    description: 'Mercado Central',
    occurredAt: new Date('2026-03-15T00:00:00.000Z'),
    fingerprint: 'abc',
    billingCycleMonth: 3,
    billingCycleYear: 2026,
    createdAt: new Date('2026-03-16T10:00:00.000Z'),
    updatedAt: new Date('2026-03-16T10:00:00.000Z'),
  }

  it('renders amount as a two-decimal string', () => {
    expect(toTransactionDto(row).amount).toBe('150.45')
  })

  it('renders whole values with trailing zeros', () => {
    expect(toTransactionDto({ ...row, amount: new Prisma.Decimal('7') }).amount).toBe('7.00')
  })

  it('renders dates as ISO strings', () => {
    const dto = toTransactionDto(row)
    expect(dto.occurredAt).toBe('2026-03-15T00:00:00.000Z')
    expect(dto.createdAt).toBe('2026-03-16T10:00:00.000Z')
  })

  it('preserves nullable relations', () => {
    const dto = toTransactionDto({ ...row, categoryId: null, sourceId: null })
    expect(dto.categoryId).toBeNull()
    expect(dto.sourceId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wimm/api test transaction.mapper`
Expected: FAIL — `Cannot find module './transaction.mapper'`.

- [ ] **Step 3: Write the mapper**

Create `apps/api/src/transactions/transaction.mapper.ts`:

```ts
import type { Prisma } from '@prisma/client'
import type { Transaction } from '@wimm/shared'

/**
 * Shape this mapper accepts. Declared structurally rather than importing the
 * Prisma model so the money field can change representation without rippling
 * through call sites.
 */
export type TransactionRow = {
  id: string
  userId: string
  sourceId: string | null
  categoryId: string | null
  importBatchId: string | null
  recurrenceId: string | null
  kind: string
  amount: Prisma.Decimal
  description: string
  occurredAt: Date
  fingerprint: string | null
  billingCycleMonth: number | null
  billingCycleYear: number | null
  createdAt: Date
  updatedAt: Date
}

export function toTransactionDto(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.userId,
    sourceId: row.sourceId,
    categoryId: row.categoryId,
    importBatchId: row.importBatchId,
    recurrenceId: row.recurrenceId,
    kind: row.kind as Transaction['kind'],
    amount: row.amount.toFixed(2),
    description: row.description,
    occurredAt: row.occurredAt.toISOString(),
    fingerprint: row.fingerprint,
    billingCycleMonth: row.billingCycleMonth,
    billingCycleYear: row.billingCycleYear,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
```

If `packages/shared/src/index.ts` declares fields on `Transaction` not listed above, add them to both `TransactionRow` and the returned object. `tsc --noEmit` in Step 6 is the check.

- [ ] **Step 4: Write the recurrence mapper and its test**

Create `apps/api/src/recurrences/recurrence.mapper.spec.ts`, mirroring the transaction test against the `Recurrence` DTO fields declared in `packages/shared/src/index.ts` (`id`, `userId`, `kind`, `amount`, `description`, `sourceId`, `categoryId`, `frequency`, `startDate`, `endMode`, and the remaining fields in that interface):

```ts
import { Prisma } from '@prisma/client'
import { toRecurrenceDto } from './recurrence.mapper'

describe('toRecurrenceDto', () => {
  const row = {
    id: 'r-1',
    userId: 'u-1',
    kind: 'EXPENSE' as const,
    amount: new Prisma.Decimal('99.90'),
    description: 'Streaming',
    sourceId: 's-1',
    categoryId: 'c-1',
    frequency: 'MONTHLY' as const,
    startDate: new Date('2026-01-10T00:00:00.000Z'),
    endMode: 'INDEFINITE' as const,
    endDate: null,
    createdAt: new Date('2026-01-10T10:00:00.000Z'),
    updatedAt: new Date('2026-01-10T10:00:00.000Z'),
  }

  it('renders amount as a two-decimal string', () => {
    expect(toRecurrenceDto(row).amount).toBe('99.90')
  })

  it('renders dates as ISO strings', () => {
    expect(toRecurrenceDto(row).startDate).toBe('2026-01-10T00:00:00.000Z')
  })

  it('preserves an absent end date', () => {
    expect(toRecurrenceDto(row).endDate).toBeNull()
  })
})
```

Create `apps/api/src/recurrences/recurrence.mapper.ts` following the same structure as `transaction.mapper.ts`: a `RecurrenceRow` type declaring `amount: Prisma.Decimal` plus the other columns, and a `toRecurrenceDto(row: RecurrenceRow): Recurrence` that calls `row.amount.toFixed(2)` and `.toISOString()` on each `Date`.

- [ ] **Step 5: Route every service return through the mappers**

In `apps/api/src/transactions/transactions.service.ts`:

- add `import { toTransactionDto } from './transaction.mapper'`
- line 61 — wrap the list: `return { items: items.map(toTransactionDto), total, page, pageSize }`
- line 69 — `return toTransactionDto(row)`
- line 82 — assign the create result to a local and return it mapped:

```ts
    const created = await this.prisma.transaction.create({
      // ...existing arguments unchanged...
    })
    return toTransactionDto(created)
```

- line 138 — same treatment for `this.prisma.transaction.update({...})`

Apply the equivalent change to every return path in `apps/api/src/recurrences/recurrences.service.ts`, including the list projection at line 254 that currently forwards `amount: rec.amount`.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `pnpm --filter @wimm/api run lint && pnpm --filter @wimm/api test`
Expected: clean typecheck. `transactions.service.spec.ts` may now fail because it asserts on raw rows — update its expectations to the mapped DTO shape (`amount: '10.50'` where it previously expected `new Prisma.Decimal(10.5)`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/transactions apps/api/src/recurrences
git commit -m "refactor(transactions): map prisma rows to shared dtos before returning"
```

---

## Task 7: Expand — add cent columns and dual-write

Adds the new columns alongside the old ones and writes both. Reads still come from `amount`, so the application stays correct at every point. This shape matters because the hosted database holds real financial history.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260729130000_add_amount_cents/migration.sql`
- Modify: `apps/api/src/transactions/transactions.service.ts:86,122`
- Modify: `apps/api/src/recurrences/recurrences.service.ts:77,129`
- Modify: `apps/api/src/imports/imports.service.ts:443,482,494,544`

**Interfaces:**
- Consumes: `toCents` from `@wimm/shared` (Task 4).
- Produces: nullable `amountCents: number | null` on `Transaction` and `Recurrence`, and `amountEachCents: number | null` on `InstallmentPlan`, populated for every row.

- [ ] **Step 1: Add the columns to the schema**

In `apps/api/prisma/schema.prisma`, add a nullable sibling next to each money field, leaving the existing field in place:

```prisma
// model InstallmentPlan (near line 222)
amountEach         Decimal       @db.Decimal(14, 2)
amountEachCents    Int?

// model Recurrence (near line 236)
amount       Decimal              @db.Decimal(14, 2)
amountCents  Int?

// model Transaction (near line 273)
amount         Decimal           @db.Decimal(14, 2)
amountCents    Int?
```

- [ ] **Step 2: Write the backfill migration**

Create `apps/api/prisma/migrations/20260729130000_add_amount_cents/migration.sql`:

```sql
-- Expand step: add integer-cent columns and backfill from the Decimal source.
-- Decimal(14,2) * 100 is exact in PostgreSQL numeric arithmetic, so ROUND is
-- defensive rather than lossy.

ALTER TABLE "Transaction" ADD COLUMN "amountCents" INTEGER;
UPDATE "Transaction" SET "amountCents" = ROUND("amount" * 100)::INTEGER;

ALTER TABLE "Recurrence" ADD COLUMN "amountCents" INTEGER;
UPDATE "Recurrence" SET "amountCents" = ROUND("amount" * 100)::INTEGER;

ALTER TABLE "InstallmentPlan" ADD COLUMN "amountEachCents" INTEGER;
UPDATE "InstallmentPlan" SET "amountEachCents" = ROUND("amountEach" * 100)::INTEGER;
```

- [ ] **Step 3: Apply and regenerate**

Run:

```bash
pnpm --filter @wimm/api exec prisma migrate deploy
pnpm --filter @wimm/api exec prisma generate
```

Expected: applies cleanly.

- [ ] **Step 4: Dual-write in `transactions.service.ts`**

Add `import { toCents } from '@wimm/shared'` at the top.

Line 86 currently reads:

```ts
        amount: new Prisma.Decimal(dto.amount),
```

becomes:

```ts
        amount: new Prisma.Decimal(dto.amount),
        amountCents: toCents(dto.amount),
```

Line 122 currently reads:

```ts
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount)
```

becomes:

```ts
    if (dto.amount !== undefined) {
      data.amount = new Prisma.Decimal(dto.amount)
      data.amountCents = toCents(dto.amount)
    }
```

- [ ] **Step 5: Dual-write in `recurrences.service.ts`**

Add `import { toCents } from '@wimm/shared'` at the top.

Line 77:

```ts
        amount: new Prisma.Decimal(dto.amount.toFixed(2)),
```

becomes:

```ts
        amount: new Prisma.Decimal(dto.amount.toFixed(2)),
        amountCents: toCents(dto.amount),
```

Line 129:

```ts
      data.amount = new Prisma.Decimal(dto.amount.toFixed(2))
```

becomes:

```ts
      data.amount = new Prisma.Decimal(dto.amount.toFixed(2))
      data.amountCents = toCents(dto.amount)
```

- [ ] **Step 6: Dual-write in `imports.service.ts`**

Add `import { toCents } from '@wimm/shared'` at the top.

Lines 443, 494, and 544 each currently read:

```ts
              amount: new Prisma.Decimal(row.amount.toFixed(2)),
```

Add a sibling line immediately after each:

```ts
              amountCents: toCents(row.amount),
```

Line 482:

```ts
              amountEach: new Prisma.Decimal(row.amount.toFixed(2)),
```

becomes:

```ts
              amountEach: new Prisma.Decimal(row.amount.toFixed(2)),
              amountEachCents: toCents(row.amount),
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `pnpm --filter @wimm/shared run build && pnpm --filter @wimm/api run lint && pnpm --filter @wimm/api test`
Expected: clean typecheck; all specs pass, including the Task 5 fingerprint hashes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/src
git commit -m "feat(database): add integer-cent columns and dual-write money"
```

---

## Task 8: Reports module reads integer cents

`future-commitments.util.ts` and `reports.service.ts` change together because the util's return type is consumed directly by the service — splitting them would leave the build red.

**Files:**
- Modify: `apps/api/src/reports/future-commitments.util.ts:1,19,59,61-62,101,103,114`
- Modify: `apps/api/src/reports/reports.service.ts:12,86,90,94-96,112,118,163,168,189,258,262,266-268,314,373,379,395-396,410`
- Modify: `apps/api/src/reports/future-commitments.util.spec.ts:12,42,71`
- Modify: `apps/api/src/reports/reports.service.spec.ts:36,39,78`

**Interfaces:**
- Consumes: `fromCents` from `@wimm/shared`; the cent columns from Task 7.
- Produces: `RecurrenceRowForForecast.amountCents: number` and `sumRecurrenceCommitmentsInUtcMonth(...): { recurringExpenseCents: number; recurringIncomeCents: number }`. All report DTO fields keep their existing `string` type.

- [ ] **Step 1: Update the util fixtures so the test fails first**

In `apps/api/src/reports/future-commitments.util.spec.ts`, replace each fixture amount (lines 12, 42, 71):

```ts
        amount: new Prisma.Decimal(50),
```

with:

```ts
        amountCents: 5000,
```

Apply the same shape to lines 42 (`new Prisma.Decimal(100)` becomes `amountCents: 10000`) and 71 (`new Prisma.Decimal(200)` becomes `amountCents: 20000`). Update the assertions in that file to expect `recurringExpenseCents` / `recurringIncomeCents` as plain numbers in cents, and drop the now-unused `Prisma` import.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wimm/api test future-commitments`
Expected: FAIL — the fixture no longer matches `RecurrenceRowForForecast`.

- [ ] **Step 3: Convert the util**

In `apps/api/src/reports/future-commitments.util.ts`:

Line 19, inside `RecurrenceRowForForecast`:

```ts
  amount: Prisma.Decimal
```

becomes:

```ts
  amountCents: number
```

Line 59, the return type:

```ts
): { recurringExpense: Prisma.Decimal; recurringIncome: Prisma.Decimal } {
```

becomes:

```ts
): { recurringExpenseCents: number; recurringIncomeCents: number } {
```

Lines 61–62:

```ts
  let recurringExpense = new Prisma.Decimal(0)
  let recurringIncome = new Prisma.Decimal(0)
```

become:

```ts
  let recurringExpenseCents = 0
  let recurringIncomeCents = 0
```

Lines 100–104:

```ts
        if (rec.kind === TransactionKind.EXPENSE) {
          recurringExpense = recurringExpense.plus(rec.amount)
        } else {
          recurringIncome = recurringIncome.plus(rec.amount)
        }
```

become:

```ts
        if (rec.kind === TransactionKind.EXPENSE) {
          recurringExpenseCents += rec.amountCents
        } else {
          recurringIncomeCents += rec.amountCents
        }
```

Line 114:

```ts
  return { recurringExpense, recurringIncome }
```

becomes:

```ts
  return { recurringExpenseCents, recurringIncomeCents }
```

Remove `Prisma` from the `@prisma/client` import on line 1 if nothing else in the file uses it.

- [ ] **Step 4: Update the reports service spec fixtures**

In `apps/api/src/reports/reports.service.spec.ts`, replace the mocked aggregates:

line 36:

```ts
        _sum: { amount: new Prisma.Decimal(45.5) },
```

becomes:

```ts
        _sum: { amountCents: 4550 },
```

line 39:

```ts
        { sourceId: 's-cc', _sum: { amount: new Prisma.Decimal(45.5) } },
```

becomes:

```ts
        { sourceId: 's-cc', _sum: { amountCents: 4550 } },
```

line 78:

```ts
          return Promise.resolve({ _sum: { amount: new Prisma.Decimal(0) } })
```

becomes:

```ts
          return Promise.resolve({ _sum: { amountCents: 0 } })
```

Leave every asserted output string unchanged — the wire format is not moving.

- [ ] **Step 5: Convert the reports service**

Add `import { fromCents } from '@wimm/shared'` at the top.

Lines 12–15, the formatting helper:

```ts
function toDecimalString(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return '0.00'
  return v.toFixed(2)
}
```

becomes:

```ts
function toDecimalString(cents: number | null | undefined): string {
  return fromCents(cents ?? 0)
}
```

Change every aggregate selector `_sum: { amount: true }` to `_sum: { amountCents: true }` (lines 86, 90, 112, 118, 258, 262, 373, 379), and the `select` at line 314 from `amount: true` to `amountCents: true`.

Lines 94–96:

```ts
    const income = new Prisma.Decimal(incomeAgg._sum.amount ?? 0)
    const expense = new Prisma.Decimal(expenseAgg._sum.amount ?? 0)
    const net = income.minus(expense)
```

become:

```ts
    const income = incomeAgg._sum.amountCents ?? 0
    const expense = expenseAgg._sum.amountCents ?? 0
    const net = income - expense
```

Lines 266–268 carry the identical three lines inside the monthly loop; apply the same replacement there.

Line 163, inside the `RollupEntry` type:

```ts
      total: Prisma.Decimal
```

becomes:

```ts
      total: number
```

Line 168:

```ts
      const raw = new Prisma.Decimal(g._sum.amount ?? 0)
```

becomes:

```ts
      const raw = g._sum.amountCents ?? 0
```

Line 189:

```ts
        entry.total = entry.total.plus(raw)
```

becomes:

```ts
        entry.total += raw
```

Lines 395–396:

```ts
    const cardInstallments = new Prisma.Decimal(cardAgg._sum.amount ?? 0)
    const totalCommittedExpense = recurringExpense.plus(cardInstallments)
```

become:

```ts
    const cardInstallments = cardAgg._sum.amountCents ?? 0
    const totalCommittedExpense = recurringExpenseCents + cardInstallments
```

Update the destructuring of `sumRecurrenceCommitmentsInUtcMonth` in this function to take `recurringExpenseCents` and `recurringIncomeCents`, and update lines 401–402 to pass those to `toDecimalString`.

Line 410:

```ts
          total: toDecimalString(new Prisma.Decimal(g._sum.amount ?? 0)),
```

becomes:

```ts
          total: toDecimalString(g._sum.amountCents ?? 0),
```

- [ ] **Step 6: Typecheck and run the reports suite**

Run: `pnpm --filter @wimm/api run lint && pnpm --filter @wimm/api test reports future-commitments`
Expected: clean typecheck; all report specs pass with unchanged output strings.

If an assertion fails on a rounding boundary, the expected string in the test is the authority — integer cents must reproduce exactly what the `Decimal` path produced.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reports
git commit -m "refactor(reports): aggregate money as integer cents"
```

---

## Task 9: Mappers read integer cents

**Files:**
- Modify: `apps/api/src/transactions/transaction.mapper.ts`
- Modify: `apps/api/src/transactions/transaction.mapper.spec.ts`
- Modify: `apps/api/src/recurrences/recurrence.mapper.ts`
- Modify: `apps/api/src/recurrences/recurrence.mapper.spec.ts`
- Modify: `apps/api/src/recurrences/recurrences.service.ts:190`

**Interfaces:**
- Consumes: `fromCents` from `@wimm/shared`; the cent columns from Task 7.
- Produces: `TransactionRow.amountCents: number` and `RecurrenceRow.amountCents: number`. `toTransactionDto` and `toRecurrenceDto` keep their exact signatures and output — only their input shape changes.

- [ ] **Step 1: Update the mapper tests to feed cents**

In `apps/api/src/transactions/transaction.mapper.spec.ts`, change the fixture:

```ts
    amount: new Prisma.Decimal('150.45'),
```

to:

```ts
    amountCents: 15045,
```

and the whole-value case:

```ts
    expect(toTransactionDto({ ...row, amount: new Prisma.Decimal('7') }).amount).toBe('7.00')
```

to:

```ts
    expect(toTransactionDto({ ...row, amountCents: 700 }).amount).toBe('7.00')
```

Remove the now-unused `Prisma` import. **Every assertion stays identical** — that is the point of the task.

Apply the same change to `recurrence.mapper.spec.ts` (`new Prisma.Decimal('99.90')` becomes `amountCents: 9990`).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wimm/api test mapper`
Expected: FAIL — the fixtures no longer satisfy `TransactionRow` / `RecurrenceRow`.

- [ ] **Step 3: Convert the mappers**

In `apps/api/src/transactions/transaction.mapper.ts`, replace the import of `Prisma` with:

```ts
import { fromCents, type Transaction } from '@wimm/shared'
```

In `TransactionRow`:

```ts
  amount: Prisma.Decimal
```

becomes:

```ts
  amountCents: number
```

In the returned object:

```ts
    amount: row.amount.toFixed(2),
```

becomes:

```ts
    amount: fromCents(row.amountCents),
```

Apply the identical three changes to `apps/api/src/recurrences/recurrence.mapper.ts`.

- [ ] **Step 4: Update the remaining typed read site**

In `apps/api/src/recurrences/recurrences.service.ts`, line 190 declares a local row shape:

```ts
      amount: Prisma.Decimal
```

becomes:

```ts
      amountCents: number
```

Update the surrounding `select` to request `amountCents: true` instead of `amount: true`.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `pnpm --filter @wimm/api run lint && pnpm --filter @wimm/api test`
Expected: clean typecheck; every spec passes, including the Task 5 fingerprint hashes and the Task 6 mapper assertions, which are unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/transactions apps/api/src/recurrences
git commit -m "refactor(transactions): map money from integer cents"
```

---

## Task 10: Contract — drop the Decimal columns

Nothing reads `amount` after Task 9. Run this only once Tasks 8 and 9 have been verified against the hosted database.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260729140000_drop_amount_decimal/migration.sql`
- Modify: `apps/api/src/transactions/transactions.service.ts`, `apps/api/src/recurrences/recurrences.service.ts`, `apps/api/src/imports/imports.service.ts`

**Interfaces:**
- Consumes: the populated cent columns from Task 7.
- Produces: `amountCents: number` (non-nullable) on `Transaction` and `Recurrence`; `amountEachCents: number` on `InstallmentPlan`. `Decimal` and `@db.Decimal` no longer appear anywhere in the schema.

- [ ] **Step 1: Verify the backfill is complete**

Run:

```bash
pnpm --filter @wimm/api exec prisma db execute --stdin <<'SQL'
SELECT
  (SELECT COUNT(*) FROM "Transaction" WHERE "amountCents" IS NULL) AS tx_null,
  (SELECT COUNT(*) FROM "Recurrence" WHERE "amountCents" IS NULL) AS rec_null,
  (SELECT COUNT(*) FROM "InstallmentPlan" WHERE "amountEachCents" IS NULL) AS inst_null;
SQL
```

Expected: all three counts are `0`. If any is non-zero, stop — a write path from Task 7 was missed.

- [ ] **Step 2: Update the schema**

Remove the three `Decimal` fields and make the cent columns required:

```prisma
// model InstallmentPlan
amountEachCents    Int

// model Recurrence
amountCents  Int

// model Transaction
amountCents    Int
```

- [ ] **Step 3: Write the migration**

Create `apps/api/prisma/migrations/20260729140000_drop_amount_decimal/migration.sql`:

```sql
-- Contract step: no code reads the Decimal columns after the mapper switch.

ALTER TABLE "Transaction" ALTER COLUMN "amountCents" SET NOT NULL;
ALTER TABLE "Transaction" DROP COLUMN "amount";

ALTER TABLE "Recurrence" ALTER COLUMN "amountCents" SET NOT NULL;
ALTER TABLE "Recurrence" DROP COLUMN "amount";

ALTER TABLE "InstallmentPlan" ALTER COLUMN "amountEachCents" SET NOT NULL;
ALTER TABLE "InstallmentPlan" DROP COLUMN "amountEach";
```

- [ ] **Step 4: Remove the now-dead dual-writes**

In `transactions.service.ts` (lines 86, 122), `recurrences.service.ts` (lines 77, 129), and `imports.service.ts` (lines 443, 482, 494, 544), delete the `amount:` / `amountEach:` assignments added alongside the cent fields in Task 7, keeping only the `amountCents:` / `amountEachCents:` lines. Remove any `Prisma` import that becomes unused.

- [ ] **Step 5: Apply, regenerate, and verify**

Run:

```bash
pnpm --filter @wimm/api exec prisma migrate deploy
pnpm --filter @wimm/api exec prisma generate
pnpm --filter @wimm/api run lint
pnpm --filter @wimm/api test
```

Expected: migration applies; clean typecheck; all specs pass.

- [ ] **Step 6: Confirm the schema is dialect-portable**

Run:

```bash
grep -nE '@db\.|^enum |Decimal' apps/api/prisma/schema.prisma
```

Expected: no output. This is the phase-0 exit criterion — the only PostgreSQL-specific construct left in the schema is the `datasource` block, which is what Phase 1 generates a SQLite variant from.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src
git commit -m "feat(database): drop decimal money columns in favor of integer cents"
```

---

## Task 11: Workspace verification

Confirms the claim that no client changes were required. If anything here fails, the API contract changed and the failure must be fixed in the API, not in the client.

**Files:** none modified.

**Interfaces:**
- Consumes: the completed workspace.
- Produces: nothing.

- [ ] **Step 1: Confirm no client source changed in this phase**

Run:

```bash
git diff --stat main...HEAD -- apps/desktop apps/mobile
```

Expected: no output.

- [ ] **Step 2: Build and lint the whole workspace**

Run: `pnpm build && pnpm lint`
Expected: both succeed, including the desktop and mobile typechecks against the unchanged `@wimm/shared` contract.

- [ ] **Step 3: Run every test in the workspace**

Run: `pnpm --filter @wimm/shared test && pnpm --filter @wimm/api test`
Expected: all pass.

- [ ] **Step 4: Report any remaining drift**

```bash
git status --short
```

If nothing is listed, the phase is complete with no further commit needed.

---

## Phase exit criteria

- `grep -nE '@db\.|^enum |Decimal' apps/api/prisma/schema.prisma` returns nothing.
- No file under `apps/api/src` imports a domain enum from `@prisma/client`.
- `apps/desktop` and `apps/mobile` are byte-identical to their state at the start of the phase.
- The Task 5 golden hashes pass unchanged.
- The Task 6 mapper assertions pass unchanged after Task 9.
- `pnpm build && pnpm lint` succeed at the repository root.
