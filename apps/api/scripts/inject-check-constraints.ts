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

export function renderCheck(c: CheckConstraint): string {
  const list = c.values.map((v) => `'${v}'`).join(', ')
  const test = `"${c.column}" IN (${list})`
  return c.nullable ? `CHECK ("${c.column}" IS NULL OR ${test})` : `CHECK (${test})`
}

export function injectCheckConstraints(ddl: string): string {
  return ddl.replace(/CREATE TABLE "(\w+)" \([\s\S]*?\n\);/g, (block: string, table: string) => {
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
 * `injectCheckConstraints` silently skips any constraint whose table (or
 * column) is not present in the DDL — that tolerance is deliberate, it's what
 * lets a focused test fixture work. But the CLI is the last line of defense
 * before a hand-edited or drifted schema ships without a guarantee it was
 * meant to have, so here we verify every declared constraint actually landed
 * before trusting — or writing — the result.
 */
function main(): void {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: inject-check-constraints <migration.sql>')
    process.exit(1)
  }

  let injected: string
  try {
    injected = injectCheckConstraints(readFileSync(file, 'utf8'))
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

  const missing = CHECK_CONSTRAINTS.filter((c) => !injected.includes(renderCheck(c)))
  if (missing.length > 0) {
    console.error(
      `Refusing to write ${file}: ${missing.length} of ${CHECK_CONSTRAINTS.length} CHECK constraints could not be injected:`,
    )
    for (const c of missing) {
      console.error(`  - ${c.name} (table "${c.table}", column "${c.column}")`)
    }
    console.error(
      "A missing constraint means the local SQLite database will not enforce that column's allowed values — " +
        'writing a half-constrained baseline is worse than writing none.',
    )
    process.exit(1)
  }

  writeFileSync(file, injected, 'utf8')
  const verified = CHECK_CONSTRAINTS.length - missing.length
  console.log(`Injected ${verified} CHECK constraints into ${file}`)
}

if (require.main === module) main()
