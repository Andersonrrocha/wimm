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

function renderCheck(c: CheckConstraint): string {
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

function main(): void {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: inject-check-constraints <migration.sql>')
    process.exit(1)
  }
  const injected = injectCheckConstraints(readFileSync(file, 'utf8'))
  writeFileSync(file, injected, 'utf8')
  console.log(`Injected ${CHECK_CONSTRAINTS.length} CHECK constraints into ${file}`)
}

if (require.main === module) main()
