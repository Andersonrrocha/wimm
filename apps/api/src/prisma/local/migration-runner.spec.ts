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

function countRows(file: string, table: string): number {
  const db = openLocalDatabase(file, { readonly: true })
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }
  db.close()
  return row.n
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
    // The message must say earlier migrations from this same batch were also rolled back --
    // with the batch decided as one shared transaction, that semantics is only ever visible here.
    expect(thrown!.message).toMatch(/earlier/i)

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

  // Regression test for the data-loss defect this module exists to prevent: applying every
  // pending migration inside one shared transaction means `PRAGMA foreign_keys=OFF` -- which
  // `prisma migrate diff --script` emits around any table rebuild it cannot express as
  // `ADD COLUMN` -- is a documented no-op inside a transaction. With enforcement left on, the
  // `DROP TABLE` in that rebuild fires every `ON DELETE CASCADE` against the table being rebuilt,
  // silently destroying unrelated rows with no exception and a clean `integrity_check`.
  it('preserves child rows across a Prisma-shaped table rebuild of the referenced parent table', () => {
    const migrationsDir = join(ROOT, 'migrations-rebuild')
    writeMigration(
      migrationsDir,
      '0000_initial',
      `
        CREATE TABLE "parent" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL);
        CREATE TABLE "child" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "parentId" TEXT NOT NULL,
          CONSTRAINT "fk_child_parent" FOREIGN KEY ("parentId") REFERENCES "parent" ("id") ON DELETE CASCADE
        );
      `,
    )

    const first = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(first.applied).toEqual(['0000_initial'])

    // Real user data, seeded between migrations -- standing in for years of transactions and
    // categorization rules that must survive a later schema change untouched.
    const seed = openLocalDatabase(DB_FILE)
    seed.exec(`
      INSERT INTO "parent" VALUES ('p1', 'Groceries');
      INSERT INTO "child" VALUES ('c1', 'p1'), ('c2', 'p1'), ('c3', 'p1');
    `)
    seed.close()

    // The exact shape `prisma migrate diff --script` emits for a change it cannot express as
    // `ADD COLUMN` (here: adding a column requires a rebuild only because this test wants a
    // realistic `new_X` / `INSERT ... SELECT` / `DROP TABLE` / `RENAME` sequence). The
    // `PRAGMA foreign_keys=OFF/ON` lines Prisma also emits around this are deliberately omitted:
    // this runner rejects any migration containing them (see `assertNoForeignKeysPragma`), since
    // they would silently no-op inside the batch transaction anyway.
    writeMigration(
      migrationsDir,
      '0001_rebuild_parent',
      `
        CREATE TABLE "new_parent" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "note" TEXT);
        INSERT INTO "new_parent" ("id", "name") SELECT "id", "name" FROM "parent";
        DROP TABLE "parent";
        ALTER TABLE "new_parent" RENAME TO "parent";
      `,
    )

    const second = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T01:00:00.000Z'),
    })
    expect(second.applied).toEqual(['0001_rebuild_parent'])

    const db = openLocalDatabase(DB_FILE, { readonly: true })
    const childRows = db.prepare('SELECT "id", "parentId" FROM "child" ORDER BY "id"').all()
    const parentRows = db.prepare('SELECT "id", "name" FROM "parent"').all()
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    db.close()

    // The regression: without disabling foreign keys before the batch transaction begins,
    // `DROP TABLE "parent"` above fires the CASCADE and wipes every child row.
    expect(childRows).toEqual([
      { id: 'c1', parentId: 'p1' },
      { id: 'c2', parentId: 'p1' },
      { id: 'c3', parentId: 'p1' },
    ])
    expect(parentRows).toEqual([{ id: 'p1', name: 'Groceries' }])
    expect(integrity).toEqual([{ integrity_check: 'ok' }])
  })

  it('rejects a pending migration containing a PRAGMA foreign_keys statement, before taking a snapshot or applying anything', () => {
    const migrationsDir = join(ROOT, 'migrations-pragma-fk')
    writeMigration(
      migrationsDir,
      '0000_bad_pragma',
      `
        PRAGMA foreign_keys=OFF;
        CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);
        PRAGMA foreign_keys=ON;
      `,
    )

    expect(() =>
      applyPendingMigrations({
        file: DB_FILE,
        migrationsDir,
        backupDir: BACKUP_DIR,
        databaseId: DATABASE_ID,
        now: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrow(/0000_bad_pragma/)

    expect(listSnapshots(BACKUP_DIR, DATABASE_ID)).toEqual([])
    expect(tableNames(DB_FILE)).not.toContain('widgets')
    expect(appliedMigrationRows(DB_FILE)).toEqual([])
  })

  it('does not blame an unrelated migration for a pre-existing orphan, but warns about it', () => {
    const migrationsDir = join(ROOT, 'migrations-preexisting-orphan')
    writeMigration(
      migrationsDir,
      '0000_setup',
      `
        CREATE TABLE "parent" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "child" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "parentId" TEXT NOT NULL,
          CONSTRAINT "fk_child_parent" FOREIGN KEY ("parentId") REFERENCES "parent" ("id")
        );
      `,
    )

    const first = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(first.applied).toEqual(['0000_setup'])

    // An orphan row, created outside any migration -- standing in for legacy data, a
    // restored import, or a partially recovered database. `foreignKeys: 'off'` here
    // stands in for however such a row really got there; the point of this test is
    // that it exists *before* the next call to `applyPendingMigrations` runs at all.
    const seed = openLocalDatabase(DB_FILE, { foreignKeys: 'off' })
    seed.exec(`INSERT INTO "child" VALUES ('orphan', 'does-not-exist');`)
    seed.close()

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Touches neither "parent" nor "child" -- entirely unrelated to the orphan.
    writeMigration(migrationsDir, '0001_unrelated', `CREATE TABLE "Settings" ("id" TEXT NOT NULL PRIMARY KEY);`)

    const second = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T01:00:00.000Z'),
    })

    // The migration succeeded -- a pre-existing, unrelated violation must never fail
    // (or roll back) a batch that did not introduce it.
    expect(second.applied).toEqual(['0001_unrelated'])
    expect(tableNames(DB_FILE)).toContain('Settings')
    expect(appliedMigrationRows(DB_FILE).map((r) => r.migration_name)).toContain('0001_unrelated')

    // It was surfaced, though: a console.warn naming the affected table, not an
    // error blaming "0001_unrelated" for violations it never touched.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warning = warnSpy.mock.calls[0]?.[0] as string
    expect(warning).toMatch(/child/)
    expect(warning).not.toMatch(/0001_unrelated left referential integrity violations behind/)

    // The orphan itself is untouched, not silently cleaned up.
    const db = openLocalDatabase(DB_FILE, { readonly: true })
    const orphanRows = db.prepare('SELECT "id", "parentId" FROM "child" WHERE "id" = \'orphan\'').all()
    db.close()
    expect(orphanRows).toEqual([{ id: 'orphan', parentId: 'does-not-exist' }])

    warnSpy.mockRestore()
  })

  it('rejects a migration containing an explicit COMMIT, naming it, because it ends the batch transaction', () => {
    const migrationsDir = join(ROOT, 'migrations-commit-escape')
    writeMigration(migrationsDir, '0000_good', 'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);')
    // A hand-authored migration is the only realistic way this happens -- `prisma
    // migrate diff --script` never emits a bare COMMIT -- but the runner must still
    // catch it: once this runs, better-sqlite3 raises nothing, `db.inTransaction`
    // goes false, and the batch transaction this runner depends on for atomic
    // rollback no longer exists.
    writeMigration(migrationsDir, '0001_commits', 'CREATE TABLE "gadgets" ("id" TEXT NOT NULL PRIMARY KEY);\nCOMMIT;')
    writeMigration(migrationsDir, '0002_after', 'CREATE TABLE "widgets_after" ("id" TEXT NOT NULL PRIMARY KEY);')

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
    expect(thrown!.message).toMatch(/0001_commits/)
    expect(thrown!.message).toMatch(/COMMIT/)

    // The migration after the COMMIT never ran.
    expect(tableNames(DB_FILE)).not.toContain('widgets_after')
    expect(appliedMigrationRows(DB_FILE).some((r) => r.migration_name === '0001_commits')).toBe(false)

    // This is the exact danger the fix documents, not a gap in it: the explicit
    // COMMIT inside "0001_commits" really did commit everything applied so far in
    // this batch -- "0000_good"'s table and bookkeeping row, and "0001_commits"'s
    // own CREATE TABLE, which ran before the COMMIT statement in its SQL -- before
    // this runner could detect it and refuse to continue. There is no way to
    // undo a transaction that has already committed; the runner's job is to name
    // the migration responsible, which it does above.
    expect(tableNames(DB_FILE)).toContain('widgets')
    expect(tableNames(DB_FILE)).toContain('gadgets')
    expect(appliedMigrationRows(DB_FILE).some((r) => r.migration_name === '0000_good')).toBe(true)
  })

  it('rejects a migration that leaves referential violations behind, rolling the whole batch back before it commits', () => {
    const migrationsDir = join(ROOT, 'migrations-dangling')
    // Applied first, in its own call, so there is real pre-existing state (a committed migration
    // row and real parent/child data) that the later failing call must leave completely untouched.
    writeMigration(
      migrationsDir,
      '0000_setup',
      `
        CREATE TABLE "parent" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "child" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "parentId" TEXT NOT NULL,
          CONSTRAINT "fk_child_parent" FOREIGN KEY ("parentId") REFERENCES "parent" ("id")
        );
        INSERT INTO "parent" VALUES ('p1');
        INSERT INTO "child" VALUES ('c1', 'p1');
      `,
    )

    const first = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(first.applied).toEqual(['0000_setup'])

    const rowCountsBefore = { parent: countRows(DB_FILE, 'parent'), child: countRows(DB_FILE, 'child') }
    const appliedRowsBefore = appliedMigrationRows(DB_FILE)

    // A second migration that introduces a dangling reference. Foreign key enforcement is off for
    // the whole batch (see the module doc comment), so nothing stops this INSERT from running --
    // the `PRAGMA foreign_key_check` safety net must catch it before the batch commits.
    writeMigration(migrationsDir, '0001_dangling', `INSERT INTO "child" VALUES ('c2', 'does-not-exist');`)

    let thrown: Error | undefined
    try {
      applyPendingMigrations({
        file: DB_FILE,
        migrationsDir,
        backupDir: BACKUP_DIR,
        databaseId: DATABASE_ID,
        now: new Date('2026-01-01T01:00:00.000Z'),
      })
    } catch (err) {
      thrown = err as Error
    }

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/0001_dangling/)
    expect(thrown!.message).toMatch(/child/)
    expect(thrown!.message).toMatch(/\.snapshot\.db/)

    // The migration was rejected, not merely reported: nothing it did landed. Row counts in the
    // affected tables are exactly what they were before this call, and `_prisma_migrations` has no
    // row for the failed migration.
    const rowCountsAfter = { parent: countRows(DB_FILE, 'parent'), child: countRows(DB_FILE, 'child') }
    expect(rowCountsAfter).toEqual(rowCountsBefore)
    expect(appliedMigrationRows(DB_FILE)).toEqual(appliedRowsBefore)
    expect(appliedMigrationRows(DB_FILE).some((r) => r.migration_name === '0001_dangling')).toBe(false)
  })

  // Item 2: an older build must refuse to run against a database a newer
  // build already migrated -- not report a clean boot with no signal at all.
  it('refuses to run against a database already migrated by a newer build, naming the migration(s) it does not know and pointing at restoring a pre-upgrade snapshot', () => {
    const newerMigrationsDir = join(ROOT, 'migrations-newer-build')
    writeMigration(newerMigrationsDir, '0000_first', 'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);')
    writeMigration(newerMigrationsDir, '0001_second', 'CREATE TABLE "gadgets" ("id" TEXT NOT NULL PRIMARY KEY);')

    // The "newer build" migrates the database all the way.
    const first = applyPendingMigrations({
      file: DB_FILE,
      migrationsDir: newerMigrationsDir,
      backupDir: BACKUP_DIR,
      databaseId: DATABASE_ID,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(first.applied).toEqual(['0000_first', '0001_second'])
    const snapshotsAfterFirstRun = listSnapshots(BACKUP_DIR, DATABASE_ID)

    // The "older build" only ever shipped the first migration -- it has never heard of "0001_second".
    const olderMigrationsDir = join(ROOT, 'migrations-older-build-view')
    writeMigration(olderMigrationsDir, '0000_first', 'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);')

    let thrown: Error | undefined
    try {
      applyPendingMigrations({
        file: DB_FILE,
        migrationsDir: olderMigrationsDir,
        backupDir: BACKUP_DIR,
        databaseId: DATABASE_ID,
        now: new Date('2026-01-01T01:00:00.000Z'),
      })
    } catch (err) {
      thrown = err as Error
    }

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/0001_second/)
    expect(thrown!.message).toMatch(/newer/i)
    expect(thrown!.message).toMatch(/restor/i)
    expect(thrown!.message).toMatch(/snapshot/i)

    // Detecting this must not itself take a snapshot or touch the database: nothing was going to run.
    expect(listSnapshots(BACKUP_DIR, DATABASE_ID)).toEqual(snapshotsAfterFirstRun)
    expect(tableNames(DB_FILE)).toEqual(expect.arrayContaining(['widgets', 'gadgets']))
  })

  // Item 4: a boot-time migration that fails the same way on every relaunch
  // must not evict real snapshot history just because it keeps re-snapshotting
  // the same, unchanged (fully rolled-back) database.
  it('does not burn through the snapshot retention window across repeated relaunches of a build whose migration keeps failing', () => {
    const migrationsDir = join(ROOT, 'migrations-crash-loop')
    writeMigration(migrationsDir, '0000_good', 'CREATE TABLE "widgets" ("id" TEXT NOT NULL PRIMARY KEY);')
    writeMigration(migrationsDir, '0001_bad', 'THIS IS NOT VALID SQL AT ALL;')

    const base = new Date('2026-01-01T00:00:00.000Z').getTime()

    // More relaunches than MAX_SNAPSHOTS_PER_DATABASE (5). Every attempt
    // fails and rolls back completely, so the database going into each
    // attempt is byte-for-byte the same as it was for the previous one.
    for (let i = 0; i < 6; i++) {
      expect(() =>
        applyPendingMigrations({
          file: DB_FILE,
          migrationsDir,
          backupDir: BACKUP_DIR,
          databaseId: DATABASE_ID,
          now: new Date(base + i * 1000),
        }),
      ).toThrow(/0001_bad/)
    }

    // Without the fix, 6 crash-loop relaunches would take 6 distinct
    // (byte-identical) snapshots, pruning away everything older. With it,
    // every attempt after the first reuses the existing snapshot instead of
    // consuming a retention slot.
    expect(listSnapshots(BACKUP_DIR, DATABASE_ID)).toHaveLength(1)
  })
})
