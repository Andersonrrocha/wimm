import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
// Same import form as open-local-database.ts: this package has
// `allowSyntheticDefaultImports` but not `esModuleInterop`, so a default
// import typechecks but is `undefined` at runtime for this CommonJS module.
import Database = require('better-sqlite3')
import { openLocalDatabase } from './open-local-database'
import { listSnapshots, restoreSnapshot, snapshotDatabase } from './snapshot'

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

    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, new Date('2026-01-01T00:00:00.000Z'))

    expect(readRows(snapshotPath)).toEqual(['alpha'])
  })

  it('encodes the database name and a sortable timestamp in the filename', () => {
    createDatabase(DB_FILE, ['alpha'])

    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, new Date('2026-01-02T03:04:05.006Z'))

    expect(basename(snapshotPath)).toBe('wimm.db.20260102T030405006Z.snapshot.db')
  })

  it('prunes to the newest 5 snapshots, removing the oldest first', () => {
    createDatabase(DB_FILE, ['alpha'])
    const base = new Date('2026-01-01T00:00:00.000Z').getTime()

    const paths = Array.from({ length: 6 }, (_, i) => snapshotDatabase(DB_FILE, BACKUP_DIR, new Date(base + i * 1000)))

    const remaining = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(remaining).toHaveLength(5)
    expect(existsSync(paths[0])).toBe(false)
    for (const survivor of paths.slice(1)) {
      expect(existsSync(survivor)).toBe(true)
    }
  })

  it('prunes only the snapshots of the database being snapshotted, leaving other databases untouched', () => {
    createDatabase(DB_FILE, ['alpha'])
    createDatabase(OTHER_DB_FILE, ['beta'])
    const base = new Date('2026-01-01T00:00:00.000Z').getTime()

    for (let i = 0; i < 6; i++) {
      snapshotDatabase(OTHER_DB_FILE, BACKUP_DIR, new Date(base + i * 1000))
    }
    const dbSnapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, new Date(base + 6000))

    expect(listSnapshots(BACKUP_DIR, 'other.db')).toHaveLength(5)
    const wimmSnapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(wimmSnapshots).toHaveLength(1)
    expect(wimmSnapshots[0].path).toBe(dbSnapshotPath)
  })

  it('lists snapshots newest first', () => {
    createDatabase(DB_FILE, ['alpha'])
    const t1 = new Date('2026-01-01T00:00:00.000Z')
    const t2 = new Date('2026-01-01T00:00:01.000Z')
    const t3 = new Date('2026-01-01T00:00:02.000Z')

    snapshotDatabase(DB_FILE, BACKUP_DIR, t1)
    snapshotDatabase(DB_FILE, BACKUP_DIR, t2)
    snapshotDatabase(DB_FILE, BACKUP_DIR, t3)

    const snapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    expect(snapshots.map((s) => s.takenAt.toISOString())).toEqual([t3.toISOString(), t2.toISOString(), t1.toISOString()])
  })

  it('reports snapshot size in bytes', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, new Date('2026-01-01T00:00:00.000Z'))

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

    expect(() => snapshotDatabase(DB_FILE, BACKUP_DIR, new Date('2026-01-01T00:00:00.000Z'))).toThrow(/WAL/)
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
    const header = readFileSync(DB_FILE).subarray(0, 100)
    writeFileSync(DB_FILE, header)

    expect(() => snapshotDatabase(DB_FILE, BACKUP_DIR, new Date('2026-01-01T00:00:00.000Z'))).toThrow()
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(0)
  })

  it('restores the target and leaves the pre-restore state recoverable as its own snapshot', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, new Date('2026-01-01T00:00:00.000Z'))

    insertRow(DB_FILE, 'beta')
    expect(readRows(DB_FILE)).toEqual(['alpha', 'beta'])

    restoreSnapshot(snapshotPath, DB_FILE, new Date('2026-01-01T00:00:10.000Z'))

    expect(readRows(DB_FILE)).toEqual(['alpha'])

    const snapshots = listSnapshots(BACKUP_DIR, 'wimm.db')
    const preRestoreSnapshot = snapshots.find((s) => s.path !== snapshotPath)
    expect(preRestoreSnapshot).toBeDefined()
    expect(readRows(preRestoreSnapshot!.path)).toEqual(['alpha', 'beta'])
  })

  it('does not attempt to snapshot a target that does not exist yet before restoring into it', () => {
    createDatabase(DB_FILE, ['alpha'])
    const snapshotPath = snapshotDatabase(DB_FILE, BACKUP_DIR, new Date('2026-01-01T00:00:00.000Z'))
    const freshTarget = join(ROOT, 'fresh.db')

    expect(existsSync(freshTarget)).toBe(false)
    restoreSnapshot(snapshotPath, freshTarget, new Date('2026-01-01T00:00:10.000Z'))

    expect(readRows(freshTarget)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'fresh.db')).toHaveLength(0)
  })

  it('throws when restoring from a file that is not a valid SQLite database, leaving the target untouched', () => {
    createDatabase(DB_FILE, ['alpha'])
    const bogusPath = join(ROOT, 'not-a-database.db')
    writeFileSync(bogusPath, 'this is definitely not a sqlite file')

    expect(() => restoreSnapshot(bogusPath, DB_FILE, new Date('2026-01-01T00:00:00.000Z'))).toThrow()
    expect(readRows(DB_FILE)).toEqual(['alpha'])
    expect(listSnapshots(BACKUP_DIR, 'wimm.db')).toHaveLength(0)
  })
})
