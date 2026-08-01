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
 * - `snapshotDatabase` skips taking a new snapshot -- without consuming a
 *   retention slot -- when `file` is byte-identical to the newest existing
 *   snapshot of `databaseId`, compared by content hash rather than size or
 *   mtime (`copyFileSync` does not preserve mtime consistently across
 *   platforms, and two different states can coincidentally share a size).
 *   This exists for the crash-loop case: a boot-time migration that fails
 *   the same way on every relaunch rolls its database back to exactly the
 *   state it was in before, so without this check every relaunch would take
 *   another snapshot of that same unchanged state and prune away real
 *   history to make room for it. See `applyPendingMigrations`, the only
 *   caller for which this matters -- it snapshots once per call whenever
 *   anything is pending, which is exactly what a crash loop repeats.
 *
 * - `restoreSnapshot` refuses -- before touching anything -- unless it can
 *   get exclusive access to `targetFile` via a real SQLite lock
 *   (`assertExclusiveAccess`). Overwriting a SQLite file while another
 *   connection is actively using it is undefined behaviour: corruption, or a
 *   stale page-cache read, and either way silently. Two different compiled
 *   `better-sqlite3` libraries are live in this one process -- the root
 *   workspace copy this module otherwise uses everywhere, and the copy
 *   `@prisma/adapter-better-sqlite3` bundles internally, which is the one
 *   `LocalPrismaService`'s connections actually run on -- and SQLite's lock
 *   bookkeeping does not cross between them: a lock held through one is
 *   provably invisible to a probe made through the other (see this
 *   function's own doc comment for the confirmed, reproduced case). So
 *   `assertExclusiveAccess` probes with *both* builds and refuses if either
 *   reports contention. This check is a point-in-time gate, not a held lock
 *   for the duration of the restore, and even with both builds probed it can
 *   only see a connection that is genuinely mid-transaction at the moment it
 *   runs -- see that function's doc comment for exactly what it does and
 *   does not catch. It is also not the only guard: `restoreSnapshot` now
 *   takes a required `closeExistingConnections` callback and runs it,
 *   immediately before this probe, precisely because the probe alone cannot
 *   see a connection that is open but idle -- see `restoreSnapshot`'s doc
 *   comment for what that callback does and does not guarantee.
 *
 * - `assertValidDatabaseFile`'s logic is also reachable from outside this
 *   module through `checkDatabaseHealth`, which is the exported, non-
 *   throwing counterpart a UI needs: Phase 4c's recovery flow has to
 *   *display* a problem, not crash on it. `checkDatabaseHealth` calls the
 *   same private assert and turns a throw into a result, rather than
 *   duplicating the open-and-integrity-check logic a second time.
 *
 * - Phase 4c task 4 adds three things on top of the above, all driven by the
 *   same need: a restore UI a real person has to choose from.
 *
 *   1. `SnapshotInfo.schemaVersion` -- the name of the newest migration
 *      recorded as applied in a snapshot's own `_prisma_migrations` table, or
 *      `null` if it cannot be determined (no such table, or the file cannot
 *      be opened at all -- notably true of most preservation copies, which
 *      exist precisely because they failed validation). Read best-effort,
 *      never throwing: this is informational for a human choosing among
 *      backups ("which of these predate the update that broke things" is the
 *      one question they actually have), not a correctness gate anywhere in
 *      this module's own logic. Computed for every entry `listSnapshots` and
 *      `listPreservationCopies` return.
 *
 *   2. `listPreservationCopies`, the counterpart to `listSnapshots` for the
 *      unvalidated copies `preserveTargetBeforeRestore` falls back to. Before
 *      this, those copies existed on disk (named with `UNVALIDATED_MARKER`)
 *      but nothing outside this module could enumerate them -- a restore UI
 *      could offer every validated snapshot but never the one thing left
 *      behind when a *previous* restore ran against an already-broken
 *      target, which is exactly the last-resort case such a UI exists for.
 *      Deliberately a separate function, not a flag on `listSnapshots`: the
 *      two lists mean different things to a user (an ordinary restore point
 *      vs. "we couldn't verify this, only use it if nothing else works"),
 *      and conflating them would make it easy for a UI to offer an
 *      unvalidated copy as an equal, undifferentiated choice.
 *
 *   3. `exportDatabaseCopy`, for the user-initiated "export a profile"
 *      action -- see its own doc comment for why this is deliberately not a
 *      snapshot (never written into `backupDir`, never pruned, never
 *      returned by `listSnapshots`), while still applying the same
 *      DELETE-journal-mode and post-write integrity checks every other copy
 *      in this module does.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs'
import { createHash, randomBytes } from 'crypto'
import { createRequire } from 'module'
import { basename, dirname, join } from 'path'
// Same import form as open-local-database.ts: this package has
// `allowSyntheticDefaultImports` but not `esModuleInterop`, so a default
// import typechecks but is `undefined` at runtime for this CommonJS module.
import Database = require('better-sqlite3')
import { assertLocalNativeAbiSelected } from './native-abi-guard'
import { openLocalDatabase } from './open-local-database'

export interface SnapshotInfo {
  path: string
  takenAt: Date
  sizeBytes: number
  /**
   * The newest migration name recorded as applied in this file's own
   * `_prisma_migrations` table, or `null` when that cannot be determined
   * (no such table -- an ancient snapshot, or one that never went through
   * `applyPendingMigrations` -- or the file cannot be opened at all, which
   * is expected for most entries `listPreservationCopies` returns). See the
   * module doc comment's "Phase 4c task 4" section. Best-effort and
   * read-only: never throws, never used by this module's own pruning or
   * dedup logic, purely informational for a human choosing among backups.
   */
  schemaVersion: string | null
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
 * The `listPreservationCopies` counterpart to `parseSnapshotTimestamp`:
 * returns the timestamp encoded in `fileName` if it is an UNVALIDATED
 * preservation copy of `databaseId` (see `preserveTargetBeforeRestore` and
 * `unvalidatedCopyFileName`), or `null` otherwise. A plain, validated
 * snapshot never matches this (its filename has no `UNVALIDATED_MARKER`
 * segment), which is what keeps the two listings disjoint without either
 * function needing to know about the other's result.
 */
function parsePreservationCopyTimestamp(fileName: string, databaseId: string): Date | null {
  const prefix = `${databaseId}.`
  const suffix = `.${UNVALIDATED_MARKER}${SNAPSHOT_SUFFIX}`
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) return null
  const timestampPart = fileName.slice(prefix.length, fileName.length - suffix.length)
  return parseTimestamp(timestampPart)
}

/**
 * Best-effort reads the newest migration name recorded as applied in
 * `file`'s own `_prisma_migrations` table -- see `SnapshotInfo.schemaVersion`'s
 * doc comment for what this is for and why it never throws.
 *
 * Ordered by `started_at` (when each migration was actually applied to
 * *this* file), not `migration_name` -- the two agree for every migration
 * this app has ever shipped (the name is timestamp-prefixed, see
 * `migration-runner.ts`'s `discoverMigrations`) but `started_at` is the
 * fact this function actually means to report, and does not depend on that
 * naming convention holding forever.
 *
 * Deliberately opened with `openLocalDatabase(file, { readonly: true })`,
 * the same read-only helper every other read in this module uses -- never
 * `foreignKeys: 'off'` or any write-capable option, since this never
 * mutates anything and must never be the reason a read-only preservation
 * copy fails to open.
 */
function readSchemaVersionBestEffort(file: string): string | null {
  let db: Database.Database
  try {
    db = openLocalDatabase(file, { readonly: true })
  } catch {
    return null
  }

  try {
    const row = db
      .prepare('SELECT "migration_name" AS migration_name FROM "_prisma_migrations" ORDER BY "started_at" DESC LIMIT 1')
      .get() as { migration_name: string } | undefined
    return row?.migration_name ?? null
  } catch {
    // No `_prisma_migrations` table, or some other read failure -- either
    // way this is informational only, never a reason to throw. See the
    // module doc comment.
    return null
  } finally {
    db.close()
  }
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

export interface DatabaseHealthCheck {
  /** Whether `file` opened as a SQLite database and passed `PRAGMA integrity_check`. */
  healthy: boolean
  /** `null` when `healthy` is true; otherwise a message describing what is wrong, safe to show to the user. */
  problem: string | null
}

/**
 * Reports whether `file` is a healthy, readable SQLite database -- the entry
 * point for the recovery flow (Phase 4c will build a UI on top of this):
 * "is my database OK?".
 *
 * This is the exported, non-throwing counterpart of `assertValidDatabaseFile`.
 * A UI needs to *display* a problem, not crash on it, so this never throws;
 * it calls the same private assert used everywhere else in this module for
 * that exact check and converts a throw into a result, rather than
 * duplicating the open-and-integrity-check logic a second time.
 */
export function checkDatabaseHealth(file: string): DatabaseHealthCheck {
  try {
    assertValidDatabaseFile(file, 'Database health check')
    return { healthy: true, problem: null }
  } catch (err) {
    return { healthy: false, problem: (err as Error).message }
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
    snapshots.push({ path, takenAt, sizeBytes: statSync(path).size, schemaVersion: readSchemaVersionBestEffort(path) })
  }

  return snapshots.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
}

/**
 * Lists UNVALIDATED preservation copies of `databaseId` found in `backupDir`,
 * newest first -- the counterpart to `listSnapshots` for the fallback copies
 * `preserveTargetBeforeRestore` writes when the current target cannot be
 * validated before a restore overwrites it (wrong journal mode, or a failed
 * `integrity_check`). See the module doc comment's "Phase 4c task 4" section
 * for why this exists as its own function rather than folded into
 * `listSnapshots`: these are a clearly-labelled last resort, never an
 * ordinary restore candidate, and `listSnapshots` must keep excluding them
 * exactly as it already does (see `parseSnapshotTimestamp`'s doc comment).
 *
 * Returns an empty array if `backupDir` does not exist yet, matching
 * `listSnapshots`.
 */
export function listPreservationCopies(backupDir: string, databaseId: string): SnapshotInfo[] {
  if (!existsSync(backupDir)) return []

  const copies: SnapshotInfo[] = []
  for (const entry of readdirSync(backupDir)) {
    const takenAt = parsePreservationCopyTimestamp(entry, databaseId)
    if (!takenAt) continue
    const path = join(backupDir, entry)
    copies.push({ path, takenAt, sizeBytes: statSync(path).size, schemaVersion: readSchemaVersionBestEffort(path) })
  }

  return copies.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
}

/** Deletes all but the newest `keep` snapshots of `databaseId` in `backupDir`. */
function pruneSnapshots(backupDir: string, databaseId: string, keep: number): void {
  const snapshots = listSnapshots(backupDir, databaseId)
  for (const stale of snapshots.slice(keep)) {
    rmSync(stale.path, { force: true })
  }
}

/** True if `a` and `b` have identical contents, compared by hash rather than size or mtime. */
function filesAreIdentical(a: string, b: string): boolean {
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  return hash(a) === hash(b)
}

/**
 * Copies `file` into `backupDir` as a new, validated snapshot identified by
 * `databaseId`, then prunes old snapshots of that same id down to the
 * newest `MAX_SNAPSHOTS_PER_DATABASE`. Returns the path of the snapshot that
 * now represents `file`'s current state -- see below, this is not always a
 * newly written one.
 *
 * `databaseId` is caller-supplied and is never derived from `file`'s
 * basename: two databases that happen to share a basename (e.g. every
 * profile's file named `wimm.db`) must be given different ids by the
 * caller, or their snapshots would collide -- and prune each other -- in a
 * shared `backupDir`.
 *
 * If `file` is byte-identical (by content hash, not size or mtime -- see
 * `filesAreIdentical`) to the newest existing snapshot of `databaseId`, no
 * new snapshot is written and that existing snapshot's path is returned
 * instead: nothing changed since it was taken, so a new copy would be a
 * redundant use of one of the `MAX_SNAPSHOTS_PER_DATABASE` retention slots.
 * This is what keeps a boot-time failure that relaunches repeatedly against
 * an unchanged, already-rolled-back database from evicting real history --
 * see the module doc comment. When no snapshot of `databaseId` exists yet,
 * this comparison is skipped and a snapshot is taken as normal.
 *
 * Throws, without writing anything, if `file` is not currently in DELETE
 * journal mode. Throws, after deleting the bad copy, if a newly written
 * snapshot fails `PRAGMA integrity_check`.
 */
export function snapshotDatabase(file: string, backupDir: string, databaseId: string, now: Date): string {
  assertDeleteJournalMode(file)

  const newest = listSnapshots(backupDir, databaseId)[0]
  if (newest && filesAreIdentical(file, newest.path)) {
    return newest.path
  }

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
 * Structural type for a `better-sqlite3` connection, satisfied by both the
 * root workspace package (typed via `Database.Database`) and the copy
 * `@prisma/adapter-better-sqlite3` bundles internally (loaded via a raw
 * `require()` against an absolute path, so it has no static type of its own
 * -- see `loadAdapterBetterSqlite3Ctor`). Only the members that
 * `probeExclusiveAccess` actually calls.
 */
interface MinimalSqliteConnection {
  pragma(sql: string): unknown
  exec(sql: string): unknown
  close(): void
}

const nodeRequire = createRequire(__filename)

/**
 * Walks up from `startFile` until it finds a directory containing a
 * `package.json` whose `name` field is `packageName`, and returns that
 * directory. Used to locate `@prisma/adapter-better-sqlite3`'s own package
 * root from its resolved entry file, rather than assuming a fixed number of
 * `dirname()` calls -- entry files move between package versions (e.g.
 * `dist/index.js` becoming `dist/cjs/index.js`); the *name* in the nearest
 * enclosing `package.json` does not.
 */
function findPackageRoot(startFile: string, packageName: string): string {
  let dir = dirname(startFile)
  for (;;) {
    const packageJsonPath = join(dir, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
        if (pkg.name === packageName) return dir
      } catch {
        // Not readable, or not valid JSON -- not the package.json we're
        // looking for either way. Keep climbing.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        `walked up from ${startFile} to the filesystem root without finding a package.json named "${packageName}"`,
      )
    }
    dir = parent
  }
}

let cachedAdapterBetterSqlite3Ctor: (new (file: string) => MinimalSqliteConnection) | undefined

/**
 * Lazily resolves, loads, and caches the SAME `better-sqlite3` build
 * `@prisma/adapter-better-sqlite3` loads internally -- the one
 * `LocalPrismaService`'s connections actually run on, as opposed to the root
 * workspace copy (`Database`, imported at the top of this file) that every
 * other function here uses. See the module doc comment's `restoreSnapshot`
 * bullet for why a probe made through the root copy alone cannot see a lock
 * held through this one.
 *
 * **Located by package identity, not by a fixed monorepo-relative path.**
 * `require.resolve('@prisma/adapter-better-sqlite3')` finds the installed
 * package root the same way in a development checkout (a pnpm-hoisted
 * `node_modules` entry) and in a packaged Electron build (wherever
 * `electron-builder` places it) -- unlike counting `dirname()` calls up from
 * `__dirname`, which only happens to land on the monorepo root in a
 * development checkout (see `native-abi-guard.ts`'s `isDevelopmentCheckout`,
 * which exists precisely because that assumption breaks in a packaged app).
 * This function's result is used by `assertExclusiveAccess`, which -- unlike
 * `native-abi-guard.ts`'s dev-only sanity check -- must work correctly for a
 * real restore in a packaged build too, so it cannot fall back to being a
 * no-op there.
 *
 * The package's own `exports` map has no entry for its nested
 * `node_modules/better-sqlite3` -- confirmed directly (`Package subpath
 * './node_modules/better-sqlite3' is not defined by "exports"`), which is
 * why this reaches in by absolute path at all; the same constraint documented
 * in `apps/desktop/scripts/verify-native-runtime.ts` and
 * `apps/desktop/src/main/local-api.spec.ts`, which probe the identical
 * bundled copy for the identical reason.
 *
 * **This is an internal detail of a third-party package, and this function
 * treats it as fragile on purpose.** If the bundled copy cannot be found
 * exactly where expected, or fails to load, this throws -- loudly, naming
 * what went wrong -- instead of silently proceeding with only the root-build
 * probe. A restore that silently degraded back to today's blind spot the
 * moment this path moved would be worse than an honest, immediate failure:
 * nobody would know protection was gone until it mattered.
 *
 * Calls `assertLocalNativeAbiSelected()` before touching the native binary
 * at all, for the same reason `LocalPrismaService.onModuleInit()` does (see
 * that guard's doc comment): this bundled copy is pre-N-API and tied to the
 * exact runtime it was compiled for, and `require()`-ing the wrong one does
 * not fail gracefully. That check is a no-op outside a development checkout,
 * so it never affects a packaged build, where the bundled copy is already
 * correct by construction.
 */
function loadAdapterBetterSqlite3Ctor(): new (file: string) => MinimalSqliteConnection {
  if (cachedAdapterBetterSqlite3Ctor) return cachedAdapterBetterSqlite3Ctor

  assertLocalNativeAbiSelected()

  let adapterEntry: string
  try {
    adapterEntry = nodeRequire.resolve('@prisma/adapter-better-sqlite3')
  } catch (err) {
    throw new Error(
      'Cannot verify exclusive access to the target database: @prisma/adapter-better-sqlite3 could not be ' +
        `resolved (${(err as Error).message}). Refusing rather than silently skipping the one probe that can see ` +
        "the connection LocalPrismaService's queries actually run on.",
    )
  }

  const adapterRoot = findPackageRoot(adapterEntry, '@prisma/adapter-better-sqlite3')
  const bundledDir = join(adapterRoot, 'node_modules', 'better-sqlite3')

  if (!existsSync(bundledDir)) {
    throw new Error(
      "Cannot verify exclusive access to the target database: expected @prisma/adapter-better-sqlite3's bundled " +
        `better-sqlite3 copy at ${bundledDir}, but nothing exists there. This is an internal detail of a ` +
        'third-party package that this check depends on; if it moved, refusing is safer than silently skipping ' +
        'the one probe that can see the connection LocalPrismaService actually uses.',
    )
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- must be
    // this exact bundled copy, not the root workspace one; see this
    // function's doc comment.
    cachedAdapterBetterSqlite3Ctor = require(bundledDir)
  } catch (err) {
    throw new Error(
      "Cannot verify exclusive access to the target database: requiring @prisma/adapter-better-sqlite3's bundled " +
        `better-sqlite3 copy at ${bundledDir} failed (${(err as Error).message}). Refusing rather than silently ` +
        'skipping this probe.',
    )
  }

  return cachedAdapterBetterSqlite3Ctor as new (file: string) => MinimalSqliteConnection
}

type ExclusiveAccessProbeResult = 'ok' | 'busy' | 'inconclusive'

/**
 * Attempts `BEGIN IMMEDIATE` then `COMMIT` against `file` through a fresh
 * connection built by `ConnectionCtor`, with `busy_timeout = 0` so a
 * conflict fails immediately instead of blocking. Returns `'busy'` only for
 * a `SQLITE_BUSY` error from either statement -- see
 * `assertExclusiveAccess`'s doc comment for exactly what that does and does
 * not mean. Returns `'inconclusive'` for every other way opening or probing
 * `file` can fail (missing, unreadable, corrupt -- not this function's
 * concern; the validation and preservation logic `restoreSnapshot` runs
 * right after handles it honestly). Returns `'ok'` if the probe completed a
 * full `BEGIN IMMEDIATE` + `COMMIT` cycle without contention.
 */
function probeExclusiveAccess(
  ConnectionCtor: new (file: string) => MinimalSqliteConnection,
  file: string,
): ExclusiveAccessProbeResult {
  let db: MinimalSqliteConnection
  try {
    db = new ConnectionCtor(file)
  } catch {
    return 'inconclusive'
  }

  try {
    db.pragma('busy_timeout = 0')

    const isBusy = (err: unknown): boolean => (err as { code?: string }).code === 'SQLITE_BUSY'

    try {
      db.exec('BEGIN IMMEDIATE')
    } catch (err) {
      return isBusy(err) ? 'busy' : 'inconclusive'
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
      return isBusy(err) ? 'busy' : 'inconclusive'
    }

    return 'ok'
  } finally {
    db.close()
  }
}

/**
 * Throws unless `file` can be locked for exclusive access right now, probed
 * through BOTH `better-sqlite3` builds live in this process. Overwriting a
 * SQLite database file while another connection is actively using it is
 * undefined behaviour -- corruption, or a stale page-cache read on that
 * other connection's side, and either way silently. This is the guard
 * `restoreSnapshot` runs before it touches `targetFile` at all.
 *
 * **Why two probes.** Confirmed directly, reproduced on demand: a write
 * transaction held through the copy of `better-sqlite3` bundled inside
 * `@prisma/adapter-better-sqlite3` -- the actual connection
 * `LocalPrismaService` uses for every real query -- is invisible to a probe
 * made through the root workspace copy (the one this file otherwise uses
 * everywhere). SQLite's own documentation warns against linking two copies
 * of the library into one process for exactly this reason: each keeps its
 * own lock bookkeeping, so state changed through one is not guaranteed
 * visible through the other, even against the same file, in the same
 * process. A single-build check that happens to use the root copy therefore
 * proves nothing about the connection that matters -- it can only ever
 * catch another connection that also happens to hold its lock through that
 * same build. So this function probes with the root copy first (cheap, no
 * extra module to load) and, only if that reports no contention, also
 * probes with the adapter's bundled copy (`loadAdapterBetterSqlite3Ctor`) --
 * refusing if *either* reports `SQLITE_BUSY`. This directly closes the gap:
 * a lock held through the adapter's build is now caught by the probe that
 * shares its bookkeeping, not just by one that happens not to.
 *
 * Mechanism (identical for both probes, see `probeExclusiveAccess`): open a
 * plain connection to `file` -- deliberately not through `openLocalDatabase`,
 * which would itself try to force `journal_mode = DELETE`, an unwanted side
 * effect for a connection whose only job here is to check, not to configure
 * -- disable the busy-retry wait (`busy_timeout = 0`, so a conflict fails
 * immediately instead of blocking this call for seconds), and attempt
 * `BEGIN IMMEDIATE` followed by `COMMIT`. Under `DELETE` journal mode --
 * which every live database file in this app is required to be in --
 * `BEGIN IMMEDIATE` and `BEGIN EXCLUSIVE` are the same lock escalation (they
 * only differ under WAL). A `SQLITE_BUSY` error from either statement,
 * specifically, means some other connection using that same build currently
 * holds a conflicting lock; it is turned into a refusal that names `file`
 * and tells the caller to close it first.
 *
 * Only `SQLITE_BUSY` is treated as "in use." Any other failure while
 * probing -- `file` not opening at all, or a write attempt failing because
 * the file is corrupt -- is not a locking conflict and is deliberately left
 * alone here: it is not this function's job to report, and the validation
 * and preservation logic `restoreSnapshot` runs right after this check
 * already handles a corrupt or unreadable target on its own, honestly. This
 * check does one thing: tell an active conflicting connection, in either
 * build, apart from every other reason `file` might be unusable.
 *
 * What this provably catches, now: another connection -- through EITHER
 * `better-sqlite3` build live in this process -- that is genuinely
 * mid-transaction against `file` at the moment this check runs, whether that
 * transaction is reading or writing. An open write transaction on another
 * connection already holds the RESERVED lock the matching-build probe needs,
 * so its `BEGIN IMMEDIATE` itself fails immediately; an open read
 * transaction holds a SHARED lock that is compatible with another connection
 * also holding RESERVED, so `BEGIN IMMEDIATE` succeeds but the follow-up
 * `COMMIT` -- which must escalate to EXCLUSIVE to finish -- fails instead.
 * Either way this function throws, and the half-open probe transaction is
 * rolled back before the probe connection is closed.
 *
 * What this does NOT catch, and structurally cannot, even with both builds
 * probed: a connection that is open but idle -- constructed and never used
 * yet, or simply between statements in autocommit mode -- holds no SQLite
 * lock at all in `DELETE` journal mode, through either build, so no probe
 * can see it and it will let the restore proceed. It also only checks at one
 * instant, immediately before the restore begins; it does not hold the lock
 * for the restore's duration, so a connection that opens and starts a
 * transaction in the brief window between this check and `restoreSnapshot`'s
 * final `renameSync` is not caught either. Neither gap is closable from
 * user-space with SQLite's own locking primitives, through any number of
 * builds -- they are exactly why `restoreSnapshot` also requires its caller
 * to close its own connection to `file` first, as a required argument this
 * function itself runs immediately before probing (see `restoreSnapshot`'s
 * doc comment), rather than trusting a comment to be remembered.
 */
function assertExclusiveAccess(file: string): void {
  const rootProbe = probeExclusiveAccess(Database, file)
  if (rootProbe === 'busy') {
    throw new Error(
      `Refusing to restore over ${file}: another connection (the root better-sqlite3 build) is actively using it ` +
        'right now. Close every open connection to this database before restoring.',
    )
  }

  const adapterProbe = probeExclusiveAccess(loadAdapterBetterSqlite3Ctor(), file)
  if (adapterProbe === 'busy') {
    throw new Error(
      `Refusing to restore over ${file}: another connection (the better-sqlite3 build bundled inside ` +
        '@prisma/adapter-better-sqlite3, which is what LocalPrismaService actually runs queries on) is actively ' +
        'using it right now. Close every open connection to this database before restoring.',
    )
  }
}

/**
 * A caller-supplied action that closes every connection this process
 * currently holds open to the restore target. `restoreSnapshot` calls this
 * itself -- awaiting it fully -- immediately before its own lock probe (see
 * `assertExclusiveAccess`), rather than trusting the caller to have closed
 * it at some earlier point of their own choosing.
 *
 * **Why this exists, on top of the lock probe.** `assertExclusiveAccess`,
 * even probing both `better-sqlite3` builds live in this process, has a gap
 * it cannot close: a connection that is open but idle -- constructed and
 * never used, or simply between statements in autocommit mode -- holds no
 * SQLite lock at all, so no probe can see it. The actual guarantee a restore
 * depends on is the application closing its own connection first. Task 3
 * (`switchProfile`, `apps/desktop/src/main/local-api.ts`) already built and
 * proved exactly that teardown, with a real OS-level lock, for profile
 * switching. Requiring this callback -- and running it here, at the one
 * moment that matters, rather than leaving the caller to remember to do it
 * earlier -- turns "close your connection before calling this" from a
 * paragraph in a comment into something the type checker refuses to compile
 * without, and collapses the window between "closed" and "checked" to zero
 * application code.
 *
 * **What this does NOT, and cannot, guarantee.** This is an attestation the
 * caller runs, not a fact `restoreSnapshot` independently verifies: nothing
 * stops a caller from passing a no-op, and nothing here can detect that.
 * What changes is that skipping the close is now a visible, deliberate
 * choice written at the call site, not an easy thing to simply forget --
 * and, for a caller that wires up its real close function (as
 * `LocalApiHandle.close` naturally is), the connection really is gone before
 * the probe below ever runs.
 */
export type CloseExistingConnections = () => void | Promise<void>

/**
 * Replaces `targetFile` with the contents of `snapshotPath`.
 *
 * Before overwriting anything, `snapshotPath` is validated the same way a
 * freshly written snapshot is (open read-only, `PRAGMA integrity_check`):
 * restoring from a file that is not a valid SQLite database throws and
 * leaves `targetFile` untouched.
 *
 * If `targetFile` currently exists, this first awaits `closeExistingConnections`
 * (see that type's doc comment for what it does and does not guarantee),
 * then requires exclusive access to it (see `assertExclusiveAccess` for
 * exactly what that does and does not catch), then preserves it (see
 * `preserveTargetBeforeRestore`) into the same directory as `snapshotPath`,
 * under `databaseId`, so the restore is itself undoable. If `targetFile`
 * does not exist yet, there is no prior state to protect, lock, or close a
 * connection to, so all three steps are skipped rather than fabricating an
 * empty database to back up or check.
 *
 * The replacement itself is atomic: `snapshotPath` is copied into a
 * temporary file in `targetFile`'s own directory (so the rename below stays
 * on one filesystem), that copy is validated, and only then is it
 * `renameSync`d over `targetFile`. If the copy or its validation fails, the
 * temporary file is removed and `targetFile` is left exactly as it was --
 * a same-filesystem rename cannot leave `targetFile` half-old, half-new.
 */
export async function restoreSnapshot(
  snapshotPath: string,
  targetFile: string,
  databaseId: string,
  now: Date,
  closeExistingConnections: CloseExistingConnections,
): Promise<void> {
  assertValidDatabaseFile(snapshotPath, 'Cannot restore snapshot')

  if (existsSync(targetFile)) {
    await closeExistingConnections()
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

/**
 * Copies `file` to `destination` for the user-initiated "export a profile"
 * action (Phase 4c task 4, design decision D8) -- deliberately NOT a
 * snapshot: `destination` is wherever the user picked via a native save
 * dialog (`apps/desktop/src/main/index.ts`'s `backups:export` handler),
 * possibly on a different filesystem or a removable drive, so this is a
 * plain copy, not `restoreSnapshot`'s atomic temp-then-rename replacement of
 * a LIVE file -- there is nothing already at `destination` for a partial
 * write to corrupt, and an interrupted export is simply retried by the user.
 * This export is never written into `backupDir`, never counted against
 * `MAX_SNAPSHOTS_PER_DATABASE`, and never returned by `listSnapshots` or
 * `listPreservationCopies`.
 *
 * Still applies the same two checks every other copy in this module does,
 * for the same reasons: `assertDeleteJournalMode` first (a copy taken in WAL
 * mode can silently miss committed data -- see the module doc comment), and
 * `assertValidDatabaseFile` on the freshly written copy afterward (a
 * snapshot nobody has read is a guess, not a backup -- and an export is
 * exactly a backup the user is about to carry off this machine, so it must
 * not silently be handed to them broken).
 *
 * Throws, without writing anything, if `file` is not currently in DELETE
 * journal mode. Throws, after the copy already exists at `destination`, if
 * it fails `PRAGMA integrity_check` -- deliberately does NOT delete
 * `destination` in that case (unlike `snapshotDatabase`'s cleanup of a
 * failed snapshot in `backupDir`): `destination` is a location the user
 * chose outside this app's own storage, and silently deleting a file there
 * -- even one this function just wrote -- is not this function's call to
 * make. The thrown error still names what is wrong, so the user knows not
 * to trust it.
 */
export function exportDatabaseCopy(file: string, destination: string): void {
  assertDeleteJournalMode(file)
  copyFileSync(file, destination)
  assertValidDatabaseFile(destination, 'Export failed validation after being written')
}
