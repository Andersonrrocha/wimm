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
 * checksum no longer matches its file on disk, and otherwise snapshots (once)
 * and applies everything pending inside a single transaction. See the module
 * doc comment for the reasoning behind each of these choices.
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
      for (const migration of pending) {
        try {
          db.exec(migration.sql)
          insertRecord.run(randomUUID(), migration.checksum, now.toISOString(), migration.name, now.toISOString())
        } catch (err) {
          throw new Error(
            `Migration "${migration.name}" failed and was rolled back, along with every other migration already ` +
              `applied earlier in this same batch (${(err as Error).message}). The database has been left exactly ` +
              `as it was found before this call. A pre-migration snapshot is also available at ${snapshotPath}.`,
          )
        }
      }

      // Foreign keys were off for the whole batch (see the module doc
      // comment and `openLocalDatabase`'s `foreignKeys` option), so nothing
      // enforced referential integrity while the migrations above ran. This
      // check is the safety net that replaces that enforcement, run as the
      // batch's last step, still inside this transaction and before it
      // commits: a non-empty result means a migration left dangling
      // references behind -- a bug in the migration itself, since this
      // runner's own use of `foreignKeys: 'off'` cannot itself orphan
      // anything (no CASCADE/SET NULL ever fires while enforcement is off).
      // Throwing here, like any other failure inside `db.transaction()`,
      // rolls the whole batch back before anything is committed, so the
      // database is left exactly as it was found -- the pre-migration
      // snapshot is a second line of defence, not the only recovery path.
      const violations = db.prepare('PRAGMA foreign_key_check').all() as Array<{
        table: string
        rowid: number | null
        parent: string
        fkid: number
      }>
      if (violations.length > 0) {
        const offendingTables = [...new Set(violations.map((v) => v.table))].sort()
        throw new Error(
          `Migration(s) ${pending.map((m) => m.name).join(', ')} left referential integrity violations behind ` +
            `in: ${offendingTables.join(', ')}, and were rolled back along with every other migration in this ` +
            'same batch. Foreign key enforcement was disabled while this batch ran (see the module doc comment), ' +
            'and PRAGMA foreign_key_check as the batch\'s last step before commit is the safety net that replaces ' +
            'it; it found dangling references, which means one of these migrations has a bug. The database has ' +
            `been left exactly as it was found before this call. A pre-migration snapshot is also available at ` +
            `${snapshotPath}.`,
        )
      }
    })

    applyAll()

    return { applied: pending.map((m) => m.name), alreadyApplied, snapshot: snapshotPath }
  } finally {
    db.close()
  }
}
