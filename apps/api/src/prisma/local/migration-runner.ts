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

  const db = openLocalDatabase(file)
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
    const applyAll = db.transaction(() => {
      for (const migration of pending) {
        try {
          db.exec(migration.sql)
          insertRecord.run(randomUUID(), migration.checksum, now.toISOString(), migration.name, now.toISOString())
        } catch (err) {
          throw new Error(
            `Migration "${migration.name}" failed and was rolled back (${(err as Error).message}). ` +
              `A pre-migration snapshot is available at ${snapshotPath}.`,
          )
        }
      }
    })

    applyAll()

    return { applied: pending.map((m) => m.name), alreadyApplied, snapshot: snapshotPath }
  } finally {
    db.close()
  }
}
