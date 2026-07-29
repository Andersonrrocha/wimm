# Phase 2 — Migration Runner and Backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply pending SQLite migrations to a user's local database at boot, always after taking a snapshot that can be restored — so a bad migration is recoverable rather than terminal.

**Architecture:** A hand-written runner, because the Prisma CLI cannot ship inside a packaged Electron app. It creates and maintains a `_prisma_migrations` table matching Prisma's own shape, so the official tooling stays usable in development. Before applying anything it copies the database file, keeping the last 5. A restore function is exported and unit-tested; the UI that calls it belongs to phases 3 and 4.

**Tech Stack:** TypeScript 5.5, `better-sqlite3`, Jest 30, pnpm 9, Turbo.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scope: `database`.
- **No service, controller, or mapper may change.** This phase adds a module and its tests.
- `apps/desktop` and `apps/mobile` must not be touched.
- No new dependencies — `better-sqlite3` is already installed.
- The API test suite stays **offline**. These tests use temporary SQLite files, which is fine; they must not need PostgreSQL, a network, or Docker.
- Baseline: `@wimm/shared` 28/28, `@wimm/api` 263/263 across 38 suites, `pnpm lint --force` green, both guards pass.

## Facts established by prototype — do not re-derive

I probed these before writing the plan:

1. **`better-sqlite3` opens with `journal_mode = delete`**, not WAL. There is no `-wal` file, so a plain `copyFileSync` of a database with an open connection produced a readable snapshot containing the committed row. **The naive copy is safe today — but only because of that default.** If anything later switches to WAL, the same copy can produce a torn snapshot. The runner therefore *sets* the journal mode rather than inheriting it, and the snapshot asserts it.
2. **`better-sqlite3` opens with `foreign_keys = 1`.** SQLite's own default is OFF; this is the driver being helpful. Every `onDelete: Cascade / Restrict / SetNull` in the schema is inert without it, so the runner sets it explicitly rather than depending on a driver default that could change.
3. **The committed baseline does not create `_prisma_migrations`** — that table is created by Prisma's CLI, which we are not shipping. The runner creates it.
4. Prisma's `_prisma_migrations` columns are: `id varchar(36)`, `checksum varchar(64)`, `finished_at`, `migration_name varchar(255)`, `logs`, `rolled_back_at`, `started_at` (default now), `applied_steps_count int` (default 0).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/api/src/prisma/local/open-local-database.ts` | Open a SQLite file with the pragmas this app requires |
| `apps/api/src/prisma/local/snapshot.ts` | Copy a database file to the backup directory; prune to the last 5; list and restore |
| `apps/api/src/prisma/local/migration-runner.ts` | Read applied migrations, apply pending ones transactionally |
| `apps/api/src/prisma/local/*.spec.ts` | One spec per module |

---

## Task 1: Opening a database with explicit pragmas

Both pragmas this app depends on are currently correct **by accident** — they are `better-sqlite3` defaults, not decisions. A driver upgrade could change either, and both failures are silent: foreign keys stop cascading, or snapshots start tearing.

**Files:**
- Create: `apps/api/src/prisma/local/open-local-database.ts`, `open-local-database.spec.ts`

**Interfaces:**
- Produces: `openLocalDatabase(file: string, options?: { readonly?: boolean }): Database.Database` — an open handle with `foreign_keys = ON` and `journal_mode = DELETE`, both asserted after being set.

- [ ] **Step 1: Write the failing test**

```ts
import { rmSync } from 'fs'
import { openLocalDatabase } from './open-local-database'

const FILE = '/tmp/wimm-open-spec.db'

describe('openLocalDatabase', () => {
  afterEach(() => {
    for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) rmSync(f, { force: true })
  })

  it('enables foreign key enforcement', () => {
    const db = openLocalDatabase(FILE)
    expect((db.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys).toBe(1)
    db.close()
  })

  it('uses the delete journal, so a file copy is a valid snapshot', () => {
    const db = openLocalDatabase(FILE)
    const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
    expect(mode).toBe('delete')
    db.close()
  })

  it('actually enforces a foreign key', () => {
    const db = openLocalDatabase(FILE)
    db.exec(`
      CREATE TABLE parent ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE child ("id" TEXT NOT NULL PRIMARY KEY, "parentId" TEXT NOT NULL,
        CONSTRAINT fk FOREIGN KEY ("parentId") REFERENCES parent("id") ON DELETE CASCADE);
    `)
    expect(() =>
      db.prepare('INSERT INTO child VALUES (?, ?)').run('c1', 'does-not-exist'),
    ).toThrow(/FOREIGN KEY/i)
    db.close()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wimm/api test open-local-database`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/prisma/local/open-local-database.ts`:

```ts
/**
 * Open a local SQLite database with the pragmas this application depends on.
 *
 * Both are `better-sqlite3` defaults today, which means the app currently works
 * by accident rather than by decision:
 *
 * - `foreign_keys` — SQLite's own default is OFF. Every `onDelete: Cascade`,
 *   `Restrict` and `SetNull` in the schema is inert without it, and the failure
 *   is silent: orphaned rows rather than an error.
 * - `journal_mode = DELETE` — snapshots are taken by copying the file. In WAL
 *   mode a copy taken without a checkpoint can be missing committed data, so the
 *   backup would look fine and restore short.
 *
 * Setting both explicitly means a driver upgrade cannot quietly change them.
 */
import Database from 'better-sqlite3'

export function openLocalDatabase(
  file: string,
  options: { readonly?: boolean } = {},
): Database.Database {
  const db = new Database(file, { readonly: options.readonly ?? false })

  if (!options.readonly) {
    db.pragma('journal_mode = DELETE')
  }
  db.pragma('foreign_keys = ON')

  const fk = (db.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys
  if (fk !== 1) {
    db.close()
    throw new Error(`Refusing to use ${file}: foreign key enforcement could not be enabled`)
  }

  return db
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @wimm/api test open-local-database && pnpm --filter @wimm/api run lint`

```bash
git add apps/api/src/prisma/local
git commit -m "feat(database): open local sqlite with explicit foreign key and journal pragmas"
```

---

## Task 2: Snapshots

**This is the most important task in the phase.** On the hosted side a bad migration is recoverable from infrastructure. Here the user's file is the only copy, and there is no infrastructure.

**Files:**
- Create: `apps/api/src/prisma/local/snapshot.ts`, `snapshot.spec.ts`

**Interfaces:**
- Produces:
  - `snapshotDatabase(file: string, backupDir: string, now: Date): string` — copies the file, returns the snapshot path, prunes to the newest 5.
  - `listSnapshots(backupDir: string, databaseName: string): SnapshotInfo[]` — newest first, where `SnapshotInfo = { path: string; takenAt: Date; sizeBytes: number }`.
  - `restoreSnapshot(snapshotPath: string, targetFile: string): void` — replaces the target, **after snapshotting the target first** so a restore is itself undoable.

- [ ] **Step 1: Write the failing tests**

Cover, at minimum:

1. A snapshot of a database containing a known row can be opened and that row read back.
2. The snapshot filename encodes the database name and a sortable timestamp.
3. Taking a 6th snapshot leaves exactly 5, and the one removed is the oldest.
4. Pruning only ever considers snapshots of **that** database — a second database's snapshots in the same directory are untouched. (Phase 3 gives every profile its own file in one shared backup directory, so this matters.)
5. `restoreSnapshot` replaces the target's contents, and the pre-restore state is itself recoverable from a snapshot taken during the restore.
6. `listSnapshots` returns newest first.
7. Restoring a file that is not a valid SQLite database throws and leaves the target untouched.

Take the `now` argument explicitly rather than calling `new Date()` inside, so the tests can produce deterministic, ordered timestamps without sleeping.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @wimm/api test snapshot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Points the implementation must honour:

- Copy with `copyFileSync`. This is only safe in `DELETE` journal mode — **assert the mode before copying** and throw if it is anything else, naming WAL explicitly. A snapshot that silently loses committed data is the worst outcome this phase can produce.
- Validate the snapshot after writing it: open it read-only and run `PRAGMA integrity_check`. A backup nobody has read is a guess.
- `restoreSnapshot` must snapshot the current target before overwriting it. A user restoring the wrong backup should not lose the state they were in.
- Prune by parsing the timestamp out of the filename, not by filesystem mtime — copying preserves neither reliably across platforms.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @wimm/api test snapshot && pnpm --filter @wimm/api run lint`

**Then prove the safety property by hand:** create a database, insert a row, snapshot it, insert a second row, restore the snapshot, and confirm the database is back to one row *and* that a snapshot of the two-row state exists. Report the sequence.

```bash
git add apps/api/src/prisma/local
git commit -m "feat(database): snapshot local databases before destructive operations"
```

---

## Task 3: The migration runner

**Files:**
- Create: `apps/api/src/prisma/local/migration-runner.ts`, `migration-runner.spec.ts`

**Interfaces:**
- Consumes: `openLocalDatabase` (Task 1), `snapshotDatabase` (Task 2).
- Produces: `applyPendingMigrations(options: { file: string; migrationsDir: string; backupDir: string; now: Date }): MigrationResult` where `MigrationResult = { applied: string[]; alreadyApplied: string[]; snapshot: string | null }`.

Behaviour:

- Create `_prisma_migrations` if absent, matching Prisma's column shape (§ Facts, item 4) so `prisma migrate` tooling remains usable in development.
- Read applied migration names from it.
- Discover migrations by directory name, sorted lexicographically — the timestamp prefix makes that chronological.
- If nothing is pending, **take no snapshot** and return early. A snapshot per boot would evict the useful history within five launches.
- If anything is pending: snapshot first, then apply each migration **inside a transaction**, recording it in `_prisma_migrations` with a sha256 checksum of the file.
- If a migration throws, the transaction rolls back, and the error names the migration and points at the snapshot path.
- **Checksum mismatch on an already-applied migration is a hard failure** — it means a migration file was edited after shipping, and the database and the file no longer agree about history.

Tests must cover, at minimum: a fresh database applying the baseline; a second run being a no-op with no new snapshot; a failing migration leaving the database unchanged and the snapshot present; an edited already-applied migration being rejected; and migrations applying in lexicographic order.

- [ ] **Steps: TDD as above, then verify and commit**

```bash
git add apps/api/src/prisma/local
git commit -m "feat(database): apply pending sqlite migrations with a snapshot taken first"
```

---

## Task 4: Verification

- [ ] Confirm no service code changed: `git diff --name-only <base>..HEAD -- apps/api/src | grep -v "^apps/api/src/prisma/"` returns nothing.
- [ ] Confirm clients untouched: `git diff --stat <base>..HEAD -- apps/desktop apps/mobile` is empty.
- [ ] `pnpm build --force && pnpm lint --force`, both suites, both guards.
- [ ] Confirm the API suite still needs no PostgreSQL: stop the `wimm-postgres` container, run `pnpm --filter @wimm/api test`, confirm it passes, restart the container. This is the offline property, and it is easy to break by accident.

---

## Exit criteria

- A database opened by this code enforces foreign keys and uses the delete journal, both asserted rather than assumed.
- No migration can be applied without a snapshot existing first.
- A snapshot is validated with `integrity_check` before being trusted.
- Restoring is itself undoable.
- An edited already-applied migration is rejected.
- The API test suite passes with PostgreSQL stopped.
