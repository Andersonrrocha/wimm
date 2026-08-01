import * as fs from 'fs'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
// Same import form as open-local-database.ts: this package has
// `allowSyntheticDefaultImports` but not `esModuleInterop`, so a default
// import typechecks but is `undefined` at runtime for this CommonJS module.
import Database = require('better-sqlite3')
import { openLocalDatabase } from './open-local-database'
import {
  checkDatabaseHealth,
  CloseExistingConnections,
  exportDatabaseCopy,
  listPreservationCopies,
  listSnapshots,
  restoreSnapshot,
  snapshotDatabase,
} from './snapshot'

const ROOT = '/tmp/wimm-snapshot-spec'
const DB_FILE = join(ROOT, 'wimm.db')
const OTHER_DB_FILE = join(ROOT, 'other.db')
const BACKUP_DIR = join(ROOT, 'backups')

/** No connection to close in most of these tests -- an explicit no-op, not an implicit default. */
const NO_OP_CLOSE: CloseExistingConnections = () => {}

// --- The cross-build lock probe (the defect this file's guard now fixes) ---
//
// Two different compiled `better-sqlite3` libraries are live in this
// process: the root workspace copy (`Database`, imported above, the one
// every other helper in this file uses), and the copy
// `@prisma/adapter-better-sqlite3` bundles internally -- the one
// `LocalPrismaService`'s connections actually run on. Proven directly: a
// write transaction held through one build is invisible to a probe made
// through the other. `assertExclusiveAccess` (`snapshot.ts`) now probes both;
// the tests below hold a lock through EACH build in turn to prove that.
//
// `ADAPTER_BETTER_SQLITE3_DIR` is the exact path `scripts/select-native-abi.ts`,
// `apps/desktop/scripts/verify-native-runtime.ts`, and
// `apps/desktop/src/main/local-api.spec.ts` already use for this same bundled
// copy -- its own `package.json` `exports` map blocks a bare
// `require('better-sqlite3')` from ever resolving to it.
const ADAPTER_BETTER_SQLITE3_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3',
)

interface AdapterBuildDatabase {
  pragma(sql: string): unknown
  exec(sql: string): unknown
  close(): void
}

// eslint-disable-next-line @typescript-eslint/no-var-requires -- must be the exact bundled build, not the root workspace one; see the comment above.
const AdapterDatabase = require(ADAPTER_BETTER_SQLITE3_DIR) as new (file: string) => AdapterBuildDatabase

function createDatabase(file: string, values: string[]): void {
  const db = openLocalDatabase(file)
  db.exec('CREATE TABLE items ("value" TEXT NOT NULL)')
  const insert = db.prepare('INSERT INTO items ("value") VALUES (?)')
  for (const value of values) insert.run(value)
  db.close()
}

function insertRow(file: string, value: string): void {
  const db = openLocalDatabase(file)
  db.prepare('INSERT INTO items ("value") VALUES (?)').run(value)
  db.close()
}

function readRows(file: string): string[] {
  const db = openLocalDatabase(file, { readonly: true })
  const rows = db.prepare('SELECT "value" FROM items ORDER BY rowid').all() as Array<{ value: string }>
  db.close()
  return rows.map((row) => row.value)
}

/** Truncates `file` down to just its 100-byte SQLite header, corrupting it. */
function truncateToHeaderOnly(file: string): void {
  const header = readFileSync(file).subarray(0, 100)
  writeFileSync(file, header)
}

describe('snapshotDatabase / listSnapshots / restoreSnapshot', () => {
  beforeEach(() => {
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    // Belt and suspenders: also clean up any stray WAL/SHM siblings that a
    // test deliberately forcing WAL mode might leave outside ROOT-relative
    // cleanup ordering.
    for (const f of [DB_FILE, OTHER_DB_FILE]) {
      rmSync(`${f}-wal`, { force: true })
      rmSync(`${f}-shm`, { force: true })
    }
  })

  it('produces a snapshot whose known row can be opened and read back', () => {
    createDatabase(DB_FILE, ['alpha'])

    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    expect(readRows(snapshotPath)).toEqual(['alpha'])
  })

  it('encodes the databaseId and a sortable timestamp in the filename', () => {
    createDatabase(DB_FILE, ['alpha'])

    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-02T03:04:05.006Z'))

    expect(basename(snapshotPath)).toBe('wimm.db.20260102T030405006Z.snapshot.db')
  })

  it('prunes to the newest 5 snapshots, removing the oldest first', () => {
    createDatabase(DB_FILE, ['alpha'])
    const base = new Date('2026-01-01T00:00:00.000Z').getTime()

    // Each iteration changes the database first, so every call produces a
    // genuinely new snapshot -- an unchanged database is deliberately
    // deduplicated (see the "redundant snapshot" tests below) and would
    // never reach 6 distinct snapshots to prune from.
    const paths = Array.from({ length: 6 }, (_, i) => {
      if (i > 0) insertRow(DB_FILE, `row-${i}`)
      return snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date(base + i * 1000))
    })

    const remaining = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(remaining).toHaveLength(5)
    expect(existsSync(paths[0])).toBe(false)
    for (const survivor of paths.slice(1)) {
      expect(existsSync(survivor)).toBe(true)
    }
  })

  it('prunes only the snapshots of the databaseId being snapshotted, leaving other databases untouched', () => {
    createDatabase(DB_FILE, ['alpha'])
    createDatabase(OTHER_DB_FILE, ['beta'])
    const base = new Date('2026-01-01T00:00:00.000Z').getTime()

    for (let i = 0; i < 6; i++) {
      // See the comment in the "prunes to the newest 5 snapshots" test above:
      // each call must change the database first, or an unchanged database
      // would be deduplicated instead of producing 6 distinct snapshots.
      if (i > 0) insertRow(OTHER_DB_FILE, `other-row-${i}`)
      snapshotDatabase(OTHER_DB_FILE, BACKUP_DIR, 'other.db', new Date(base + i * 1000))
    }
    const dbSnapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date(base + 6000))

    expect(listSnapshots(BACKUP_DIR, 'other.db')).toHaveLength(5)
    const wimmSnapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(wimmSnapshots).toHaveLength(1)
    expect(wimmSnapshots[0].path).toBe(dbSnapshotPath)
  })

  it('scopes snapshots by the caller-supplied databaseId, not by file basename, so two databases with the same basename never prune or list each other', () => {
    // Phase 3 scenario: every profile's database is named `wimm.db`, and all
    // profiles share one backup directory. Only the caller-supplied id (not
    // the shared basename) may determine which snapshots belong to whom.
    const aliceDir = join(ROOT, 'alice')
    const bobDir = join(ROOT, 'bob')
    const aliceFile = join(aliceDir, 'wimm.db')
    const bobFile = join(bobDir, 'wimm.db')
    mkdirSync(aliceDir, { recursive: true })
    mkdirSync(bobDir, { recursive: true })
    createDatabase(aliceFile, ['alice-1'])
    createDatabase(bobFile, ['bob-1'])
    expect(basename(aliceFile)).toBe(basename(bobFile))

    const base = new Date('2026-01-01T00:00:00.000Z').getTime()
    // Alice snapshots first (and only once), so under the old basename-keyed
    // pruning her single snapshot would be the oldest of the combined set
    // and would be the first one evicted once Bob's snapshots push the
    // combined count past the retention limit.
    const aliceSnapshotPath = snapshotDatabase(aliceFile, BACKUP_DIR, 'alice', new Date(base))
    for (let i = 1; i <= 6; i++) {
      // See the comment in the "prunes to the newest 5 snapshots" test above:
      // each call must change the database first, or an unchanged database
      // would be deduplicated instead of producing 6 distinct snapshots.
      if (i > 1) insertRow(bobFile, `bob-row-${i}`)
      snapshotDatabase(bobFile, BACKUP_DIR, 'bob', new Date(base + i * 1000))
    }

    const aliceSnapshots = listSnapshots(BACKUP_DIR, 'alice')
    const bobSnapshots = listSnapshots(BACKUP_DIR, 'bob')

    expect(aliceSnapshots).toHaveLength(1)
    expect(aliceSnapshots[0].path).toBe(aliceSnapshotPath)
    expect(existsSync(aliceSnapshotPath)).toBe(true)
    expect(readRows(aliceSnapshotPath)).toEqual(['alice-1'])

    expect(bobSnapshots).toHaveLength(5)
    for (const snapshot of bobSnapshots) {
      // Each snapshot has different content (see above), but none of them
      // is ever Alice's -- proving the two ids' snapshots never cross.
      const rows = readRows(snapshot.path)
      expect(rows[0]).toBe('bob-1')
      expect(rows).not.toContain('alice-1')
    }
  })

  it('lists snapshots newest first', () => {
    createDatabase(DB_FILE, ['alpha'])
    const t1 = new Date('2026-01-01T00:00:00.000Z')
    const t2 = new Date('2026-01-01T00:00:01.000Z')
    const t3 = new Date('2026-01-01T00:00:02.000Z')

    // Each call changes the database first -- an unchanged database is
    // deliberately deduplicated (see the "redundant snapshot" tests below)
    // rather than producing a new, distinct snapshot to order.
    snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', t1)
    insertRow(DB_FILE, 'beta')
    snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', t2)
    insertRow(DB_FILE, 'gamma')
    snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', t3)

    const snapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(snapshots.map((s) => s.takenAt.toISOString())).toEqual([t3.toISOString(), t2.toISOString(), t1.toISOString()])
  })

  it('reports snapshot size in bytes', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    const [info] = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(info.path).toBe(snapshotPath)
    expect(info.sizeBytes).toBeGreaterThan(0)
  })

  it('refuses to snapshot a database that is not in DELETE journal mode, naming WAL explicitly', () => {
    createDatabase(DB_FILE, ['alpha'])
    // Bypass openLocalDatabase deliberately: it always forces DELETE mode, so
    // we need a raw handle to put the file into the dangerous state we are
    // asserting against.
    const raw = new Database(DB_FILE)
    raw.pragma('journal_mode = WAL')
    raw.close()

    expect(() => snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))).toThrow(/WAL/)
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(0)

    // Restore the fixture to DELETE mode so afterEach cleanup of a plain
    // -wal/-shm-free file is not relied upon for correctness elsewhere.
    const cleanup = new Database(DB_FILE)
    cleanup.pragma('journal_mode = DELETE')
    cleanup.close()
  })

  it('throws and removes the snapshot file when the written copy fails integrity_check', () => {
    createDatabase(DB_FILE, ['alpha'])

    // Truncate to just the 100-byte SQLite header: the header alone still
    // reports journal_mode correctly (it is read directly from fixed
    // offsets), but every page of actual content is gone, so a full
    // PRAGMA integrity_check walk cannot succeed. This proves the
    // integrity check genuinely runs against the file that was written,
    // rather than trusting the copy blindly.
    truncateToHeaderOnly(DB_FILE)

    expect(() => snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))).toThrow()
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(0)
  })

  it('restores the target and leaves the pre-restore state recoverable as its own snapshot', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    insertRow(DB_FILE, 'beta')
    expect(readRows(DB_FILE)).toEqual(['alpha', 'beta'])

    await restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'), NO_OP_CLOSE)

    expect(readRows(DB_FILE)).toEqual(['alpha'])

    const snapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    const preRestoreSnapshot = snapshots.find((s) => s.path !== snapshotPath)
    expect(preRestoreSnapshot).toBeDefined()
    expect(readRows(preRestoreSnapshot!.path)).toEqual(['alpha', 'beta'])
  })

  it('does not attempt to snapshot a target that does not exist yet before restoring into it, and never calls closeExistingConnections either', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    const freshTarget = join(ROOT, 'fresh.db')
    const closeExistingConnections = jest.fn()

    expect(existsSync(freshTarget)).toBe(false)
    await restoreSnapshot(snapshotPath, freshTarget, 'fresh', new Date('2026-01-01T00:00:10.000Z'), closeExistingConnections)

    expect(readRows(freshTarget)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'fresh')).toHaveLength(0)
    // Nothing existed to close a connection to -- calling it anyway would be
    // asking the caller to close a connection to a file that isn't open.
    expect(closeExistingConnections).not.toHaveBeenCalled()
  })

  it('throws when restoring from a file that is not a valid SQLite database, leaving the target untouched', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const bogusPath = join(ROOT, 'not-a-database.db')
    writeFileSync(bogusPath, 'this is definitely not a sqlite file')

    await expect(restoreSnapshot(bogusPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'), NO_OP_CLOSE)).rejects.toThrow()
    expect(readRows(DB_FILE)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(0)
  })

  it('leaves the target byte-identical to before when the copy into the temp file is interrupted', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    insertRow(DB_FILE, 'beta')
    const before = readFileSync(DB_FILE)

    // Simulate an interrupted restore write: let the real copyFileSync run
    // (so the target is untouched either way), but truncate the copy that
    // lands in the *temp* file specifically -- the one restoreSnapshot must
    // validate before it is ever allowed to replace the target.
    const realCopyFileSync = fs.copyFileSync
    const spy = jest
      .spyOn(fs, 'copyFileSync')
      .mockImplementation((src: fs.PathLike, dest: fs.PathLike, mode?: number) => {
        realCopyFileSync(src, dest, mode)
        const destPath = String(dest)
        if (destPath.includes('.restoring-')) {
          truncateToHeaderOnly(destPath)
        }
      })

    try {
      await expect(
        restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:20.000Z'), NO_OP_CLOSE),
      ).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }

    const after = readFileSync(DB_FILE)
    expect(after.equals(before)).toBe(true)
    expect(readRows(DB_FILE)).toEqual(['alpha', 'beta'])

    // No leftover temp file from the interrupted write.
    const leftovers = readdirSync(ROOT).filter((name) => name.includes('.restoring-'))
    expect(leftovers).toEqual([])
  })

  it('restores over a corrupt target, preserving it as an unvalidated copy that listSnapshots never returns', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const goodSnapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    // Corrupt the live target the same way the "fails integrity_check" test
    // above does: this is the exact scenario a restore exists for.
    truncateToHeaderOnly(DB_FILE)

    await restoreSnapshot(goodSnapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:20.000Z'), NO_OP_CLOSE)

    expect(readRows(DB_FILE)).toEqual(['alpha'])

    const listed = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(listed.map((s) => s.path)).toEqual([goodSnapshotPath])

    const preserved = readdirSync(BACKUP_DIR).filter((name) => name.includes('unvalidated'))
    expect(preserved).toHaveLength(1)
  })

  // Item 1: restoreSnapshot must refuse to overwrite a target that another
  // connection is actively using. The lock this test contends for is real --
  // a genuine second `better-sqlite3` connection with an open transaction,
  // not a stub of the lock-check mechanism itself.
  it('refuses to restore over a target that another connection actively holds an open transaction against, through the ROOT better-sqlite3 build, naming the file', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    // A real second connection to the target, with a real, held SQLite lock.
    const busyConnection = new Database(DB_FILE)
    busyConnection.exec('BEGIN IMMEDIATE')
    busyConnection.prepare('INSERT INTO items ("value") VALUES (?)').run('uncommitted')

    let before: Buffer
    try {
      before = readFileSync(DB_FILE)

      await expect(
        restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'), NO_OP_CLOSE),
      ).rejects.toThrow(DB_FILE)
    } finally {
      busyConnection.exec('ROLLBACK')
      busyConnection.close()
    }

    // Nothing was touched: no preservation copy, no rename, byte-identical.
    const after = readFileSync(DB_FILE)
    expect(after.equals(before!)).toBe(true)
    expect(readRows(DB_FILE)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(1)
  })

  // This is the defect this fix closes. Before it, a lock held ONLY through
  // the adapter's bundled build (the one LocalPrismaService's connections
  // actually run on) was invisible to assertExclusiveAccess, which probed
  // exclusively through the root build -- see the module doc comment's
  // "Two different compiled SQLite libraries" note and this task's report
  // for the confirmed, reproduced case. Structurally identical to the test
  // above; the only difference is which build holds the lock.
  it('refuses to restore over a target that another connection actively holds an open transaction against, through the ADAPTER-bundled better-sqlite3 build (the build LocalPrismaService actually runs on), naming the file', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    const busyConnection = new AdapterDatabase(DB_FILE)
    busyConnection.exec('BEGIN IMMEDIATE')
    busyConnection.exec("INSERT INTO items (\"value\") VALUES ('uncommitted')")

    let before: Buffer
    try {
      before = readFileSync(DB_FILE)

      await expect(
        restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'), NO_OP_CLOSE),
      ).rejects.toThrow(DB_FILE)
    } finally {
      busyConnection.exec('ROLLBACK')
      busyConnection.close()
    }

    const after = readFileSync(DB_FILE)
    expect(after.equals(before!)).toBe(true)
    expect(readRows(DB_FILE)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(1)
  })

  it('does not refuse a restore merely because another connection to the target is open but idle', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    insertRow(DB_FILE, 'beta')

    // Documented limitation: a connection that is open but has no pending
    // transaction or in-flight statement holds no SQLite lock in DELETE
    // journal mode, so the exclusive-access check cannot see it, through
    // either build.
    const idleConnection = new Database(DB_FILE)
    try {
      await expect(
        restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'), NO_OP_CLOSE),
      ).resolves.toBeUndefined()
    } finally {
      idleConnection.close()
    }

    expect(readRows(DB_FILE)).toEqual(['alpha'])
  })

  // Item 2: restoreSnapshot must actually run and await
  // closeExistingConnections -- not merely accept it as an unused parameter.
  it('awaits closeExistingConnections before probing for exclusive access, so a caller that genuinely closes its own connection there unblocks the restore', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    // Held through the adapter build specifically -- the harder of the two
    // cases now that both are probed.
    const busyConnection = new AdapterDatabase(DB_FILE)
    busyConnection.exec('BEGIN IMMEDIATE')
    busyConnection.exec("INSERT INTO items (\"value\") VALUES ('uncommitted')")

    let closeCalledBeforeProbe = false
    const closeExistingConnections: CloseExistingConnections = async () => {
      // If restoreSnapshot probed before awaiting this, the lock would still
      // be held here and the assertion below on the restore's own outcome
      // would fail -- this callback is what actually releases it.
      await Promise.resolve()
      busyConnection.exec('ROLLBACK')
      busyConnection.close()
      closeCalledBeforeProbe = true
    }

    await restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'), closeExistingConnections)

    expect(closeCalledBeforeProbe).toBe(true)
    // The restore actually went through -- proof the probe ran AFTER the
    // close resolved, not before it.
    expect(readRows(DB_FILE)).toEqual(['alpha'])
  })

  it('propagates a failure from closeExistingConnections without touching the target', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    insertRow(DB_FILE, 'beta')
    const before = readFileSync(DB_FILE)

    const closeExistingConnections: CloseExistingConnections = () => {
      throw new Error('pretend closing the connection failed')
    }

    await expect(
      restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'), closeExistingConnections),
    ).rejects.toThrow('pretend closing the connection failed')

    const after = readFileSync(DB_FILE)
    expect(after.equals(before)).toBe(true)
    expect(readRows(DB_FILE)).toEqual(['alpha', 'beta'])
    // No preservation copy either -- the failure happened before
    // assertExclusiveAccess or preserveTargetBeforeRestore ever ran.
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(1)
  })

  // Item 3: assertValidDatabaseFile's logic must be reachable from outside
  // this module, in a shape a UI can display instead of crashing on.
  it('checkDatabaseHealth reports a healthy database without throwing', () => {
    createDatabase(DB_FILE, ['alpha'])

    expect(checkDatabaseHealth(DB_FILE)).toEqual({ healthy: true, problem: null })
  })

  it('checkDatabaseHealth reports a corrupt database as unhealthy, describing the problem, without throwing', () => {
    createDatabase(DB_FILE, ['alpha'])
    truncateToHeaderOnly(DB_FILE)

    const result = checkDatabaseHealth(DB_FILE)

    expect(result.healthy).toBe(false)
    expect(result.problem).toMatch(/integrity_check/)
  })

  it('checkDatabaseHealth reports a non-database file as unhealthy, describing the problem, without throwing', () => {
    const bogusPath = join(ROOT, 'not-a-database-health-check.db')
    writeFileSync(bogusPath, 'this is definitely not a sqlite file')

    const result = checkDatabaseHealth(bogusPath)

    expect(result.healthy).toBe(false)
    expect(result.problem).toMatch(/is not a database/)
  })

  // Item 4: an unchanged database must not consume a retention slot.
  it('does not take a redundant snapshot when the database is unchanged since the newest existing snapshot, and does not consume a retention slot', () => {
    createDatabase(DB_FILE, ['alpha'])
    const first = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    // Nothing changed in the database between these two calls.
    const second = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'))

    expect(second).toBe(first)
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(1)
  })

  it('still takes a new snapshot when the database has changed since the newest existing snapshot', () => {
    createDatabase(DB_FILE, ['alpha'])
    const first = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    insertRow(DB_FILE, 'beta')

    const second = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'))

    expect(second).not.toBe(first)
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(2)
  })
})

// --- Phase 4c task 4: schema version, preservation-copy listing, export ---

/** Creates `_prisma_migrations` (matching migration-runner.ts's own DDL) on `file` and records `migrationName` as applied. */
function recordAppliedMigration(file: string, migrationName: string, startedAt: string): void {
  const db = openLocalDatabase(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) NOT NULL PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" DATETIME,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `)
  db.prepare(
    `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(`id-${migrationName}`, 'x'.repeat(64), startedAt, migrationName, startedAt)
  db.close()
}

describe('SnapshotInfo.schemaVersion (Phase 4c task 4, carry-over 2)', () => {
  beforeEach(() => {
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('reports the newest applied migration name from a snapshot that has one', () => {
    createDatabase(DB_FILE, ['alpha'])
    recordAppliedMigration(DB_FILE, '0001_init', '2026-01-01T00:00:00.000Z')
    recordAppliedMigration(DB_FILE, '0002_add_column', '2026-01-02T00:00:00.000Z')

    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-03T00:00:00.000Z'))

    const [info] = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(info.path).toBe(snapshotPath)
    expect(info.schemaVersion).toBe('0002_add_column')
  })

  it('reports null when the snapshot has no _prisma_migrations table at all', () => {
    createDatabase(DB_FILE, ['alpha'])

    snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    const [info] = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(info.schemaVersion).toBeNull()
  })

  it('two snapshots taken before and after an upgrade report different schema versions, so a picker can tell them apart', () => {
    createDatabase(DB_FILE, ['alpha'])
    recordAppliedMigration(DB_FILE, '0001_init', '2026-01-01T00:00:00.000Z')
    const before = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T01:00:00.000Z'))

    insertRow(DB_FILE, 'beta')
    recordAppliedMigration(DB_FILE, '0002_broke_things', '2026-01-02T00:00:00.000Z')
    const after = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-02T01:00:00.000Z'))

    const snapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    const beforeInfo = snapshots.find((s) => s.path === before)!
    const afterInfo = snapshots.find((s) => s.path === after)!

    expect(beforeInfo.schemaVersion).toBe('0001_init')
    expect(afterInfo.schemaVersion).toBe('0002_broke_things')
  })
})

describe('listPreservationCopies (Phase 4c task 4, carry-over 1)', () => {
  beforeEach(() => {
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('returns an empty array when backupDir does not exist yet', () => {
    expect(listPreservationCopies(BACKUP_DIR, 'wimm.db')).toEqual([])
  })

  it('lists the unvalidated preservation copy restoreSnapshot writes for a corrupt target, with its size and a null schema version', async () => {
    createDatabase(DB_FILE, ['alpha'])
    const goodSnapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    // Corrupt the live target, exactly like the "restores over a corrupt
    // target" test in the main describe block above.
    truncateToHeaderOnly(DB_FILE)

    await restoreSnapshot(goodSnapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:20.000Z'), NO_OP_CLOSE)

    const copies = listPreservationCopies(BACKUP_DIR, 'wimm.db')
    expect(copies).toHaveLength(1)
    expect(copies[0].path).toContain('unvalidated')
    expect(copies[0].sizeBytes).toBeGreaterThan(0)
    // The corrupted (header-only) source can never yield a readable
    // _prisma_migrations table -- proving this reads best-effort, not
    // throwing, for exactly the case it exists to cover.
    expect(copies[0].schemaVersion).toBeNull()

    // Disjoint from listSnapshots -- still true after this task's changes,
    // matching the existing "never returns" test in the main describe block.
    expect(listSnapshots(BACKUP_DIR, 'wimm.db').map((s) => s.path)).toEqual([goodSnapshotPath])
  })

  it('scopes preservation copies by databaseId, the same way listSnapshots does', async () => {
    createDatabase(DB_FILE, ['alpha'])
    createDatabase(OTHER_DB_FILE, ['beta'])
    const snapA = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    snapshotDatabase(OTHER_DB_FILE, BACKUP_DIR, 'other.db', new Date('2026-01-01T00:00:00.000Z'))

    truncateToHeaderOnly(DB_FILE)
    await restoreSnapshot(snapA, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:20.000Z'), NO_OP_CLOSE)

    expect(listPreservationCopies(BACKUP_DIR, 'wimm.db')).toHaveLength(1)
    expect(listPreservationCopies(BACKUP_DIR, 'other.db')).toEqual([])
  })
})

describe('exportDatabaseCopy', () => {
  beforeEach(() => {
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('copies the database to an arbitrary destination outside backupDir, readable and untracked by listSnapshots', () => {
    createDatabase(DB_FILE, ['alpha'])
    const destination = join(ROOT, 'exported-elsewhere.db')

    exportDatabaseCopy(DB_FILE, destination)

    expect(existsSync(destination)).toBe(true)
    expect(readRows(destination)).toEqual(['alpha'])
    // Never written into backupDir, never a snapshot.
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toEqual([])
  })

  it('refuses to export a database that is not in DELETE journal mode, naming WAL explicitly, and writes nothing', () => {
    createDatabase(DB_FILE, ['alpha'])
    const raw = new Database(DB_FILE)
    raw.pragma('journal_mode = WAL')
    raw.close()

    const destination = join(ROOT, 'should-not-exist.db')
    expect(() => exportDatabaseCopy(DB_FILE, destination)).toThrow(/WAL/)
    expect(existsSync(destination)).toBe(false)

    const cleanup = new Database(DB_FILE)
    cleanup.pragma('journal_mode = DELETE')
    cleanup.close()
  })

  it('refuses to export a corrupt source database, matching the identical setup the main describe block above uses for snapshotDatabase', () => {
    createDatabase(DB_FILE, ['alpha'])
    truncateToHeaderOnly(DB_FILE)
    const destination = join(ROOT, 'corrupt-export.db')

    // Mirrors the "throws and removes the snapshot file when the written
    // copy fails integrity_check" test above, which uses the identical
    // fixture and also asserts only a generic throw: truncating to the
    // 100-byte header can fail either assertDeleteJournalMode's own
    // pragma read or the later assertValidDatabaseFile integrity_check,
    // depending on exactly how much of page 1 survives -- what matters
    // here is that exportDatabaseCopy refuses either way, never handing
    // the user a silently broken export.
    expect(() => exportDatabaseCopy(DB_FILE, destination)).toThrow()
  })
})
