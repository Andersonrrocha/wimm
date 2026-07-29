import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { openLocalDatabase } from './open-local-database'
import { listSnapshots } from './snapshot'
import { applyPendingMigrations } from './migration-runner'

const ROOT = '/tmp/wimm-migration-runner-spec'
const DB_FILE = join(ROOT, 'wimm.db')
const BACKUP_DIR = join(ROOT, 'backups')
const DATABASE_ID = 'wimm.db'

/** The real, committed migrations Phase 1 shipped. Exercised deliberately, not replaced by a fixture. */
const REAL_MIGRATIONS_DIR = join(__dirname, '../../../prisma/migrations-sqlite')

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Writes a migration directory with a single `migration.sql` file, the shape the runner discovers. */
function writeMigration(migrationsDir: string, name: string, sql: string): void {
  const dir = join(migrationsDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'migration.sql'), sql)
}

function tableNames(file: string): string[] {
  const db = openLocalDatabase(file, { readonly: true })
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  db.close()
  return rows.map((r) => r.name)
}

function appliedMigrationRows(file: string): Array<{ migration_name: string; checksum: string }> {
  const db = openLocalDatabase(file, { readonly: true })
  const rows = db
    .prepare('SELECT migration_name, checksum FROM "_prisma_migrations" ORDER BY migration_name')
    .all() as Array<{ migration_name: string; checksum: string }>
  db.close()
  return rows
}

describe('applyPendingMigrations', () => {
  beforeEach(() => {
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('applies the real committed baseline to a fresh database and records it with the correct checksum', () => {
    const result = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(result.applied).toEqual(['0000_baseline'])
    expect(result.alreadyApplied).toEqual([])
    expect(result.snapshot).not.toBeNull()

    // The baseline actually ran: its tables exist.
    expect(tableNames(DB_FILE)).toEqual(expect.arrayContaining(['User', 'Transaction', '_prisma_migrations']))

    // The checksum recorded is of the real, on-disk migration file -- not a placeholder.
    const realSql = readFileSync(join(REAL_MIGRATIONS_DIR, '0000_baseline', 'migration.sql'), 'utf8')
    const rows = appliedMigrationRows(DB_FILE)
    expect(rows).toEqual([{ migration_name: '0000_baseline', checksum: sha256(realSql) }])
  })

  it('creates a _prisma_migrations table matching the columns Prisma itself creates', () => {
    applyPendingMigrations({
      file: DB_FILE,
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    const db = openLocalDatabase(DB_FILE, { readonly: true })
    const columns = (db.prepare('PRAGMA table_info("_prisma_migrations")').all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    db.close()

    expect(columns).toEqual([
      'id',
      'checksum',
      'finished_at',
      'migration_name',
      'logs',
      'rolled_back_at',
      'started_at',
      'applied_steps_count',
    ])
  })

  it('is a no-op on a second run: nothing applied, nothing new snapshotted', () => {
    const first = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(first.snapshot).not.toBeNull()
    const snapshotsAfterFirstRun = listSnapshots(BACKUP_DIR, DATABASE_ID)
    expect(snapshotsAfterFirstRun).toHaveLength(1)

    const second = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T01:00:00.000Z'),
    })

    expect(second.applied).toEqual([])
    expect(second.alreadyApplied).toEqual(['0000_baseline'])
    expect(second.snapshot).toBeNull()

    // No new snapshot was taken: still exactly the one from the first run.
    expect(listSnapshots(BACKUP_DIR, DATABASE_ID)).toEqual(snapshotsAfterFirstRun)
  })

  it('applies migrations in lexicographic directory order, not creation or declaration order', () => {
    const migrationsDir = join(ROOT, 'migrations-order')
    // Written deliberately out of order, so passing this test cannot be an accident of readdir order.
    writeMigration(
      migrationsDir,
      '0002_third',
      `CREATE TABLE IF NOT EXISTS "order_log" ("value" TEXT NOT NULL);\nINSERT INTO "order_log" VALUES ('0002_third');`,
    )
    writeMigration(
      migrationsDir,
      '0000_first',
      `CREATE TABLE IF NOT EXISTS "order_log" ("value" TEXT NOT NULL);\nINSERT INTO "order_log" VALUES ('0000_first');`,
    )
    writeMigration(
      migrationsDir,
      '0001_second',
      `CREATE TABLE IF NOT EXISTS "order_log" ("value" TEXT NOT NULL);\nINSERT INTO "order_log" VALUES ('0001_second');`,
    )

    const result = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(result.applied).toEqual(['0000_first', '0001_second', '0002_third'])

    const db = openLocalDatabase(DB_FILE, { readonly: true })
    const rows = db.prepare('SELECT "value" FROM "order_log" ORDER BY rowid').all() as Array<{ value: string }>
    db.close()
    expect(rows.map((r) => r.value)).toEqual(['0000_first', '0001_second', '0002_third'])
  })

  it('rejects an already-applied migration whose file was edited after shipping, as a hard failure', () => {
    const migrationsDir = join(ROOT, 'migrations-drift')
    writeMigration(migrationsDir, '0000_initial', 'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);')

    const first = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(first.applied).toEqual(['0000_initial'])
    const snapshotsAfterFirstRun = listSnapshots(BACKUP_DIR, DATABASE_ID)

    // The migration file is edited after having already shipped and been applied.
    writeFileSync(
      join(migrationsDir, '0000_initial', 'migration.sql'),
      'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY, "extra" TEXT);',
    )

    expect(() =>
      applyPendingMigrations({
        file: DB_FILE,
        migrationsDir,
        backupDir: BACKUP_DIR,
        databaseId: DATABASE_ID,
        now: new Date('2026-01-01T01:00:00.000Z'),
      }),
    ).toThrow(/0000_initial/)

    // Detecting the drift must not itself take a snapshot: nothing was going to be applied.
    expect(listSnapshots(BACKUP_DIR, DATABASE_ID)).toEqual(snapshotsAfterFirstRun)
  })

  it('leaves the database untouched and names the migration and snapshot when a migration fails', () => {
    const migrationsDir = join(ROOT, 'migrations-failing')
    writeMigration(migrationsDir, '0000_good', 'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);')
    writeMigration(migrationsDir, '0001_bad', 'THIS IS NOT VALID SQL AT ALL;')

    // A known row, pre-existing before this migration run, standing in for a user's real data.
    mkdirSync(ROOT, { recursive: true })
    const seed = openLocalDatabase(DB_FILE)
    seed.exec('CREATE TABLE "existing_data" ("value" TEXT NOT NULL); INSERT INTO "existing_data" VALUES (\'known-row\');')
    seed.close()

    let thrown: Error | undefined
    try {
      applyPendingMigrations({
        file: DB_FILE,
        migrationsDir,
        backupDir: BACKUP_DIR,
        databaseId: DATABASE_ID,
        now: new Date('2026-01-01T00:00:00.000Z'),
      })
    } catch (err) {
      thrown = err as Error
    }

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/0001_bad/)
    expect(thrown!.message).toMatch(/\.snapshot\.db/)

    // The pre-existing row is untouched.
    const db = openLocalDatabase(DB_FILE, { readonly: true })
    const rows = db.prepare('SELECT "value" FROM "existing_data"').all() as Array<{ value: string }>
    db.close()
    expect(rows).toEqual([{ value: 'known-row' }])

    // Neither migration's effect persists: the whole failed run rolls back as one unit, so a user
    // who upgrades across several migrations in one boot never ends up part-old, part-new.
    expect(tableNames(DB_FILE)).not.toContain('widgets')
    expect(appliedMigrationRows(DB_FILE)).toEqual([])

    // The snapshot named in the error actually exists and opens.
    const [snapshotPathMatch] = thrown!.message.match(/\S+\.snapshot\.db/) ?? []
    expect(snapshotPathMatch).toBeDefined()
    expect(existsSync(snapshotPathMatch!)).toBe(true)
    const snapshotDb = openLocalDatabase(snapshotPathMatch!, { readonly: true })
    const snapshotRows = snapshotDb.prepare('SELECT "value" FROM "existing_data"').all() as Array<{ value: string }>
    snapshotDb.close()
    expect(snapshotRows).toEqual([{ value: 'known-row' }])
  })
})
