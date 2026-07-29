import { rmSync } from 'fs'
import { openLocalDatabase } from './open-local-database'

const FILE = '/tmp/wimm-open-spec.db'

describe('openLocalDatabase', () => {
  afterEach(() => {
    for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) rmSync(f, { force: true })
  })

  it('enables foreign key enforcement', () => {
    const db = openLocalDatabase(FILE)
    expect((db.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys).toBe(1)
    db.close()
  })

  it('uses the delete journal, so a file copy is a valid snapshot', () => {
    const db = openLocalDatabase(FILE)
    const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
    expect(mode).toBe('delete')
    db.close()
  })

  it('actually enforces a foreign key', () => {
    const db = openLocalDatabase(FILE)
    db.exec(`
      CREATE TABLE parent ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE child ("id" TEXT NOT NULL PRIMARY KEY, "parentId" TEXT NOT NULL,
        CONSTRAINT fk FOREIGN KEY ("parentId") REFERENCES parent("id") ON DELETE CASCADE);
    `)
    expect(() =>
      db.prepare('INSERT INTO child VALUES (?, ?)').run('c1', 'does-not-exist'),
    ).toThrow(/FOREIGN KEY/i)
    db.close()
  })
})
