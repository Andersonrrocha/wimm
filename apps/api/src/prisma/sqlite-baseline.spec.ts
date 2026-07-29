import { readFileSync } from 'fs'
import { join } from 'path'
import { CHECK_CONSTRAINTS, type CheckConstraint } from './check-constraints'

// `@types/better-sqlite3` uses `export =`, which a plain `import` would need
// either `esModuleInterop` or an import-equals form to consume correctly (see
// `open-local-database.ts`). `require` sidesteps that entirely and keeps this
// an untyped, ordinary CommonJS import.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3')

const BASELINE = join(__dirname, '../../prisma/migrations-sqlite/0000_baseline/migration.sql')

/**
 * Every table schema.sqlite.prisma declares, including the two that carry no
 * CHECK constraint at all (InstallmentPlan, RefreshToken). Listed explicitly,
 * independent of CHECK_CONSTRAINTS, so a constraint leaking into one of them
 * is visible here rather than silently absent from the thing being checked.
 */
const ALL_TABLES = [
  'User',
  'Source',
  'Category',
  'SystemCategorizationRule',
  'CategorizationRule',
  'ImportBatch',
  'InstallmentPlan',
  'Recurrence',
  'Transaction',
  'RefreshToken',
]

/**
 * Every other test of the CHECK constraints (inject-check-constraints.spec.ts,
 * assert-schema-parity.ts) compares text. None of them ever asks SQLite
 * itself what it thinks a table looks like. This test does: it opens a real
 * in-memory database, executes the committed baseline exactly as a desktop
 * install would, and reads the resulting table definitions back out of
 * `sqlite_master` — the artifact's real property, not its textual shape.
 */
describe('SQLite baseline (executed)', () => {
  it('creates every table with exactly the CHECK clauses CHECK_CONSTRAINTS declares for it', () => {
    const db = new Database(':memory:')

    try {
      db.exec(readFileSync(BASELINE, 'utf8'))

      const declaredByTable = new Map<string, CheckConstraint[]>()
      for (const table of ALL_TABLES) declaredByTable.set(table, [])
      for (const c of CHECK_CONSTRAINTS) {
        const list = declaredByTable.get(c.table)
        if (!list) throw new Error(`CHECK_CONSTRAINTS declares a table not in ALL_TABLES: "${c.table}"`)
        list.push(c)
      }

      for (const table of ALL_TABLES) {
        const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
          | { sql: string }
          | undefined

        if (!row) throw new Error(`Baseline did not create table "${table}"`)

        const declared = declaredByTable.get(table) ?? []
        const actualCount = (row.sql.match(/CHECK \(/g) ?? []).length

        expect({ table, checkClauses: actualCount }).toEqual({ table, checkClauses: declared.length })
      }
    } finally {
      db.close()
    }
  })
})
