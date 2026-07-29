import { rmSync } from 'fs'
// Same import form as open-local-database.ts itself: `@types/better-sqlite3`
// uses `export =`, so import-equals is required for the runtime value (not
// just the type) to resolve correctly.
import Database = require('better-sqlite3')
import { openLocalDatabase } from './open-local-database'

const FILE = '/tmp/wimm-open-spec.db'

/**
 * `better-sqlite3` in this repo already defaults both `journal_mode` and
 * `foreign_keys` to the values this module sets. That means a test which
 * only asserts the *final* pragma value proves nothing: it would pass
 * identically whether `openLocalDatabase` set anything at all. Every test
 * below is written to start from a state that disagrees with the default,
 * or to simulate a driver that silently fails to apply the requested
 * pragma, so that removing the set-and-verify logic actually breaks them.
 */
describe('openLocalDatabase', () => {
  afterEach(() => {
    for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) rmSync(f, { force: true })
  })

  describe('journal_mode', () => {
    it('corrects a database file that was left in WAL mode', () => {
      // journal_mode is persisted in the database file itself (unlike
      // foreign_keys, which is per-connection), so a raw handle can put the
      // file into a state that disagrees with the default and have that
      // state survive being reopened.
      const raw = new Database(FILE)
      raw.pragma('journal_mode = WAL')
      expect((raw.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode).toBe('wal')
      raw.close()

      const db = openLocalDatabase(FILE)
      const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
      expect(mode).toBe('delete')
      db.close()
    })

    it('refuses to hand back a handle when journal mode cannot be corrected to DELETE', () => {
      // Put the file into WAL first (a real, persisted state), then simulate
      // a driver where the corrective `journal_mode = DELETE` pragma
      // silently fails to take: intercept only that exact set call, leaving
      // every other pragma call (including the verification read) to hit
      // the real database.
      const raw = new Database(FILE)
      raw.pragma('journal_mode = WAL')
      raw.close()

      const original = Database.prototype.pragma
      const spy = jest
        .spyOn(Database.prototype, 'pragma')
        .mockImplementation(function (this: Database.Database, source: string, opts?: unknown) {
          if (source === 'journal_mode = DELETE') return undefined
          return (original as (this: Database.Database, source: string, opts?: unknown) => unknown).call(
            this,
            source,
            opts,
          )
        })

      try {
        expect(() => openLocalDatabase(FILE)).toThrow(/journal mode could not be set to DELETE.*"wal"/i)
      } finally {
        spy.mockRestore()
      }

      // The refusal must not leave a dangling open handle: a fresh open
      // should still see the file in WAL mode (nothing committed the fix),
      // and it must be possible to open and close it without error.
      const check = new Database(FILE, { readonly: true })
      expect((check.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode).toBe('wal')
      check.close()
    })

    it('does not touch journal_mode on a read-only connection', () => {
      // Establish the file first (journal_mode is file-persisted, and a
      // brand-new file cannot be opened read-only).
      openLocalDatabase(FILE).close()

      const raw = new Database(FILE)
      raw.pragma('journal_mode = WAL')
      raw.close()

      // A read-only open must succeed even though the file is in WAL mode
      // (SQLite refuses to change journal mode on a read-only connection),
      // and must leave the mode exactly as found.
      const db = openLocalDatabase(FILE, { readonly: true })
      const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
      expect(mode).toBe('wal')
      db.close()
    })
  })

  describe('foreign_keys', () => {
    it('sets foreign_keys = ON explicitly rather than relying on the driver default', () => {
      const spy = jest.spyOn(Database.prototype, 'pragma')
      try {
        const db = openLocalDatabase(FILE)
        expect(spy).toHaveBeenCalledWith('foreign_keys = ON')
        db.close()
      } finally {
        spy.mockRestore()
      }
    })

    it('refuses to hand back a handle when foreign key enforcement cannot be verified as ON', () => {
      // foreign_keys is per-connection state, not part of the file on disk,
      // so there is no way to leave a *file* in a state that disagrees with
      // the driver's default the way WAL mode can above. Instead this
      // simulates exactly the risk the module doc comment names -- "a
      // driver upgrade cannot quietly change them" -- by making the
      // verification read report a value that disagrees with what was just
      // requested, regardless of what actually happened underneath.
      const original = Database.prototype.pragma
      const spy = jest
        .spyOn(Database.prototype, 'pragma')
        .mockImplementation(function (this: Database.Database, source: string, opts?: unknown) {
          if (source === 'foreign_keys') return [{ foreign_keys: 0 }]
          return (original as (this: Database.Database, source: string, opts?: unknown) => unknown).call(
            this,
            source,
            opts,
          )
        })

      try {
        expect(() => openLocalDatabase(FILE)).toThrow(/foreign key enforcement could not be enabled/i)
      } finally {
        spy.mockRestore()
      }
    })

    it('refuses to hand back a read-only handle when foreign key enforcement cannot be verified as ON', () => {
      // The module doc comment states foreign_keys is "always set and
      // always verified, on both read-only and writable connections" --
      // this is the read-only side of the refusal test above.
      openLocalDatabase(FILE).close()

      const original = Database.prototype.pragma
      const spy = jest
        .spyOn(Database.prototype, 'pragma')
        .mockImplementation(function (this: Database.Database, source: string, opts?: unknown) {
          if (source === 'foreign_keys') return [{ foreign_keys: 0 }]
          return (original as (this: Database.Database, source: string, opts?: unknown) => unknown).call(
            this,
            source,
            opts,
          )
        })

      try {
        expect(() => openLocalDatabase(FILE, { readonly: true })).toThrow(/foreign key enforcement could not be enabled/i)
      } finally {
        spy.mockRestore()
      }
    })

    it('actually enforces a foreign key end to end', () => {
      const db = openLocalDatabase(FILE)
      db.exec(`
        CREATE TABLE parent ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE child ("id" TEXT NOT NULL PRIMARY KEY, "parentId" TEXT NOT NULL,
          CONSTRAINT fk FOREIGN KEY ("parentId") REFERENCES parent("id") ON DELETE CASCADE);
      `)
      expect(() => db.prepare('INSERT INTO child VALUES (?, ?)').run('c1', 'does-not-exist')).toThrow(/FOREIGN KEY/i)
      db.close()
    })

    it('can be opened with enforcement explicitly disabled via foreignKeys: "off"', () => {
      const db = openLocalDatabase(FILE, { foreignKeys: 'off' })
      const fk = (db.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys
      expect(fk).toBe(0)

      // With enforcement off, the same insert that throws above must succeed.
      db.exec(`
        CREATE TABLE parent ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE child ("id" TEXT NOT NULL PRIMARY KEY, "parentId" TEXT NOT NULL,
          CONSTRAINT fk FOREIGN KEY ("parentId") REFERENCES parent("id") ON DELETE CASCADE);
      `)
      expect(() => db.prepare('INSERT INTO child VALUES (?, ?)').run('c1', 'does-not-exist')).not.toThrow()
      db.close()
    })

    it('refuses to hand back a handle when foreign key enforcement cannot be verified as OFF', () => {
      const original = Database.prototype.pragma
      const spy = jest
        .spyOn(Database.prototype, 'pragma')
        .mockImplementation(function (this: Database.Database, source: string, opts?: unknown) {
          if (source === 'foreign_keys') return [{ foreign_keys: 1 }]
          return (original as (this: Database.Database, source: string, opts?: unknown) => unknown).call(
            this,
            source,
            opts,
          )
        })

      try {
        expect(() => openLocalDatabase(FILE, { foreignKeys: 'off' })).toThrow(
          /foreign key enforcement could not be disabled/i,
        )
      } finally {
        spy.mockRestore()
      }
    })
  })
})
