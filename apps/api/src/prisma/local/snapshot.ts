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
 * - `restoreSnapshot`'s final write -- replacing the live target -- copies
 *   into a temporary file in the target's own directory, validates that
 *   copy, and only then `renameSync`s it over the target. A rename on the
 *   same filesystem is atomic: the target is either the old file or the
 *   new one, never a truncated mix of both, even if the copy is interrupted
 *   by a full disk, an I/O error, or a killed process. The temp file lives
 *   next to the target (not next to the snapshot) specifically so that
 *   rename stays on one volume.
 *
 * - `restoreSnapshot` preserves the current target before overwriting it
 *   (unless there is no current target to protect), so a restore is itself
 *   undoable: a user who restores the wrong backup does not lose the state
 *   they were in. That preservation is best-effort: if the current target
 *   cannot be validated (wrong journal mode, or it fails
 *   `integrity_check`), its bytes are still copied aside -- marked
 *   unvalidated so `listSnapshots` never offers it as a restore candidate
 *   -- but the restore itself always proceeds regardless. A broken target
 *   is exactly the situation a restore is for; preserving it must never be
 *   allowed to block recovering from it.
 *
 * - Pruning parses the timestamp out of the filename rather than trusting
 *   filesystem mtime, because `copyFileSync` preserves mtime inconsistently
 *   across platforms and the pruning decision is which of the user's
 *   backups to destroy.
 *
 * - Every snapshot is keyed by a `databaseId` that callers must supply
 *   explicitly -- never derived from the database file's basename. Every
 *   profile will eventually get its own database file in one shared backup
 *   directory, and two different databases can share a basename (every
 *   profile's file is named `wimm.db`); requiring callers to state the
 *   identity keeps that collision from ever being accidental.
 *
 * - `now` is always taken as an argument rather than read from `new Date()`
 *   internally, so callers (and tests) can produce deterministic, ordered
 *   timestamps without sleeping.
 *
 * - `restoreSnapshot` refuses -- before touching anything -- unless it can
 *   get exclusive access to `targetFile` via a real SQLite lock
 *   (`assertExclusiveAccess`). Overwriting a SQLite file while another
 *   connection is actively using it is undefined behaviour: corruption, or a
 *   stale page-cache read, and either way silently. This check is a
 *   point-in-time gate, not a held lock for the duration of the restore, and
 *   it can only see a connection that is genuinely mid-transaction at the
 *   moment it runs -- see `assertExclusiveAccess`'s doc comment for exactly
 *   what it does and does not catch. Callers closing their own connection to
 *   `targetFile` before calling `restoreSnapshot` remains a hard
 *   requirement this check narrows the risk of, not one it removes.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { randomBytes } from 'crypto'
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

/**
 * Marker inserted into the filename of a pre-restore preservation copy that
 * could not be validated (see `preserveTargetBeforeRestore`). Its presence
 * keeps the segment between `databaseId` and `SNAPSHOT_SUFFIX` from
 * matching `TIMESTAMP_PATTERN`, so `listSnapshots` never recognizes -- and
 * therefore never offers as a restore candidate -- a copy that may itself
 * be corrupt.
 */
const UNVALIDATED_MARKER = 'unvalidated'

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

function snapshotFileName(databaseId: string, now: Date): string {
  return `${databaseId}.${formatTimestamp(now)}${SNAPSHOT_SUFFIX}`
}

/**
 * Filename for a pre-restore preservation copy of a target that failed
 * validation. See `preserveTargetBeforeRestore`.
 */
function unvalidatedCopyFileName(databaseId: string, now: Date): string {
  return `${databaseId}.${formatTimestamp(now)}.${UNVALIDATED_MARKER}${SNAPSHOT_SUFFIX}`
}

/**
 * Returns the timestamp encoded in `fileName` if it is a snapshot of
 * `databaseId`, or `null` otherwise.
 *
 * The middle segment is validated against the strict timestamp pattern (not
 * just "starts with the id and ends with the suffix"), so a database with
 * id `wimm.db` can never accidentally match snapshots that actually belong
 * to a differently-identified database such as `wimm.db.bak`, nor an
 * unvalidated preservation copy of its own target (whose middle segment has
 * the extra `.unvalidated` marker appended and so never parses as a plain
 * timestamp).
 */
function parseSnapshotTimestamp(fileName: string, databaseId: string): Date | null {
  const prefix = `${databaseId}.`
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
    let rows: Array<{ integrity_check: string }>
    try {
      rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    } catch (err) {
      throw new Error(`${context}: integrity_check threw for ${file} (${(err as Error).message})`)
    }
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
 * Lists snapshots of `databaseId` found in `backupDir`, newest first.
 * Returns an empty array if `backupDir` does not exist yet.
 *
 * `databaseId` is the same caller-supplied identifier passed to
 * `snapshotDatabase` -- not the database file's basename. This is what lets
 * multiple databases that share a basename live in one backup directory
 * without ever listing or pruning each other's snapshots. Pre-restore
 * copies of a target that failed validation are deliberately excluded (see
 * `preserveTargetBeforeRestore`).
 */
export function listSnapshots(backupDir: string, databaseId: string): SnapshotInfo[] {
  if (!existsSync(backupDir)) return []

  const snapshots: SnapshotInfo[] = []
  for (const entry of readdirSync(backupDir)) {
    const takenAt = parseSnapshotTimestamp(entry, databaseId)
    if (!takenAt) continue
    const path = join(backupDir, entry)
    snapshots.push({ path, takenAt, sizeBytes: statSync(path).size })
  }

  return snapshots.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
}

/** Deletes all but the newest `keep` snapshots of `databaseId` in `backupDir`. */
function pruneSnapshots(backupDir: string, databaseId: string, keep: number): void {
  const snapshots = listSnapshots(backupDir, databaseId)
  for (const stale of snapshots.slice(keep)) {
    rmSync(stale.path, { force: true })
  }
}

/**
 * Copies `file` into `backupDir` as a new, validated snapshot identified by
 * `databaseId`, then prunes old snapshots of that same id down to the
 * newest `MAX_SNAPSHOTS_PER_DATABASE`. Returns the path of the new
 * snapshot.
 *
 * `databaseId` is caller-supplied and is never derived from `file`'s
 * basename: two databases that happen to share a basename (e.g. every
 * profile's file named `wimm.db`) must be given different ids by the
 * caller, or their snapshots would collide -- and prune each other -- in a
 * shared `backupDir`.
 *
 * Throws, without writing anything, if `file` is not currently in DELETE
 * journal mode. Throws, after deleting the bad copy, if the written
 * snapshot fails `PRAGMA integrity_check`.
 */
export function snapshotDatabase(file: string, backupDir: string, databaseId: string, now: Date): string {
  assertDeleteJournalMode(file)

  mkdirSync(backupDir, { recursive: true })

  const snapshotPath = join(backupDir, snapshotFileName(databaseId, now))

  copyFileSync(file, snapshotPath)

  try {
    assertValidDatabaseFile(snapshotPath, 'Snapshot failed validation after being written')
  } catch (err) {
    rmSync(snapshotPath, { force: true })
    throw err
  }

  pruneSnapshots(backupDir, databaseId, MAX_SNAPSHOTS_PER_DATABASE)

  return snapshotPath
}

/**
 * Best-effort preserves the current contents of `targetFile` before a
 * restore overwrites it, so nothing is silently discarded -- even when the
 * target itself is broken, which is exactly the situation a restore is
 * most often needed for.
 *
 * Tries a full, validated snapshot first, identical to `snapshotDatabase`
 * (including pruning). If that fails for any reason -- wrong journal mode,
 * or the target fails `integrity_check` -- falls back to a raw copy of
 * whatever bytes exist, named with `UNVALIDATED_MARKER` so `listSnapshots`
 * never recognizes it as a restore candidate. If even that raw copy fails
 * (e.g. the disk is full), the failure is swallowed: preserving the old
 * state must never be allowed to block the restore that follows.
 */
function preserveTargetBeforeRestore(targetFile: string, backupDir: string, databaseId: string, now: Date): void {
  try {
    snapshotDatabase(targetFile, backupDir, databaseId, now)
    return
  } catch {
    // The target could not be validated as a healthy snapshot -- fall
    // through to a best-effort raw copy below instead of propagating.
  }

  try {
    mkdirSync(backupDir, { recursive: true })
    const unvalidatedPath = join(backupDir, unvalidatedCopyFileName(databaseId, now))
    copyFileSync(targetFile, unvalidatedPath)
  } catch {
    // Preservation is best-effort only. Even a failure here (e.g. a full
    // disk) must not prevent the restore that follows.
  }
}

/**
 * Throws unless `file` can be locked for exclusive access right now.
 * Overwriting a SQLite database file while another connection is actively
 * using it is undefined behaviour -- corruption, or a stale page-cache read
 * on that other connection's side, and either way silently. This is the
 * guard `restoreSnapshot` runs before it touches `targetFile` at all.
 *
 * Mechanism: open a plain connection to `file` -- deliberately not through
 * `openLocalDatabase`, which would itself try to force `journal_mode =
 * DELETE`, an unwanted side effect for a connection whose only job here is
 * to check, not to configure -- disable the busy-retry wait
 * (`busy_timeout = 0`, so a conflict fails immediately instead of blocking
 * this call for seconds), and attempt `BEGIN IMMEDIATE` followed by
 * `COMMIT`. Under `DELETE` journal mode -- which every live database file in
 * this app is required to be in -- `BEGIN IMMEDIATE` and `BEGIN EXCLUSIVE`
 * are the same lock escalation (they only differ under WAL). A `SQLITE_BUSY`
 * error from either statement, specifically, means some other connection
 * currently holds a conflicting lock; it is turned into a refusal that names
 * `file` and tells the caller to close it first.
 *
 * Only `SQLITE_BUSY` is treated as "in use." Any other failure while
 * probing -- `file` not opening at all, or a write attempt failing because
 * the file is corrupt -- is not a locking conflict and is deliberately left
 * alone here: it is not this function's job to report, and the validation
 * and preservation logic `restoreSnapshot` runs right after this check
 * already handles a corrupt or unreadable target on its own, honestly. This
 * check does one thing: tell an active conflicting connection apart from
 * every other reason `file` might be unusable.
 *
 * What this provably catches: another connection that is genuinely
 * mid-transaction against `file` at the moment this check runs, whether
 * that transaction is reading or writing. An open write transaction on
 * another connection already holds the RESERVED lock this probe needs, so
 * `BEGIN IMMEDIATE` itself fails immediately; an open read transaction holds
 * a SHARED lock that is compatible with another connection also holding
 * RESERVED, so `BEGIN IMMEDIATE` succeeds but the follow-up `COMMIT` -- which
 * must escalate to EXCLUSIVE to finish -- fails instead. Either way this
 * function throws, and the half-open probe transaction is rolled back before
 * the probe connection is closed.
 *
 * What this does NOT catch, and structurally cannot: a connection that is
 * open but idle -- constructed and never used yet, or simply between
 * statements in autocommit mode -- holds no SQLite lock at all in `DELETE`
 * journal mode, so this check cannot see it and will let the restore
 * proceed. It also only checks at one instant, immediately before the
 * restore begins; it does not hold the lock for the restore's duration, so a
 * connection that opens and starts a transaction in the brief window between
 * this check and `restoreSnapshot`'s final `renameSync` is not caught
 * either. Neither gap is closable from user-space with SQLite's own locking
 * primitives -- they are exactly why the caller closing its own connection
 * to `file` before calling `restoreSnapshot` remains a hard requirement this
 * check narrows the risk of, not one it removes or makes optional.
 */
function assertExclusiveAccess(file: string): void {
  let db: Database.Database
  try {
    db = new Database(file)
  } catch {
    // Could not even open a plain connection -- not a locking conflict, so
    // not this function's concern. See the doc comment: a missing, unreadable
    // or corrupt `file` gets its own honest report from the validation and
    // preservation logic that runs right after this check.
    return
  }

  try {
    db.pragma('busy_timeout = 0')

    const refuseIfBusy = (err: unknown): void => {
      if ((err as { code?: string }).code !== 'SQLITE_BUSY') return
      throw new Error(
        `Refusing to restore over ${file}: another connection is actively using it right now ` +
          `(${(err as Error).message}). Close every open connection to this database before restoring.`,
      )
    }

    try {
      db.exec('BEGIN IMMEDIATE')
    } catch (err) {
      refuseIfBusy(err)
      // Some other failure (e.g. `file` is corrupt) -- not a locking
      // conflict, so not this function's concern; see the doc comment.
      return
    }

    try {
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Best-effort cleanup of the half-open probe transaction; `db` is
        // closed in the outer `finally` below regardless.
      }
      refuseIfBusy(err)
      return
    }
  } finally {
    db.close()
  }
}

/**
 * Replaces `targetFile` with the contents of `snapshotPath`.
 *
 * Before overwriting anything, `snapshotPath` is validated the same way a
 * freshly written snapshot is (open read-only, `PRAGMA integrity_check`):
 * restoring from a file that is not a valid SQLite database throws and
 * leaves `targetFile` untouched.
 *
 * If `targetFile` currently exists, this first requires exclusive access to
 * it (see `assertExclusiveAccess` for exactly what that does and does not
 * catch) and then preserves it (see `preserveTargetBeforeRestore`) into the
 * same directory as `snapshotPath`, under `databaseId`, so the restore is
 * itself undoable. If `targetFile` does not exist yet, there is no prior
 * state to protect or lock, so both steps are skipped rather than
 * fabricating an empty database to back up or check.
 *
 * **Callers must close their own connection to `targetFile` before calling
 * this.** The exclusive-access check above narrows the risk of overwriting a
 * database that is in use; it does not eliminate it -- see
 * `assertExclusiveAccess`'s doc comment for the gaps it cannot close.
 *
 * The replacement itself is atomic: `snapshotPath` is copied into a
 * temporary file in `targetFile`'s own directory (so the rename below stays
 * on one filesystem), that copy is validated, and only then is it
 * `renameSync`d over `targetFile`. If the copy or its validation fails, the
 * temporary file is removed and `targetFile` is left exactly as it was --
 * a same-filesystem rename cannot leave `targetFile` half-old, half-new.
 */
export function restoreSnapshot(snapshotPath: string, targetFile: string, databaseId: string, now: Date): void {
  assertValidDatabaseFile(snapshotPath, 'Cannot restore snapshot')

  if (existsSync(targetFile)) {
    assertExclusiveAccess(targetFile)
    preserveTargetBeforeRestore(targetFile, dirname(snapshotPath), databaseId, now)
  }

  const tempPath = join(dirname(targetFile), `.${basename(targetFile)}.restoring-${randomBytes(8).toString('hex')}.tmp`)

  copyFileSync(snapshotPath, tempPath)

  try {
    assertValidDatabaseFile(tempPath, 'Restored copy failed validation before replacing the target')
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }

  renameSync(tempPath, targetFile)
}
