/**
 * Guard against drift between the two Prisma schemas and their derived
 * SQLite artifacts.
 *
 * WIMM maintains a PostgreSQL schema (hosted build) and a SQLite schema
 * (desktop build), derived from it. Three independent things rot the same
 * way — someone changes the schema and updates only one side:
 *
 *   1. schema.sqlite.prisma stops matching what deriving it from
 *      schema.prisma would produce.
 *   2. The committed SQLite baseline stops carrying every CHECK constraint
 *      (Prisma does not model CHECK, so these are injected post-generation
 *      and can silently fall out of sync).
 *   3. The committed baseline stops matching what regenerating the DDL and
 *      re-injecting would produce.
 *
 * Each of the three is checked independently and reported independently —
 * this guard does not stop at the first failure, because a run that fixes
 * check 1 but leaves checks 2 and 3 unreported would send someone back
 * through CI one failure at a time.
 *
 * This guard touches no database: check 3 shells out to
 * `prisma migrate diff --from-empty`, which reads the schema file and emits
 * DDL text — it never opens a connection.
 *
 * Run: pnpm --filter @wimm/api run assert:parity
 */
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { deriveSqliteSchema } from './generate-sqlite-schema'
import { injectCheckConstraints, renderCheck } from './inject-check-constraints'
import { CHECK_CONSTRAINTS } from '../src/prisma/check-constraints'

const API_DIR = join(__dirname, '..')
const PRISMA_DIR = join(API_DIR, 'prisma')
const SCHEMA = join(PRISMA_DIR, 'schema.prisma')
const SQLITE_SCHEMA = join(PRISMA_DIR, 'schema.sqlite.prisma')
const BASELINE = join(PRISMA_DIR, 'migrations-sqlite/0000_baseline/migration.sql')

const FIX_SCHEMA = 'pnpm --filter @wimm/api run gen:sqlite-schema'
const FIX_BASELINE = 'pnpm --filter @wimm/api run gen:sqlite-baseline'

type CheckResult = {
  name: string
  ok: boolean
  /** Present only when `ok` is false; always ends with the exact fix command. */
  message?: string
}

/**
 * Splits SQLite DDL into its CREATE TABLE blocks, keyed by table name.
 *
 * Deliberately table-scoped rather than a single string search: several
 * tables share column names (`kind` on Transaction and Recurrence, for
 * instance), so a constraint rendered for one table would satisfy a global
 * `.includes()` even sitting in another table's block entirely. Matches the
 * same block boundary inject-check-constraints.ts uses, so "does the
 * baseline carry this constraint" is asked the same way it was written.
 */
function tableBlocks(ddl: string): Map<string, string> {
  const blocks = new Map<string, string>()
  for (const match of ddl.matchAll(/CREATE TABLE "(\w+)" \([\s\S]*?\n\);/g)) {
    blocks.set(match[1], match[0])
  }
  return blocks
}

/** Check 1: schema.sqlite.prisma matches deriving it from schema.prisma, byte for byte. */
function checkDerivedSchemaCurrent(): CheckResult {
  const name = 'Derived schema is current (schema.sqlite.prisma)'
  const committed = readFileSync(SQLITE_SCHEMA, 'utf8')
  const derived = deriveSqliteSchema(readFileSync(SCHEMA, 'utf8'))

  if (derived === committed) return { name, ok: true }

  return {
    name,
    ok: false,
    message:
      'prisma/schema.sqlite.prisma does not match what deriving it from schema.prisma ' +
      `would produce.\n  Fix: ${FIX_SCHEMA}`,
  }
}

/** Check 2: every declared CHECK_CONSTRAINTS entry appears in its table's block in the committed baseline. */
function checkBaselineCarriesConstraints(): CheckResult {
  const name = 'Baseline carries every CHECK constraint'
  const blocks = tableBlocks(readFileSync(BASELINE, 'utf8'))

  const missing = CHECK_CONSTRAINTS.filter((c) => {
    const block = blocks.get(c.table)
    return block === undefined || !block.includes(renderCheck(c))
  })

  if (missing.length === 0) return { name, ok: true }

  return {
    name,
    ok: false,
    message:
      `${missing.length} of ${CHECK_CONSTRAINTS.length} CHECK constraints are missing from the ` +
      'committed baseline:\n' +
      missing.map((c) => `    - ${c.name} (table "${c.table}", column "${c.column}")`).join('\n') +
      `\n  Fix: ${FIX_BASELINE}`,
  }
}

/** Check 3: regenerating the DDL from schema.sqlite.prisma and injecting matches the committed baseline, byte for byte. */
function checkBaselineCurrent(): CheckResult {
  const name = 'Baseline is current (0000_baseline/migration.sql)'
  const committed = readFileSync(BASELINE, 'utf8')

  // `prisma migrate diff` writes human-readable progress ("Loaded Prisma
  // config from...") to stderr and the DDL itself to stdout. spawnSync pipes
  // the two separately by default — only `.stdout` is used as the DDL; a
  // merged stream would corrupt the comparison with text that was never part
  // of any migration.
  const result = spawnSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'diff', '--from-empty', '--to-schema', SQLITE_SCHEMA, '--script'],
    { cwd: API_DIR, encoding: 'utf8' },
  )

  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : (result.stderr || '').trim()
    return {
      name,
      ok: false,
      message: `\`prisma migrate diff\` failed, so parity could not be verified:\n${detail}\n  Fix: ${FIX_BASELINE}`,
    }
  }

  let injected: string
  try {
    injected = injectCheckConstraints(result.stdout)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      name,
      ok: false,
      message: `Regenerated DDL could not have its CHECK constraints injected:\n  ${detail}\n  Fix: ${FIX_BASELINE}`,
    }
  }

  if (injected === committed) return { name, ok: true }

  return {
    name,
    ok: false,
    message:
      'Regenerating the DDL from schema.sqlite.prisma and injecting CHECK constraints does not ' +
      `match the committed baseline.\n  Fix: ${FIX_BASELINE}`,
  }
}

function main(): number {
  const results = [checkDerivedSchemaCurrent(), checkBaselineCarriesConstraints(), checkBaselineCurrent()]

  for (const r of results) {
    if (r.ok) {
      console.log(`PASS: ${r.name}`)
    } else {
      console.error(`FAIL: ${r.name}`)
      console.error(
        r.message
          ?.split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      )
    }
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${results.length} schema parity checks failed.`)
    return 1
  }

  console.log(`\nAll ${results.length} schema parity checks passed.`)
  return 0
}

if (require.main === module) {
  process.exit(main())
}
