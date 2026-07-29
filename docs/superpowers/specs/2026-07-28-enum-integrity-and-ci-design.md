# Enum Integrity and CI — Design

**Date:** 2026-07-28
**Status:** Draft, pending review
**Follows:** [Phase 0 — Standalone Local Architecture](2026-07-28-standalone-local-architecture-design.md)

---

## 1. Context

Phase 0 replaced 12 PostgreSQL enums with `TEXT` columns guarded by 14 `CHECK` constraints, and moved enum identity into `@wimm/shared` as const-object/type pairs plus a validating `parseEnum` helper.

To make that change compile, several internal row-shape types were widened from their narrow union types to bare `string`. The justification, recorded in `future-commitments.util.ts`, was:

> `kind`, `frequency`, and `endMode` are `string`, not their narrower `@wimm/shared` enum types, because that is honestly what a TEXT+CHECK column selection returns. Every consumer below is an equality check (`===`) or a `switch` with a `default` fallback (in `nextOccurrence`), so widening loses no completeness guarantee.

That reasoning holds only while the `CHECK` constraints hold. The Phase 0 whole-branch review established two facts that undermine it:

1. **The 14 `CHECK` constraints exist only in migration SQL, not in `schema.prisma`.** A future squash, or a baseline regenerated with `prisma migrate diff`, would silently drop all 14 and leave the widened types unguarded.
2. **The generated SQLite DDL contains zero `CHECK` constraints.** The reviewer produced it from the final schema and confirmed this. So the embedded desktop build planned for Phase 1 starts with no database-level enum guarantee at all.

Separately, an audit for this spec found that the repository has **no test CI**. `.github/workflows/release-desktop.yml` is the only workflow. Nothing runs lint or tests on push or pull request, so a regression reaches `develop` unchallenged.

## 2. Goals

- Corrupt enum data fails **loudly at the read boundary** rather than silently producing wrong output.
- The 14 `CHECK` constraints cannot disappear without something failing.
- Lint, build, and tests run automatically on push and pull request.

## 3. Non-goals

- Building the SQLite `CHECK` injection. Phase 1 owns it; §7 records the constraint so it is not rediscovered.
- Parsing every database-read enum across every service. §4 D2 explains why the safe-degradation sites are deliberately left alone.
- Changing any client-facing API contract. No `apps/desktop` or `apps/mobile` change.
- Integration or end-to-end tests. The suite stays unit-only and offline.

---

## 4. Decisions

### D1 — Parse at the read boundary; narrow the internal types back

**Chosen:** parse `kind`, `frequency`, and `endMode` with `parseEnum` at the single point where recurrence rows are loaded for the forecast (`reports.service.ts`), then restore `RecurrenceRowForForecast` to `TransactionKind` / `RecurrenceFrequency` / `RecurrenceEndMode`.

**Why:** an audit of every enum comparison in `apps/api/src` (non-spec) found ~23 sites. Most read from DTOs already validated by `@IsEnum`, and are safe. Of the sites reading from the database, only **two** degrade dangerously:

| Site | Corrupt input becomes | Consequence |
|---|---|---|
| `future-commitments.util.ts:107` | the `else` branch | expense counted as **income** — money in the wrong column |
| `recurrence-dates.ts:49` | `default:` → `addMonthsUtc(d, 1)` | unknown frequency silently treated as **MONTHLY** |

**Correction made while writing the implementation plan.** An earlier draft of this
section claimed both sites "sit behind one function, reached from one caller, fed by
one query." That is wrong, and the error understated the risk.

`nextOccurrence` has **two** callers:

- `future-commitments.util.ts:114` — the forecast. Read-only; a corrupt frequency
  produces wrong numbers on screen.
- `recurrences.service.ts:284` — **materialization**. `nextOccurrence` advances the
  `cursor` that becomes `occurredAt` on rows written by
  `prisma.transaction.create`. A corrupt frequency therefore **persists real
  transactions on the wrong dates**.

The write path is the more dangerous of the two, and it is fed by two load sites —
`findRowForUser` (single recurrence) and the `findMany` over active recurrences
(`recurrences.service.ts:181-184`), both funnelling into `materializeOne`.

So D1 covers **two** boundaries, not one: the forecast load in `reports.service.ts`,
and the materialization load in `materializeForUser`.

This partially reverses Phase 0's widening, deliberately. There, widening was the minimal change that unblocked the schema migration, and `parseEnum` did not yet exist when the constraint was written. It exists now, and parse-at-the-edge with a narrow interior is the shape that survives losing the database guarantee.

**Consequence to accept:** corrupt data changes from silently-wrong output to a `RangeError` surfacing as a 500. That is the intent — a wrong financial forecast that nobody notices is worse than an error someone reports.

**Rejected:** validating inside `nextOccurrence` and the forecast loop. Repeats the check, leaves the types lying, and does not stop the next consumer from making the same mistake.

### D2 — Leave the safe-degradation sites alone

**Chosen:** do not parse `source.type` reads in `imports.service.ts`, `transaction-billing.util.ts`, `sources.service.ts`, or the raw-row returns in `users`, `categories`, and `categorization-rules`.

**Why:** every one of these is an equality test whose `else` branch is conservative. A corrupt `Source.type` means "not a credit card", so no billing-cycle rules apply — the transaction lands on its purchase date instead of a due date. Wrong, but bounded and visible, not money in the wrong column.

The Phase 0 reviewer noted these as a consistency gap (the same `User` DTO is produced strictly by `/api/auth/login` and loosely by `/api/users/me`). That is real, and worth fixing when those services next get touched. It is not worth a broad refactor now for a failure mode that degrades safely.

**YAGNI applies here.** Fix the two that lose money; leave the ones that don't.

### D3 — The constraint guard is a script, not a test

**Chosen:** `apps/api/scripts/assert-check-constraints.ts`, invoked by CI. Not a Jest spec.

**Why:** the API suite is 226 unit tests with Prisma fully mocked. It runs offline in about six seconds and needs no database. A spec that queries `pg_constraint` would make `pnpm test` require a live Postgres, which is a real cost paid on every local run to guard against a rare event.

A standalone script keeps the suite pure and puts the check where a database already exists.

**Rejected:** a Jest project split (unit vs. integration). Correct at larger scale, but it introduces test-infrastructure complexity for a single assertion.

### D4 — CI runs the existing root scripts

**Chosen:** the workflow calls `pnpm lint`, `pnpm build`, and `pnpm test` — the Turbo scripts that already exist — rather than enumerating per-package commands.

**Why:** a workflow that restates the build graph drifts from it. Turbo already knows the dependency order.

**Noted:** `.github/workflows/release-desktop.yml` pins `pnpm/action-setup` to `version: 10` while `package.json` declares `packageManager: "pnpm@9.0.0"`. The new workflow omits `version` and lets `packageManager` drive it, removing the drift. The release workflow is left alone — changing it is out of scope here, but the inconsistency is worth resolving separately.

---

## 5. Architecture

### 5.1 Boundary parse

In `reports.service.ts`, the `findMany` that produces `recurrences` maps each row through `parseEnum` before handing it to `sumRecurrenceCommitmentsInUtcMonth`.

In `future-commitments.util.ts`, `RecurrenceRowForForecast` becomes:

```ts
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

The doc comment quoted in §1 is replaced with one explaining that values are parsed at the boundary, so the interior can rely on them.

In `recurrence-dates.ts`, `nextOccurrence` takes `RecurrenceFrequency`. Its `switch` drops `default:` and gains an exhaustiveness assertion:

```ts
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

Adding a fourth frequency without handling it becomes a compile error rather than a silent monthly fallback.

### 5.2 Constraint assertion script

`apps/api/scripts/assert-check-constraints.ts` connects using `DATABASE_URL` and queries:

```sql
SELECT conname FROM pg_constraint
WHERE contype = 'c' AND connamespace = 'public'::regnamespace
```

It compares the result against this expected set, asserts each is present **and** `convalidated`, and exits non-zero listing any that are missing:

```
CategorizationRule_matchType_check      Recurrence_kind_check
Category_type_check                     Source_type_check
ImportBatch_format_check                SystemCategorizationRule_kind_check
ImportBatch_status_check                Transaction_kind_check
Recurrence_endMode_check                User_aiCategorizationMode_check
Recurrence_frequency_check              User_chartDateMode_check
User_subscriptionPlan_check             User_subscriptionStatus_check
```

The failure message states plainly that a missing constraint means the widened `string` types in `apps/api/src` have lost their runtime guarantee, so whoever hits it understands the stakes rather than deleting the assertion.

### 5.3 CI workflow

`.github/workflows/ci.yml`:

- **Triggers:** `push` to `develop` and `main`; `pull_request` targeting either.
- **Runner:** `ubuntu-latest`.
- **Service:** `postgres:16-alpine`, credentials matching `docker-compose.yml` (`user` / `password` / `wimm`), with a health check.
- **Steps:** checkout → `pnpm/action-setup@v4` (no pinned version) → `actions/setup-node@v4` with `node-version: 20`, `cache: pnpm` → `pnpm install --frozen-lockfile` → `pnpm --filter @wimm/shared build` → `pnpm lint` → `pnpm build` → `pnpm test` → `prisma migrate deploy` → `tsx scripts/assert-check-constraints.ts`.

`pnpm --filter @wimm/shared build` runs before lint because the API typechecks against the built `dist`.

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A corrupt row now 500s a report that previously rendered wrong numbers | medium | Intended. The `CHECK` constraints make it unreachable on PostgreSQL; the error names the field and value. |
| CI green-lights a build the constraint script never checked, because migrations failed silently | medium | The migration step and the assertion are separate steps; a failed migration fails the job. |
| The expected-constraint list drifts from the schema as migrations are added | low | The failure message points at the migration that owns each constraint. Adding a constraint means adding it to the list — a deliberate, visible edit. |
| `pnpm install --frozen-lockfile` fails on a stale lockfile | low | Surfaces as a clear CI error; the fix is committing the lockfile. |

---

## 7. Phase 1 constraint, recorded

SQLite cannot `ALTER TABLE ADD CONSTRAINT`. A `CHECK` must be present in the original `CREATE TABLE`, or the table has to be rebuilt (create-new, copy, drop-old, rename).

Prisma does not model `CHECK` constraints, so `prisma migrate diff` against a SQLite target emits DDL without them — confirmed by the Phase 0 reviewer against the final schema.

Phase 1 therefore needs a **post-generation step** that injects the 14 constraints into the generated SQLite `CREATE TABLE` statements before they are applied. The 14 definitions are already written in `apps/api/prisma/migrations/20260729120000_enums_to_text/migration.sql` and can be lifted from there.

This is not built now: the right shape depends on how Phase 1 generates and ships the SQLite schema, which is not yet designed. Building it in advance would be guessing.

Until it exists, D1's boundary parse is what protects the embedded build — which is why D1 is worth doing now rather than deferring alongside it.

---

## 8. Open questions for review

1. Should the CI workflow also typecheck `apps/desktop` and `apps/mobile`? `pnpm lint` already does via Turbo, so this is really a question of whether CI should ever be allowed to skip them for speed. The design assumes not.
2. Should `pnpm test` run on a matrix of Node versions, or just 20? The design assumes 20 only, matching `engines` and the release workflow.
