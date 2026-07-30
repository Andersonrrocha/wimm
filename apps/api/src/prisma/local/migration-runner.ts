/**
 * Applies pending SQLite migrations to a user's local database at boot.
 *
 * The Prisma CLI cannot ship inside a packaged Electron app, so `prisma migrate
 * deploy` is not available at runtime -- this is what replaces it. Every design
 * choice below follows from one fact: on the hosted side a bad migration is
 * recoverable from infrastructure backups; here, the user's database file is
 * the only copy of their financial history, and there is no infrastructure.
 *
 * Design decisions, and why:
 *
 * - `_prisma_migrations` is created here (`CREATE TABLE IF NOT EXISTS`) with
 *   the same column shape Prisma itself creates, because the committed
 *   baseline does not include it -- that table is normally created by
 *   Prisma's CLI, which is not shipped. Matching the shape keeps `prisma
 *   migrate` usable against a local file in development.
 *
 * - A checksum mismatch on a migration already recorded as applied is a hard
 *   failure, checked *before* anything else (including before deciding
 *   whether a snapshot is needed). It means a migration file was edited after
 *   it shipped, so the database and the shipped code no longer agree about
 *   history -- continuing would risk applying later migrations on top of a
 *   schema nobody can reason about. Nothing has been mutated yet at this
 *   point, so no snapshot is taken for this failure: there is nothing to
 *   protect against, only a disagreement to report.
 *
 * - No snapshot is taken when nothing is pending. A snapshot on every boot
 *   would evict the useful history within `MAX_SNAPSHOTS_PER_DATABASE`
 *   launches, and a no-op run has nothing destructive to protect against.
 *
 * - When anything IS pending, the snapshot is taken once, before any
 *   migration runs -- not per migration.
 *
 * - Every pending migration for a single call is applied inside ONE shared
 *   transaction, not one transaction per migration. If migration N in a
 *   batch fails, migrations 1..N-1 from THIS SAME call are rolled back too,
 *   not left half-applied. The alternative -- committing each migration
 *   independently -- would leave a user who upgrades across several
 *   migrations in one boot in a schema state that matches neither the old
 *   app version nor the new one if any migration after the first fails.
 *   A single shared transaction means a failed boot-time upgrade always
 *   leaves the database exactly as it was found; the snapshot remains the
 *   recovery path for anything a transaction can't undo (e.g. the process
 *   being killed mid-write).
 *
 * - The batch transaction is opened with `foreign_keys = OFF`, set *before*
 *   `BEGIN`. SQLite documents `PRAGMA foreign_keys` as a no-op inside a
 *   transaction, and `prisma migrate diff --script` -- the command this repo
 *   uses to author SQLite migrations -- rebuilds any table it cannot alter
 *   in place as `CREATE TABLE new_X` / `INSERT INTO new_X SELECT ...` /
 *   `DROP TABLE X` / `ALTER TABLE new_X RENAME TO X`, wrapped in its own
 *   `PRAGMA foreign_keys=OFF/ON` (which, per the above, would be swallowed
 *   by the batch transaction). Left enforced, that `DROP TABLE` fires every
 *   `ON DELETE CASCADE` and `ON DELETE SET NULL` in the schema against the
 *   table being rebuilt -- an implicit, silent delete of unrelated rows, with
 *   no exception and a clean `integrity_check`. Disabling enforcement for the
 *   connection before the transaction even starts is what actually prevents
 *   that; see `openLocalDatabase`'s `foreignKeys` option. Because migrations
 *   can no longer rely on their own `PRAGMA foreign_keys` to do anything --
 *   it would silently no-op either way -- any migration containing one is
 *   rejected outright, see `assertNoForeignKeysPragma`.
 *
 * - With enforcement off for the whole batch, nothing checks referential
 *   integrity while the migrations run. `PRAGMA foreign_key_check` runs as
 *   the last step *inside* the same batch transaction, before it commits --
 *   not after -- and is the safety net that replaces the enforcement
 *   disabled above: if a migration left dangling references behind (a bug
 *   in the migration itself, not something this runner's own
 *   foreign-keys-off handling can cause), throwing here rolls the whole
 *   batch back, the same as any other mid-batch failure, so nothing ever
 *   lands. A violation is a hard failure that names the offending tables;
 *   the pre-migration snapshot remains available, but as a second line of
 *   defence rather than the only recovery path.
 *
 * - `PRAGMA foreign_key_check` scans the *whole database*, not just the
 *   tables the batch touched. A database can already contain orphaned rows
 *   before any migration in this call ever runs -- seeded outside any
 *   migration, restored from an import, or left over from a partial
 *   recovery -- and those are not this batch's fault. So the check runs
 *   *twice*: once immediately after `BEGIN`, before the first migration
 *   applies, to record a baseline of whatever violations already exist, and
 *   once more as the batch's last step. Only violations in the second
 *   reading that are *not* in the baseline are treated as introduced by this
 *   batch and fail it. Violations present in both readings are pre-existing:
 *   this batch didn't create them and rolling it back would not fix them, so
 *   they are reported with `console.warn` instead -- naming the affected
 *   tables so the user learns their database was already inconsistent --
 *   without blaming (or rolling back) a migration that never touched them.
 *   Rows are compared by a stable key (`table`/`rowid`/`parent`/`fkid`), not
 *   by array equality, because `PRAGMA foreign_key_check` does not guarantee
 *   row order between the two readings.
 *
 * - After each migration's `db.exec` runs, `db.inTransaction` is checked and
 *   must still be true. `better-sqlite3` does not stop a migration from
 *   containing a hand-written `COMMIT` -- and if one runs, the batch
 *   transaction this runner depends on for atomic rollback no longer exists:
 *   `db.transaction()`'s own rollback-on-throw logic only fires when
 *   `db.inTransaction` is true (see its implementation), so a `COMMIT` inside
 *   a migration silently makes everything applied so far in this batch
 *   permanent, without error, before this check was added. `prisma migrate
 *   diff --script` never emits a bare `COMMIT`, so this only guards against a
 *   hand-edited migration.
 *
 * - A database that already has migrations recorded which this build does
 *   not ship is a hard failure, checked alongside the checksum-drift check
 *   above and before anything else for the same reason: it means an OLDER
 *   build has been pointed at a database a NEWER build already migrated.
 *   Without this check that boot looks clean -- `applyPendingMigrations`
 *   only ever iterates migrations it discovers in `migrationsDir`, so it has
 *   no way to notice history it doesn't know about -- and the app then runs
 *   normal queries against a schema it was never written against. The way
 *   back is not running the old build against the new database; it is
 *   reinstalling the old build and restoring a snapshot taken *before* the
 *   upgrade to the newer build (old app + old data), which is why the error
 *   message points there instead of at anything this call could do itself.
 *   Like the checksum-drift check, nothing has been mutated at this point,
 *   so no snapshot is taken for this failure either.
 *
 * - `now` is always taken as an argument, never read from `new Date()`
 *   internally, so callers (and tests) can produce deterministic timestamps.
 *   It is passed straight through to `snapshotDatabase` and used to stamp
 *   `_prisma_migrations.started_at` / `finished_at` for every migration
 *   applied in this call.
 */
import { createHash, randomUUID } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { openLocalDatabase } from './open-local-database'
import { snapshotDatabase } from './snapshot'

/**
 * Stable discriminant on `DatabaseMigratedByNewerBuildError.code`.
 *
 * A caller across a package boundary (Electron `main`, in `apps/desktop`,
 * consuming this module through `@wimm/api/dist/...`) needs to identify this
 * specific failure -- "the database is ahead of this build" -- to show the
 * user something actionable instead of a stack trace. Two ways to do that
 * were considered: `instanceof DatabaseMigratedByNewerBuildError`, or this
 * field.
 *
 * Both work correctly in *this* codebase today: `@wimm/api` is consumed
 * through exactly one resolved copy (a `workspace:*` symlink under pnpm's
 * hoisted `node_modules`, not a duplicated nested install), so the module
 * `apps/desktop/src/main/local-api.ts` imports from
 * `@wimm/api/dist/prisma/local/migration-runner` resolves to the identical
 * absolute file -- and therefore the identical class reference -- as the one
 * this function throws from. `instanceof` is not unsound here.
 *
 * The field is still the primary, documented way to identify this error, for
 * two reasons that outlive that fact: first, it is what makes the class
 * exported for `instanceof` at all a belt-and-suspenders convenience rather
 * than the only mechanism -- if `apps/desktop`'s bundling or dependency
 * resolution ever changes in a way that loads a second copy of this module
 * (a duplicated `node_modules` entry, a future non-workspace publish of
 * `@wimm/api`, ...), `instanceof` silently starts returning `false` across
 * that boundary with no error of its own, while `error.code === ...` keeps
 * working regardless of which copy of the class constructed the object.
 * Second, a string constant survives serialization (postMessage, IPC,
 * `JSON.stringify`) that a class identity does not -- not exercised by this
 * module's current callers, but a reason not to make identity load-bearing
 * for a value that might cross a process boundary later.
 */
export const DATABASE_MIGRATED_BY_NEWER_BUILD_CODE = 'DATABASE_MIGRATED_BY_NEWER_BUILD' as const

/**
 * Thrown when `file` records migrations as applied that this build does not
 * ship -- i.e. a newer build already migrated this database and an older
 * build (this one) was pointed at it afterwards. See the "ahead of this
 * build" check below for the full reasoning; see
 * `DATABASE_MIGRATED_BY_NEWER_BUILD_CODE`'s doc comment for why callers
 * should match on `code` rather than `instanceof` alone.
 */
export class DatabaseMigratedByNewerBuildError extends Error {
  readonly code = DATABASE_MIGRATED_BY_NEWER_BUILD_CODE

  constructor(message: string) {
    super(message)
    this.name = 'DatabaseMigratedByNewerBuildError'
  }
}

export interface MigrationResult {
  /** Migrations applied during this call, in the order they were applied. */
  applied: string[]
  /** Migrations that were already recorded as applied before this call, in directory order. */
  alreadyApplied: string[]
  /** Path of the snapshot taken before applying anything, or `null` if nothing was pending. */
  snapshot: string | null
}

interface DiscoveredMigration {
  name: string
  sql: string
  checksum: string
}

/**
 * DDL for the migration bookkeeping table, matching the columns Prisma itself
 * creates (`id`, `checksum`, `finished_at`, `migration_name`, `logs`,
 * `rolled_back_at`, `started_at`, `applied_steps_count`) so `prisma migrate`
 * tooling stays usable against a local database file in development.
 * `IF NOT EXISTS` makes this safe to run on every boot, applied or not.
 */
const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL PRIMARY KEY,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" DATETIME,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`

/**
 * Discovers migrations by directory name under `migrationsDir`, sorted
 * lexicographically -- the timestamp (or, for the baseline, zero) prefix
 * makes that chronological order. Each migration directory must contain a
 * `migration.sql` file; its sha256 checksum is computed here once and reused
 * both for drift detection and for the row recorded on successful apply.
 */
function discoverMigrations(migrationsDir: string): DiscoveredMigration[] {
  const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  return names.map((name) => {
    const sqlPath = join(migrationsDir, name, 'migration.sql')
    let sql: string
    try {
      sql = readFileSync(sqlPath, 'utf8')
    } catch (err) {
      throw new Error(
        `Migration "${name}" is missing its migration.sql file at ${sqlPath}: ${(err as Error).message}`,
      )
    }
    const checksum = createHash('sha256').update(sql).digest('hex')
    return { name, sql, checksum }
  })
}

interface ForeignKeyViolation {
  table: string
  rowid: number | null
  parent: string
  fkid: number
}

/** Runs `PRAGMA foreign_key_check` and returns its rows, typed. */
function readForeignKeyViolations(db: ReturnType<typeof openLocalDatabase>): ForeignKeyViolation[] {
  return db.prepare('PRAGMA foreign_key_check').all() as ForeignKeyViolation[]
}

/**
 * A stable per-row identity for a `foreign_key_check` violation, used to tell
 * "the same violation, read twice" apart from "a different violation" --
 * `PRAGMA foreign_key_check` makes no ordering guarantee between two calls,
 * so comparing the two readings' arrays directly (or their lengths alone)
 * would be wrong: same violations in a different order would look like a
 * change, and a fixed violation plus a newly introduced one could cancel out
 * in a plain count. Every field of the row is part of the key because any of
 * them differing means a different offending row or a different constraint.
 */
function violationKey(v: ForeignKeyViolation): string {
  return `${v.table} ${v.rowid ?? 'null'} ${v.parent} ${v.fkid}`
}

/** Matches a `PRAGMA foreign_keys` statement in any case or spacing, so it can be rejected. */
const FOREIGN_KEYS_PRAGMA_PATTERN = /PRAGMA\s+foreign_keys/i

/**
 * Rejects any migration in `migrations` whose SQL contains a `PRAGMA
 * foreign_keys` statement. Every pending migration for a call runs inside
 * one shared batch transaction, and SQLite documents `PRAGMA foreign_keys`
 * as a no-op inside a transaction -- so a migration that sets it is lying
 * about what it does: the statement will silently have no effect, and
 * enforcement will stay exactly as this runner already set it (see the
 * module doc comment). Enforcement for the batch is this runner's own
 * responsibility, not any individual migration's.
 */
function assertNoForeignKeysPragma(migrations: DiscoveredMigration[]): void {
  for (const migration of migrations) {
    if (FOREIGN_KEYS_PRAGMA_PATTERN.test(migration.sql)) {
      throw new Error(
        `Migration "${migration.name}" contains a "PRAGMA foreign_keys" statement. This runner applies every ` +
          'pending migration inside one shared batch transaction, and SQLite documents `PRAGMA foreign_keys` as ' +
          'a no-op inside a transaction -- so this statement can only ever silently fail to take effect, while ' +
          'claiming otherwise. Foreign key enforcement for the whole batch is handled by the runner itself ' +
          '(disabled before the transaction begins, re-checked with `PRAGMA foreign_key_check` as the last step ' +
          'before it commits). ' +
          `Remove the "PRAGMA foreign_keys" statement(s) from "${migration.name}".`,
      )
    }
  }
}

/**
 * Brings `file` up to date with every migration in `migrationsDir`.
 *
 * Reads (creating if absent) `_prisma_migrations` to determine what has
 * already been applied, hard-fails if any already-applied migration's
 * checksum no longer matches its file on disk, hard-fails if the database
 * records migrations applied that this build does not ship (it was already
 * migrated by a newer build), and otherwise snapshots (once) and applies
 * everything pending inside a single transaction. See the module doc comment
 * for the reasoning behind each of these choices.
 *
 * `databaseId` identifies `file` for snapshot storage -- see `snapshotDatabase`
 * for why this must be caller-supplied rather than derived from a basename.
 */
export function applyPendingMigrations(options: {
  file: string
  migrationsDir: string
  backupDir: string
  databaseId: string
  now: Date
}): MigrationResult {
  const { file, migrationsDir, backupDir, databaseId, now } = options

  const discovered = discoverMigrations(migrationsDir)

  // Foreign keys are disabled for this connection's whole lifetime, not just
  // for the batch transaction -- see the module doc comment for why they
  // must be off *before* `BEGIN`. This connection is never used for
  // anything but migration bookkeeping, so there is no other code path that
  // depends on enforcement being on here.
  const db = openLocalDatabase(file, { foreignKeys: 'off' })
  try {
    db.exec(MIGRATIONS_TABLE_DDL)

    const appliedRows = db
      .prepare('SELECT "migration_name" AS migration_name, "checksum" AS checksum FROM "_prisma_migrations"')
      .all() as Array<{ migration_name: string; checksum: string }>
    const appliedChecksums = new Map(appliedRows.map((row) => [row.migration_name, row.checksum]))

    // Hard-fail on drift before deciding anything else. This must run even on
    // an otherwise no-op boot: a shipped migration edited after the fact is a
    // history disagreement regardless of whether anything new is pending.
    for (const migration of discovered) {
      const recordedChecksum = appliedChecksums.get(migration.name)
      if (recordedChecksum !== undefined && recordedChecksum !== migration.checksum) {
        throw new Error(
          `Migration "${migration.name}" was already applied, but its checksum no longer matches its file ` +
            `on disk (recorded ${recordedChecksum}, current ${migration.checksum}). This means the migration ` +
            'file was edited after it shipped, and the database and the shipped code no longer agree about ' +
            'history. Refusing to continue.',
        )
      }
    }

    // Hard-fail if the database is AHEAD of this build: it records migrations
    // as applied that this build does not ship at all. That can only happen
    // if a newer build already migrated this database and an older build
    // (this one) was pointed at it afterwards -- see the module doc comment
    // for why the fix is restoring a pre-upgrade snapshot, not anything this
    // call can do. Checked before deciding what is pending, for the same
    // reason as the checksum-drift check above: this must fail loudly even
    // on an otherwise no-op boot, and nothing has been mutated yet.
    const discoveredNames = new Set(discovered.map((m) => m.name))
    const aheadOfThisBuild = appliedRows
      .map((row) => row.migration_name)
      .filter((name) => !discoveredNames.has(name))
      .sort()
    if (aheadOfThisBuild.length > 0) {
      throw new DatabaseMigratedByNewerBuildError(
        `${file} was already migrated by a newer build of this app: it records migration(s) ` +
          `${aheadOfThisBuild.join(', ')} as applied, but this build does not ship them. Running an older build ` +
          "against a database a newer build already migrated is not supported -- this build doesn't know what " +
          'that schema looks like. To go back to this build, reinstall it and restore a snapshot that was taken ' +
          'BEFORE the upgrade to the newer build (old app with old data), not this database as it is now. ' +
          'Refusing to continue.',
      )
    }

    const alreadyApplied = discovered.filter((m) => appliedChecksums.has(m.name)).map((m) => m.name)
    const pending = discovered.filter((m) => !appliedChecksums.has(m.name))

    // Reject anything relying on `PRAGMA foreign_keys` before doing anything
    // destructive -- it can only ever silently no-op inside the batch
    // transaction below, so a migration depending on it is lying about what
    // it does. See `assertNoForeignKeysPragma`.
    assertNoForeignKeysPragma(pending)

    if (pending.length === 0) {
      return { applied: [], alreadyApplied, snapshot: null }
    }

    const snapshotPath = snapshotDatabase(file, backupDir, databaseId, now)

    const insertRecord = db.prepare(
      `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
       VALUES (?, ?, ?, ?, ?, 1)`,
    )

    // Everything pending for this call lives in one transaction: if any
    // migration fails, earlier ones from this same call are undone too, so a
    // failed boot-time upgrade always leaves the database exactly as found.
    // Foreign keys are already off on this connection (see above), and stay
    // off for the whole transaction -- SQLite would silently ignore any
    // attempt to toggle them mid-transaction anyway.
    const applyAll = db.transaction(() => {
      // Read right after BEGIN, before the first migration in this batch
      // applies, so any violation already present cannot be blamed on this
      // batch -- see the module doc comment for why this must run twice.
      const baselineViolations = readForeignKeyViolations(db)
      const baselineKeys = new Set(baselineViolations.map(violationKey))

      for (const migration of pending) {
        try {
          db.exec(migration.sql)
        } catch (err) {
          throw new Error(
            `Migration "${migration.name}" failed and was rolled back, along with every other migration already ` +
              `applied earlier in this same batch (${(err as Error).message}). The database has been left exactly ` +
              `as it was found before this call. A pre-migration snapshot is also available at ${snapshotPath}.`,
          )
        }

        // A hand-written `COMMIT` inside a migration ends this batch
        // transaction early -- `better-sqlite3` raises nothing when that
        // happens. From this point on, `db.transaction()`'s own
        // rollback-on-throw only fires while `db.inTransaction` is true (see
        // its implementation), so if the migration above ended it, nothing
        // this runner does from here can undo what already committed. See
        // the module doc comment.
        if (!db.inTransaction) {
          throw new Error(
            `Migration "${migration.name}" ended the batch transaction -- most likely via an explicit "COMMIT" ` +
              'statement in its SQL. Every pending migration in a call is meant to share one transaction so a ' +
              'failure partway through rolls every migration in the same batch back together; once a migration ' +
              'ends that transaction itself, this runner can no longer guarantee that rollback for anything ' +
              `applied in this batch, including "${migration.name}" itself. Remove the statement that ends the ` +
              `transaction from "${migration.name}".`,
          )
        }

        insertRecord.run(randomUUID(), migration.checksum, now.toISOString(), migration.name, now.toISOString())
      }

      // Foreign keys were off for the whole batch (see the module doc
      // comment and `openLocalDatabase`'s `foreignKeys` option), so nothing
      // enforced referential integrity while the migrations above ran. This
      // check is the safety net that replaces that enforcement, run as the
      // batch's last step, still inside this transaction and before it
      // commits. `PRAGMA foreign_key_check` scans the whole database, so its
      // result here is split against the baseline read above: a violation
      // present in both readings pre-dates this batch and is only reported,
      // not failed on (see the module doc comment); a violation that is new
      // means one of the migrations in this batch has a bug.
      const violations = readForeignKeyViolations(db)
      const introduced = violations.filter((v) => !baselineKeys.has(violationKey(v)))
      const preExisting = violations.filter((v) => baselineKeys.has(violationKey(v)))

      if (preExisting.length > 0) {
        const preExistingTables = [...new Set(preExisting.map((v) => v.table))].sort()
        console.warn(
          `Pre-existing referential integrity violation(s) found in: ${preExistingTables.join(', ')}. These were ` +
            `already present before migration(s) ${pending.map((m) => m.name).join(', ')} ran in this batch, so ` +
            'they were not introduced by it and this batch was not rolled back on their account -- but they mean ' +
            'the database was already inconsistent before this call, which should be surfaced to the user.',
        )
      }

      if (introduced.length > 0) {
        const offendingTables = [...new Set(introduced.map((v) => v.table))].sort()
        throw new Error(
          `Migration(s) ${pending.map((m) => m.name).join(', ')} left referential integrity violations behind ` +
            `in: ${offendingTables.join(', ')}, and were rolled back along with every other migration in this ` +
            'same batch. Foreign key enforcement was disabled while this batch ran (see the module doc comment), ' +
            'and PRAGMA foreign_key_check as the batch\'s last step before commit is the safety net that replaces ' +
            'it; it found dangling references that were not present before this batch ran, which means one of ' +
            'these migrations has a bug. The database has been left exactly as it was found before this call. ' +
            `A pre-migration snapshot is also available at ${snapshotPath}.`,
        )
      }
    })

    applyAll()

    return { applied: pending.map((m) => m.name), alreadyApplied, snapshot: snapshotPath }
  } finally {
    db.close()
  }
}
