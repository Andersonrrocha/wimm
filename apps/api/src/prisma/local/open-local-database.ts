/**
 * Open a local SQLite database with the pragmas this application depends on.
 *
 * Both are `better-sqlite3` defaults today, which means the app currently works
 * by accident rather than by decision:
 *
 * - `foreign_keys` — SQLite's own default is OFF. Every `onDelete: Cascade`,
 *   `Restrict` and `SetNull` in the schema is inert without it, and the failure
 *   is silent: orphaned rows rather than an error.
 * - `journal_mode = DELETE` — Phase 2 takes backups by copying the database
 *   file. That is only a valid snapshot in `delete` mode; in WAL mode a copy
 *   taken without a checkpoint can be missing committed data, so the backup
 *   would look fine and restore short.
 *
 * Setting both explicitly means a driver upgrade cannot quietly change them —
 * and if one does anyway, this function refuses to hand back a handle that
 * silently lost either guarantee, instead of failing later and invisibly.
 *
 * `journal_mode` is only changed on a writable connection. SQLite refuses to
 * change the journal mode of a read-only connection whenever the requested
 * mode differs from the current one (`db.pragma('journal_mode = ...')` throws
 * "attempt to write a readonly database"), so forcing it unconditionally
 * would make it impossible to even *open* a database read-only if it were
 * ever found in a different mode (e.g. WAL, from before this fix, or left
 * over from a crash). `foreign_keys` has no such restriction: it is
 * per-connection state, not part of the file on disk, so it is always set
 * and always verified, on both read-only and writable connections.
 */
// `@types/better-sqlite3` uses `export =`, and this package compiles with
// `allowSyntheticDefaultImports` (typecheck-only) rather than `esModuleInterop`
// (which also emits the interop helper). A default import therefore typechecks
// but emits `.default`, which is undefined at runtime for a CommonJS module.
// Import-equals is the form that matches `export =` under both settings.
import Database = require('better-sqlite3')

export function openLocalDatabase(
  file: string,
  options: { readonly?: boolean } = {},
): Database.Database {
  const readonly = options.readonly ?? false
  const db = new Database(file, { readonly })

  if (!readonly) {
    db.pragma('journal_mode = DELETE')

    const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
    if (mode !== 'delete') {
      db.close()
      throw new Error(`Refusing to use ${file}: journal mode could not be set to DELETE (got "${mode}")`)
    }
  }

  db.pragma('foreign_keys = ON')

  const fk = (db.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys
  if (fk !== 1) {
    db.close()
    throw new Error(`Refusing to use ${file}: foreign key enforcement could not be enabled`)
  }

  return db
}
