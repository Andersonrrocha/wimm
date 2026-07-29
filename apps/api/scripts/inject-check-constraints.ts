/**
 * Add the CHECK constraints to generated SQLite DDL.
 *
 * Prisma does not model CHECK, and SQLite has no ALTER TABLE ADD CONSTRAINT —
 * a constraint must exist when the table is created. So the generated DDL is
 * post-processed here.
 *
 * Injection is scoped to each CREATE TABLE block on purpose: `"kind" TEXT NOT
 * NULL` appears in three tables (Transaction, Recurrence, SystemCategorization
 * Rule), and a global replace would put one table's constraint into another —
 * syntactically valid SQL, semantically wrong, silently.
 *
 * This walks the DDL's actual CREATE TABLE blocks — not the declared
 * constraint list — and, for each block, applies only the constraints
 * declared for that table (matched by the captured table name). Scoping this
 * way, rather than looking up a block per declared constraint, means a DDL
 * covering only some of the tables (e.g. a focused test fixture) is handled
 * correctly instead of erroring on the first table it doesn't contain, and a
 * constraint can never be written into a block other than its own.
 */
import { readFileSync, writeFileSync } from 'fs'
import { CHECK_CONSTRAINTS, type CheckConstraint } from '../src/prisma/check-constraints'

/**
 * Matches a single `CREATE TABLE "Name" ( ... );` block in generated SQLite
 * DDL, capturing the table name. Shared by every place that needs to ask
 * "what does this table's block contain" — `injectCheckConstraints` itself,
 * this file's own CLI verification, and the drift guard
 * (assert-schema-parity.ts) — so all three parse blocks exactly the same way
 * instead of maintaining regexes that can quietly drift apart.
 */
const CREATE_TABLE_BLOCK = /CREATE TABLE "(\w+)" \([\s\S]*?\n\);/g

/** Splits SQLite DDL into its CREATE TABLE blocks, keyed by table name. */
export function tableBlocks(ddl: string): Map<string, string> {
  const blocks = new Map<string, string>()
  for (const match of ddl.matchAll(CREATE_TABLE_BLOCK)) {
    blocks.set(match[1], match[0])
  }
  return blocks
}

export function renderCheck(c: CheckConstraint): string {
  const list = c.values.map((v) => `'${v}'`).join(', ')
  const test = `"${c.column}" IN (${list})`
  return c.nullable ? `CHECK ("${c.column}" IS NULL OR ${test})` : `CHECK (${test})`
}

/**
 * Matches a `PRAGMA foreign_keys=ON` or `PRAGMA foreign_keys=OFF` line (any
 * case/spacing), including its trailing newline, so it can be dropped
 * entirely rather than left as a blank line. Deliberately anchored to
 * `foreign_keys` right after `PRAGMA` -- `PRAGMA defer_foreign_keys=...` does
 * not match, because `defer_foreign_keys` is not `foreign_keys` (see
 * `stripForeignKeysPragma`'s doc comment for why that pragma is left alone).
 */
const FOREIGN_KEYS_PRAGMA_LINE = /^[ \t]*PRAGMA\s+foreign_keys\s*=\s*(ON|OFF)\s*;?[ \t]*\r?\n?/gim

/**
 * Strips `PRAGMA foreign_keys=ON/OFF` statements from generated SQLite DDL.
 *
 * `prisma migrate diff --script` wraps every table rebuild it cannot express
 * as `ADD COLUMN` (any change SQLite has no `ALTER TABLE` for -- changing a
 * column's type, default, or nullability) in exactly this shape:
 *
 *   PRAGMA defer_foreign_keys=ON;
 *   PRAGMA foreign_keys=OFF;
 *   CREATE TABLE "new_X" (...); INSERT INTO "new_X" SELECT ...;
 *   DROP TABLE "X"; ALTER TABLE "new_X" RENAME TO "X";
 *   PRAGMA foreign_keys=ON;
 *   PRAGMA defer_foreign_keys=OFF;
 *
 * `applyPendingMigrations` (`../src/prisma/local/migration-runner.ts`) runs
 * every pending migration for a call inside one shared batch transaction,
 * and SQLite documents `PRAGMA foreign_keys` as a no-op inside a transaction
 * -- so that runner rejects outright any migration containing one (see
 * `assertNoForeignKeysPragma` there). Left unstripped, that makes *every*
 * generated table-rebuild migration dead on arrival until someone notices
 * the runtime error and hand-edits the file. Stripping here, as part of the
 * same generation step that already post-processes every migration this repo
 * ships (`inject-check-constraints.ts`, wired into `gen:sqlite-baseline`),
 * means a generated migration is usable the moment it's generated -- no
 * separate script or wiring needed, since this step already runs on every
 * migration that needs it.
 *
 * The runner's rejection stays in place regardless: generation strips what
 * it produces, the runner catches anything hand-authored that still contains
 * one. Belt and braces on purpose -- do not remove either check assuming the
 * other alone suffices.
 *
 * `PRAGMA defer_foreign_keys` is left untouched. It only affects deferred
 * constraint checking within the transaction that sets it and resets itself
 * automatically when that transaction ends, so it is harmless with
 * enforcement already off for the whole batch -- there is nothing for the
 * runner to reject or for this step to strip it for.
 */
export function stripForeignKeysPragma(ddl: string): string {
  return ddl.replace(FOREIGN_KEYS_PRAGMA_LINE, '')
}

export function injectCheckConstraints(ddl: string): string {
  return ddl.replace(CREATE_TABLE_BLOCK, (block: string, table: string) => {
    const constraints = CHECK_CONSTRAINTS.filter((c) => c.table === table)

    return constraints.reduce((acc, c) => {
      const check = renderCheck(c)
      if (acc.includes(check)) return acc // idempotent

      const column = new RegExp(`(\\n    "${c.column}"[^,\\n]*)`)
      if (!column.test(acc)) {
        throw new Error(`Table "${c.table}" has no column "${c.column}" to constrain`)
      }

      return acc.replace(column, `$1 ${check}`)
    }, block)
  })
}

/**
 * Finds every discrepancy between what CHECK_CONSTRAINTS declares per table
 * and what the DDL's CREATE TABLE blocks actually carry.
 *
 * Table-scoped and count-based on purpose — not a global (or even per-table)
 * substring search. Several constraints render byte-identical CHECK text
 * (see module header), so a table's block can contain the "right" text while
 * actually holding a clause that leaked in from — or deduplicated against —
 * a different constraint entirely. Comparing the number of `CHECK (` clauses
 * in a block against the number CHECK_CONSTRAINTS declares for that table
 * catches that; text presence alone does not. A table absent from the DDL
 * counts as carrying zero.
 *
 * Returns human-readable problem descriptions; empty when everything matches.
 */
export function findConstraintProblems(ddl: string): string[] {
  const blocks = tableBlocks(ddl)

  const declaredByTable = new Map<string, CheckConstraint[]>()
  for (const c of CHECK_CONSTRAINTS) {
    const list = declaredByTable.get(c.table) ?? []
    list.push(c)
    declaredByTable.set(c.table, list)
  }

  const problems: string[] = []

  for (const [table, declared] of declaredByTable) {
    const block = blocks.get(table)

    if (block === undefined) {
      for (const c of declared) {
        problems.push(`${c.name} (table "${c.table}", column "${c.column}"): table not found in DDL`)
      }
      continue
    }

    const actualCount = (block.match(/CHECK \(/g) ?? []).length
    if (actualCount !== declared.length) {
      problems.push(`table "${table}": expected ${declared.length} CHECK clause(s), found ${actualCount}`)
      continue
    }

    for (const c of declared) {
      if (!block.includes(renderCheck(c))) {
        problems.push(`${c.name} (table "${c.table}", column "${c.column}"): clause text not found in its table's block`)
      }
    }
  }

  return problems
}

/**
 * `injectCheckConstraints` silently skips any constraint whose table (or
 * column) is not present in the DDL — that tolerance is deliberate, it's what
 * lets a focused test fixture work. But the CLI is the last line of defense
 * before a hand-edited or drifted schema ships without a guarantee it was
 * meant to have, so here we verify every declared constraint actually landed
 * — in its own table's block, not merely somewhere in the file — before
 * trusting, or writing, the result.
 */
function main(): void {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: inject-check-constraints <migration.sql>')
    process.exit(1)
  }

  let injected: string
  try {
    // Strip first: `PRAGMA foreign_keys` lines live outside any `CREATE
    // TABLE` block, so order relative to `injectCheckConstraints` doesn't
    // change the result, but stripping first means the DDL handed to the
    // rest of the pipeline (and to the parity/constraint checks below) is
    // already in the shape the migration runner will accept.
    injected = injectCheckConstraints(stripForeignKeysPragma(readFileSync(file, 'utf8')))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Refusing to write ${file}: a CHECK constraint could not be injected:`)
    console.error(`  - ${message}`)
    console.error(
      "A constraint that cannot be injected means the local SQLite database will not enforce that column's " +
        'allowed values — writing a half-constrained baseline is worse than writing none.',
    )
    process.exit(1)
  }

  const problems = findConstraintProblems(injected)
  if (problems.length > 0) {
    console.error(`Refusing to write ${file}: CHECK constraints do not match what CHECK_CONSTRAINTS declares:`)
    for (const p of problems) {
      console.error(`  - ${p}`)
    }
    console.error(
      "A constraint that isn't exactly where CHECK_CONSTRAINTS says it belongs means the local SQLite " +
        "database will not enforce that column's allowed values — writing a half-constrained baseline is " +
        'worse than writing none.',
    )
    process.exit(1)
  }

  writeFileSync(file, injected, 'utf8')
  console.log(`Injected ${CHECK_CONSTRAINTS.length} CHECK constraints into ${file}`)
}

if (require.main === module) main()
