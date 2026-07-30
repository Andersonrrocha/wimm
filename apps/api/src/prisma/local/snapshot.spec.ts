import * as fs from 'fs'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
// Same import form as open-local-database.ts: this package has
// `allowSyntheticDefaultImports` but not `esModuleInterop`, so a default
// import typechecks but is `undefined` at runtime for this CommonJS module.
import Database = require('better-sqlite3')
import { openLocalDatabase } from './open-local-database'
import { checkDatabaseHealth, listSnapshots, restoreSnapshot, snapshotDatabase } from './snapshot'

const ROOT = '/tmp/wimm-snapshot-spec'
const DB_FILE = join(ROOT, 'wimm.db')
const OTHER_DB_FILE = join(ROOT, 'other.db')
const BACKUP_DIR = join(ROOT, 'backups')

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

  it('restores the target and leaves the pre-restore state recoverable as its own snapshot', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    insertRow(DB_FILE, 'beta')
    expect(readRows(DB_FILE)).toEqual(['alpha', 'beta'])

    restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'))

    expect(readRows(DB_FILE)).toEqual(['alpha'])

    const snapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    const preRestoreSnapshot = snapshots.find((s) => s.path !== snapshotPath)
    expect(preRestoreSnapshot).toBeDefined()
    expect(readRows(preRestoreSnapshot!.path)).toEqual(['alpha', 'beta'])
  })

  it('does not attempt to snapshot a target that does not exist yet before restoring into it', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    const freshTarget = join(ROOT, 'fresh.db')

    expect(existsSync(freshTarget)).toBe(false)
    restoreSnapshot(snapshotPath, freshTarget, 'fresh', new Date('2026-01-01T00:00:10.000Z'))

    expect(readRows(freshTarget)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'fresh')).toHaveLength(0)
  })

  it('throws when restoring from a file that is not a valid SQLite database, leaving the target untouched', () => {
    createDatabase(DB_FILE, ['alpha'])
    const bogusPath = join(ROOT, 'not-a-database.db')
    writeFileSync(bogusPath, 'this is definitely not a sqlite file')

    expect(() => restoreSnapshot(bogusPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))).toThrow()
    expect(readRows(DB_FILE)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(0)
  })

  it('leaves the target byte-identical to before when the copy into the temp file is interrupted', () => {
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
      expect(() => restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:20.000Z'))).toThrow()
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

  it('restores over a corrupt target, preserving it as an unvalidated copy that listSnapshots never returns', () => {
    createDatabase(DB_FILE, ['alpha'])
    const goodSnapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    // Corrupt the live target the same way the "fails integrity_check" test
    // above does: this is the exact scenario a restore exists for.
    truncateToHeaderOnly(DB_FILE)

    restoreSnapshot(goodSnapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:20.000Z'))

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
  it('refuses to restore over a target that another connection actively holds an open transaction against, naming the file', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))

    // A real second connection to the target, with a real, held SQLite lock.
    const busyConnection = new Database(DB_FILE)
    busyConnection.exec('BEGIN IMMEDIATE')
    busyConnection.prepare('INSERT INTO items ("value") VALUES (?)').run('uncommitted')

    let before: Buffer
    try {
      before = readFileSync(DB_FILE)

      expect(() => restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z'))).toThrow(
        DB_FILE,
      )
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

  it('does not refuse a restore merely because another connection to the target is open but idle', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, 'wimm.db', new Date('2026-01-01T00:00:00.000Z'))
    insertRow(DB_FILE, 'beta')

    // Documented limitation: a connection that is open but has no pending
    // transaction or in-flight statement holds no SQLite lock in DELETE
    // journal mode, so the exclusive-access check cannot see it.
    const idleConnection = new Database(DB_FILE)
    try {
      expect(() =>
        restoreSnapshot(snapshotPath, DB_FILE, 'wimm.db', new Date('2026-01-01T00:00:10.000Z')),
      ).not.toThrow()
    } finally {
      idleConnection.close()
    }

    expect(readRows(DB_FILE)).toEqual(['alpha'])
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
