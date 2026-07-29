/**
 * Snapshot (backup) and restore local SQLite database files.
 *
 * WIMM is a standalone desktop app with no server: the user's database file
 * is the only copy of their financial history. On the hosted side, a bad
 * migration or a bad restore is recoverable from infrastructure backups.
 * Here, these snapshots ARE the entire recovery story, so every step below
 * is deliberately paranoid.
 *
 * Design decisions, and why:
 *
 * - Snapshots are plain file copies (`copyFileSync`), which is only a valid
 *   backup strategy in `DELETE` journal mode. In WAL mode, a copy taken
 *   without a checkpoint can miss committed data — the backup looks fine
 *   and restores short, which is worse than having no backup at all because
 *   it is trusted. `assertDeleteJournalMode` is checked before every copy
 *   and throws, naming WAL explicitly, if the mode is anything else.
 *
 * - A snapshot nobody has read is a guess, not a backup. Every snapshot is
 *   opened read-only and run through `PRAGMA integrity_check` immediately
 *   after being written; a snapshot that fails is deleted rather than left
 *   behind to be mistaken for a good one.
 *
 * - `restoreSnapshot` snapshots the current target before overwriting it
 *   (unless there is no current target to protect), so a restore is itself
 *   undoable: a user who restores the wrong backup does not lose the state
 *   they were in.
 *
 * - Pruning parses the timestamp out of the filename rather than trusting
 *   filesystem mtime, because `copyFileSync` preserves mtime inconsistently
 *   across platforms and the pruning decision is which of the user's
 *   backups to destroy.
 *
 * - Pruning is scoped per database name, not per directory. Every profile
 *   will eventually get its own database file in one shared backup
 *   directory, so pruning must never touch another profile's snapshots.
 *
 * - `now` is always taken as an argument rather than read from `new Date()`
 *   internally, so callers (and tests) can produce deterministic, ordered
 *   timestamps without sleeping.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
// Same import form as open-local-database.ts: this package has
// `allowSyntheticDefaultImports` but not `esModuleInterop`, so a default
// import typechecks but is `undefined` at runtime for this CommonJS module.
import Database = require('better-sqlite3')
import { openLocalDatabase } from './open-local-database'

export interface SnapshotInfo {
  path: string
  takenAt: Date
  sizeBytes: number
}

/** How many snapshots of a single database are kept before pruning the oldest. */
const MAX_SNAPSHOTS_PER_DATABASE = 5

/** Suffix appended to every snapshot filename, after the embedded timestamp. */
const SNAPSHOT_SUFFIX = '.snapshot.db'

/** Matches the compact, sortable timestamp embedded in a snapshot filename. */
const TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/

/**
 * Formats `now` as a filename-safe, lexicographically sortable timestamp,
 * e.g. `2026-01-02T03:04:05.006Z` -> `20260102T030405006Z`.
 *
 * Colons and dots are stripped because they (or their absence) matter to
 * Windows filenames; digits-only keeps ordering identical to the original
 * ISO string ordering, since every character removed sits at the same
 * relative position in every timestamp.
 */
function formatTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace('.', '')
}

/** Inverse of `formatTimestamp`. Returns `null` for anything that doesn't match. */
function parseTimestamp(compact: string): Date | null {
  const match = TIMESTAMP_PATTERN.exec(compact)
  if (!match) return null
  const [, year, month, day, hour, minute, second, ms] = match
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function snapshotFileName(databaseName: string, now: Date): string {
  return `${databaseName}.${formatTimestamp(now)}${SNAPSHOT_SUFFIX}`
}

/**
 * Returns the timestamp encoded in `fileName` if it is a snapshot of
 * `databaseName`, or `null` otherwise.
 *
 * The middle segment is validated against the strict timestamp pattern (not
 * just "starts with the name and ends with the suffix"), so a database
 * named `wimm.db` can never accidentally match snapshots that actually
 * belong to a differently-named database such as `wimm.db.bak`.
 */
function parseSnapshotTimestamp(fileName: string, databaseName: string): Date | null {
  const prefix = `${databaseName}.`
  if (!fileName.startsWith(prefix) || !fileName.endsWith(SNAPSHOT_SUFFIX)) return null
  const timestampPart = fileName.slice(prefix.length, fileName.length - SNAPSHOT_SUFFIX.length)
  return parseTimestamp(timestampPart)
}

/**
 * Throws unless `file` is currently in `DELETE` journal mode. A file copy is
 * only a valid snapshot in that mode; WAL is named explicitly in the
 * message because it is the dangerous case a copy can silently miss data
 * under.
 */
function assertDeleteJournalMode(file: string): void {
  const db = openLocalDatabase(file, { readonly: true })
  try {
    const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
    if (mode !== 'delete') {
      throw new Error(
        `Refusing to snapshot ${file}: journal mode is "${mode}", not DELETE. A file copy is only a safe ` +
          'snapshot in DELETE mode -- in WAL mode in particular, a copy taken without a checkpoint can ' +
          'silently be missing committed data.',
      )
    }
  } finally {
    db.close()
  }
}

/**
 * Throws unless `file` opens as a SQLite database and passes
 * `PRAGMA integrity_check`. Used both to validate a freshly written
 * snapshot and to validate a snapshot before restoring from it.
 */
function assertValidDatabaseFile(file: string, context: string): void {
  let db: Database.Database
  try {
    db = openLocalDatabase(file, { readonly: true })
  } catch (err) {
    throw new Error(`${context}: ${file} is not a valid SQLite database (${(err as Error).message})`)
  }

  try {
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok'
    if (!ok) {
      throw new Error(
        `${context}: integrity_check failed for ${file}: ${rows.map((row) => row.integrity_check).join('; ')}`,
      )
    }
  } finally {
    db.close()
  }
}

/**
 * Lists snapshots of `databaseName` found in `backupDir`, newest first.
 * Returns an empty array if `backupDir` does not exist yet.
 */
export function listSnapshots(backupDir: string, databaseName: string): SnapshotInfo[] {
  if (!existsSync(backupDir)) return []

  const snapshots: SnapshotInfo[] = []
  for (const entry of readdirSync(backupDir)) {
    const takenAt = parseSnapshotTimestamp(entry, databaseName)
    if (!takenAt) continue
    const path = join(backupDir, entry)
    snapshots.push({ path, takenAt, sizeBytes: statSync(path).size })
  }

  return snapshots.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
}

/** Deletes all but the newest `keep` snapshots of `databaseName` in `backupDir`. */
function pruneSnapshots(backupDir: string, databaseName: string, keep: number): void {
  const snapshots = listSnapshots(backupDir, databaseName)
  for (const stale of snapshots.slice(keep)) {
    rmSync(stale.path, { force: true })
  }
}

/**
 * Copies `file` into `backupDir` as a new, validated snapshot, then prunes
 * old snapshots of that same database down to the newest
 * `MAX_SNAPSHOTS_PER_DATABASE`. Returns the path of the new snapshot.
 *
 * Throws, without writing anything, if `file` is not currently in DELETE
 * journal mode. Throws, after deleting the bad copy, if the written
 * snapshot fails `PRAGMA integrity_check`.
 */
export function snapshotDatabase(file: string, backupDir: string, now: Date): string {
  assertDeleteJournalMode(file)

  mkdirSync(backupDir, { recursive: true })

  const databaseName = basename(file)
  const snapshotPath = join(backupDir, snapshotFileName(databaseName, now))

  copyFileSync(file, snapshotPath)

  try {
    assertValidDatabaseFile(snapshotPath, 'Snapshot failed validation after being written')
  } catch (err) {
    rmSync(snapshotPath, { force: true })
    throw err
  }

  pruneSnapshots(backupDir, databaseName, MAX_SNAPSHOTS_PER_DATABASE)

  return snapshotPath
}

/**
 * Replaces `targetFile` with the contents of `snapshotPath`.
 *
 * Before overwriting anything, `snapshotPath` is validated the same way a
 * freshly written snapshot is (open read-only, `PRAGMA integrity_check`):
 * restoring from a file that is not a valid SQLite database throws and
 * leaves `targetFile` untouched.
 *
 * If `targetFile` currently exists, it is snapshotted first (into the same
 * directory as `snapshotPath`) so the restore is itself undoable. If
 * `targetFile` does not exist yet, there is no prior state to protect, so
 * this step is skipped rather than fabricating an empty database to back up.
 */
export function restoreSnapshot(snapshotPath: string, targetFile: string, now: Date): void {
  assertValidDatabaseFile(snapshotPath, 'Cannot restore snapshot')

  if (existsSync(targetFile)) {
    snapshotDatabase(targetFile, dirname(snapshotPath), now)
  }

  copyFileSync(snapshotPath, targetFile)
}
