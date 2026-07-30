/**
 * Checked-in diagnostic for Phase 4a Task 2: proves that a **real Prisma
 * query runs against SQLite inside Electron's main process** -- not merely
 * that the app boots (Task 1) or that the ABI-selection mechanism exists
 * (Task 3). Nothing before this script has demonstrated that end to end.
 *
 * **Why checked in, not thrown away.** This is the exact check a
 * contributor on a new platform will need when `better-sqlite3` behaves
 * unexpectedly, and the exact check CI will need once the native-module
 * build matrix arrives. Re-deriving it under pressure -- after a crash, on
 * an unfamiliar machine -- is precisely the failure mode this file exists
 * to remove.
 *
 * **What it checks, in order** (see the plan doc,
 * `docs/superpowers/plans/2026-07-29-phase-4a-electron-runtime-foundation.md`,
 * Task 2, for the full rationale):
 *
 * 1. Reports `process.versions.electron` and `process.versions.modules`
 *    (the Electron-renumbered N-API/ABI number -- see the plan's fact #2;
 *    it never equals stock Node's for the same major).
 * 2. Loads the **root** `better-sqlite3` (13.0.1, true N-API, portable) by
 *    its normal bare specifier and round-trips a value through `:memory:`.
 * 3. Loads the copy `@prisma/adapter-better-sqlite3` pins internally
 *    (12.11.1, pre-N-API, tied to the exact `NODE_MODULE_VERSION` it was
 *    built for) by **absolute path** -- the adapter's own `package.json`
 *    `exports` map blocks a bare `require('better-sqlite3')` from ever
 *    resolving to this copy -- and round-trips a value the same way.
 * 4. Builds a throwaway SQLite database from the real baseline migration
 *    (`apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql`),
 *    then drives it through `LocalPrismaService` (see "LocalPrismaService,
 *    not a hand-rolled adapter" below): `onModuleInit()`, `user.create()`,
 *    `user.count()`, `onModuleDestroy()`.
 *
 * Step 4 is expected to be the one that fails first if anything in the
 * whole chain is wrong -- steps 2 and 3 only prove the two native binaries
 * themselves load; step 4 is the one that proves Prisma's own runtime path
 * (query compilation, the adapter's SQL translation, the generated client)
 * actually works under this Electron build.
 *
 * **LocalPrismaService, not a hand-rolled adapter.** Step 4 imports and
 * drives the real `apps/api/src/prisma/local/local-prisma.service.ts`
 * class directly (by absolute path -- see below) rather than constructing
 * `PrismaBetterSqlite3` and the generated client by hand, so that the
 * *production* path is what gets exercised here: `assertLocalNativeAbiSelected()`
 * (the ABI guard, called first inside `onModuleInit()`), `$connect()`
 * through the real adapter, and the `foreign_keys` pragma verification --
 * not a reimplementation of them. What this does *not* exercise: Nest's own
 * dependency-injection container. `LocalPrismaService` is instantiated with
 * `new` and its lifecycle hooks (`onModuleInit`/`onModuleDestroy`) are
 * called directly, the same shape Nest itself would call them in, but
 * without booting `ProfileModule`/the composition root around it. That is a
 * deliberate, narrow gap: standing up the full Nest application context
 * from an Electron main-process script would pull in far more than this
 * task needs to prove, and the module's own logic -- the part that actually
 * touches the native binary -- is exactly what runs either way.
 *
 * **Two different native binaries, deliberately loaded two different ways.**
 * This mirrors `scripts/select-native-abi.ts` and
 * `apps/api/src/prisma/local/native-abi-guard.ts` (read both for the full
 * story) -- summarized here only as far as this script needs it. The root
 * copy needs no rebuild for any Electron this repo targets; the adapter's
 * pinned copy is rebuilt per runtime by `scripts/select-native-abi.ts` and
 * must be selected to `electron` (see "How to run this" below) before this
 * script can pass steps 3 and 4.
 *
 * **Getting TypeScript to run under Electron.** A bare
 * `electron verify-native-runtime.ts` does not work: Electron's module
 * loader resolves `.ts` the same way plain Node does (unrecognized
 * extension -> "Cannot find module"), and the generated Prisma client this
 * script depends on transitively
 * (`apps/api/src/generated/prisma-sqlite/client.ts`) is itself TypeScript,
 * not compiled output -- a plain `require` of it fails the same way. Two
 * options exist: precompile everything this script touches, or register a
 * TS loader before anything is required. Precompiling was rejected because
 * it would mean either duplicating `apps/api`'s own build step for a
 * throwaway artifact, or committing compiled output that drifts from the
 * source -- both worse than the alternative. Instead, `tsx` -- already a
 * `devDependency` of `apps/api` and present in this workspace's hoisted
 * `node_modules` (this repo runs pnpm with `node-linker=hoisted`, so it
 * resolves from anywhere in the tree) -- is used via its CommonJS register
 * hook, `require('tsx/cjs')`, which installs a `require` extension handler
 * for `.ts` before anything else loads. That single line cannot live inside
 * this file, because loading *this* file already requires the hook to
 * exist first (nothing can bootstrap itself into being requirable). So a
 * tiny sibling, `verify-native-runtime.electron.cjs`, does only that:
 * register the hook, then `require('./verify-native-runtime.ts')`. Electron
 * is invoked against that `.cjs` entry, never against this file directly.
 * No new dependency was added -- `tsx` was already in the workspace for
 * `scripts/select-native-abi.ts`'s own `predev`/`pretest` wiring.
 *
 * **Why every result is written to a file, never to stdout.** A SIGSEGV
 * kills the process before buffered stdout ever flushes -- this is
 * literally how the original `better-sqlite3`-under-old-Electron bug this
 * whole phase exists to fix hid for as long as it did (see the plan doc's
 * probe table: `require()` succeeds, `new Database()` segfaults, and
 * nothing reaches the terminal). So this script never accumulates results
 * in memory to print at the end -- `record()` below appends each step's
 * outcome to the output file *the moment that step finishes*, before the
 * next, riskier step begins. If a later step crashes the process outright,
 * the file on disk still shows exactly how far execution got and what the
 * last confirmed-good step was; nothing about a fatal crash after that
 * point can be captured by this process itself (no `try/catch` survives a
 * segfault), but it also does not need to be -- silence past the last
 * recorded line *is* the diagnosis.
 *
 * **How to run this.** The v12 copy can only be built for one runtime at a
 * time in this checkout (see `scripts/select-native-abi.ts`), so the
 * `electron` ABI must be selected first, and `node` restored afterwards --
 * leaving the tree on `electron` breaks the API test suite for everyone
 * else:
 *
 * ```bash
 * npx tsx scripts/select-native-abi.ts electron
 * VERIFY_NATIVE_RUNTIME_OUT=/tmp/verify-native-runtime.txt \
 *   ./node_modules/.bin/electron apps/desktop/scripts/verify-native-runtime.electron.cjs
 * npx tsx scripts/select-native-abi.ts node
 * ```
 *
 * Run Electron with a hard timeout and be ready to kill it -- a crash deep
 * enough (a real ABI-mismatch segfault, for instance) can hang the process
 * rather than exit. This script calls `process.exit()` itself on every
 * path (success, a caught failure, or an uncaught rejection) specifically
 * so a *normal* run never needs to be killed; the timeout is insurance
 * against the abnormal case this whole phase is about.
 *
 * **Output path.** Read from `--out=<path>` (checked first) or the
 * `VERIFY_NATIVE_RUNTIME_OUT` environment variable (checked second).
 * Neither given is the one condition allowed to reach stderr instead of the
 * (nonexistent) output file, since there is nowhere else to report it.
 *
 * **Mutation-testing hook -- never set this outside proving the diagnostic
 * itself is trustworthy.** `VERIFY_NATIVE_RUNTIME_BREAK_V12_PATH=1` makes
 * step 3 require a path that cannot resolve, so this script's own claim of
 * correctness can be falsified on demand: a diagnostic that reports success
 * on a broken runtime is worse than no diagnostic at all. See the Task 2
 * report for a captured run with this set.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Database as BetterSqlite3Database } from 'better-sqlite3'
// Type-only: erased at compile time, so importing this never triggers the
// eager module load that a normal `import` would -- see "Why every result
// is written to a file" above for why steps 1-3 must already be durably on
// disk before anything this heavy is loaded. The actual value is obtained
// at runtime in step 4 via `require()` against an absolute path instead.
import type { LocalPrismaService as LocalPrismaServiceType } from '../../api/src/prisma/local/local-prisma.service'

type StepStatus = 'PASS' | 'FAIL'

interface StepResult {
  step: string
  status: StepStatus
  detail: string
}

const results: StepResult[] = []

// -----------------------------------------------------------------------
// Output path and incremental, crash-resilient recording
// -----------------------------------------------------------------------

function resolveOutputPath(): string {
  const fromArg = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
  const fromEnv = process.env['VERIFY_NATIVE_RUNTIME_OUT']
  const outPath = fromArg ?? fromEnv

  if (!outPath) {
    console.error(
      'verify-native-runtime: no output path given. Pass --out=<file> or set VERIFY_NATIVE_RUNTIME_OUT=<file>. ' +
        'Results are never written to stdout -- see this file\'s module doc comment for why.',
    )
    process.exit(2)
  }

  return resolve(outPath)
}

const OUTPUT_PATH = resolveOutputPath()

function writeHeader(): void {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(
    OUTPUT_PATH,
    [
      `verify-native-runtime -- ${new Date().toISOString()}`,
      `cwd: ${process.cwd()}`,
      `process.versions.electron: ${process.versions.electron ?? '(unset -- not running under Electron)'}`,
      `process.versions.modules: ${process.versions.modules}`,
      '',
    ].join('\n') + '\n',
  )
}

/** Appends immediately -- see the module doc comment: this must hit disk before any later, riskier step runs. */
function record(step: string, status: StepStatus, detail: string): void {
  results.push({ step, status, detail })
  appendFileSync(OUTPUT_PATH, `[${status}] ${step}: ${detail}\n`)
}

function recordFailureAndThrow(step: string, detail: string): never {
  record(step, 'FAIL', detail)
  throw new Error(detail)
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// -----------------------------------------------------------------------
// Paths -- resolved from this file's own location so the script works
// regardless of the invoking process's cwd, matching the convention
// `scripts/select-native-abi.ts` and `native-abi-guard.ts` already use.
// -----------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, '..', '..', '..')

const V12_BETTER_SQLITE3_DIR = join(
  REPO_ROOT,
  'node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3',
)

const MIGRATION_SQL_PATH = join(REPO_ROOT, 'apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql')

const LOCAL_PRISMA_SERVICE_PATH = join(REPO_ROOT, 'apps/api/src/prisma/local/local-prisma.service.ts')

/** See the module doc comment's "Mutation-testing hook" section. */
const FORCE_BROKEN_V12_PATH = process.env['VERIFY_NATIVE_RUNTIME_BREAK_V12_PATH'] === '1'

// -----------------------------------------------------------------------
// Step 1: report versions
// -----------------------------------------------------------------------

function step1ReportVersions(): void {
  const stepName = '1-report-versions'
  const electronVersion = process.versions.electron

  if (!electronVersion) {
    recordFailureAndThrow(
      stepName,
      'process.versions.electron is unset -- this script must run under the Electron binary via ' +
        'verify-native-runtime.electron.cjs, not plain Node. See the module doc comment for the invocation.',
    )
  }

  record(stepName, 'PASS', `electron=${electronVersion} modules(ABI)=${process.versions.modules}`)
}

// -----------------------------------------------------------------------
// Step 2: root v13 copy, bare specifier
// -----------------------------------------------------------------------

function roundTripThroughMemoryDb(DatabaseCtor: new (file: string) => BetterSqlite3Database, label: string): void {
  const db = new DatabaseCtor(':memory:')
  try {
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
    db.prepare('INSERT INTO probe (label) VALUES (?)').run(label)
    const row = db.prepare('SELECT label FROM probe WHERE id = 1').get() as { label: string } | undefined
    if (row?.label !== label) {
      throw new Error(`read back ${JSON.stringify(row)}, expected label ${JSON.stringify(label)}`)
    }
  } finally {
    db.close()
  }
}

function step2RootV13(): void {
  const stepName = '2-root-v13-bare-specifier'
  try {
    // Bare specifier: true N-API, needs no rebuild for this Electron
    // version -- see the module doc comment.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3')
    roundTripThroughMemoryDb(Database, 'root-v13-ok')
    record(stepName, 'PASS', "require('better-sqlite3') -> :memory: create/insert/read-back/close all succeeded")
  } catch (err) {
    recordFailureAndThrow(stepName, `require('better-sqlite3') failed -- ${describeError(err)}`)
  }
}

// -----------------------------------------------------------------------
// Step 3: the adapter's pinned v12 copy, absolute path
// -----------------------------------------------------------------------

function step3AdapterV12(): void {
  const stepName = '3-adapter-v12-absolute-path'
  const target = FORCE_BROKEN_V12_PATH ? `${V12_BETTER_SQLITE3_DIR}-mutation-proof-nonexistent` : V12_BETTER_SQLITE3_DIR

  try {
    // Absolute path, deliberately: @prisma/adapter-better-sqlite3's own
    // package.json `exports` map blocks a bare `require('better-sqlite3')`
    // from ever resolving to this copy (`Package subpath
    // './node_modules/better-sqlite3' is not defined by "exports"`) -- see
    // the module doc comment.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require(target)
    roundTripThroughMemoryDb(Database, 'adapter-v12-ok')
    record(stepName, 'PASS', `require(${JSON.stringify(target)}) -> :memory: create/insert/read-back/close all succeeded`)
  } catch (err) {
    recordFailureAndThrow(stepName, `require(${JSON.stringify(target)}) failed -- ${describeError(err)}`)
  }
}

// -----------------------------------------------------------------------
// Step 4: a real Prisma query, through LocalPrismaService
// -----------------------------------------------------------------------

async function step4RealPrismaQuery(): Promise<void> {
  const stepName = '4-prisma-create-count-via-local-prisma-service'
  let tempDir: string | undefined
  let service: LocalPrismaServiceType | undefined

  try {
    if (!existsSync(MIGRATION_SQL_PATH)) {
      throw new Error(`baseline migration not found at ${MIGRATION_SQL_PATH}`)
    }
    if (!existsSync(LOCAL_PRISMA_SERVICE_PATH)) {
      throw new Error(`LocalPrismaService not found at ${LOCAL_PRISMA_SERVICE_PATH}`)
    }

    tempDir = mkdtempSync(join(tmpdir(), 'wimm-verify-native-runtime-'))
    const dbFile = join(tempDir, 'verify.db')
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, 'utf8')

    // Built with the root v13 copy step 2 already proved safe -- this is
    // just fixture setup, not part of what step 4 is proving.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3')
    const buildDb = new Database(dbFile)
    buildDb.exec(migrationSql)
    buildDb.close()

    // Dynamic, absolute-path require of the real production class -- see
    // "LocalPrismaService, not a hand-rolled adapter" in the module doc
    // comment. The static `import type` above supplies the compile-time
    // type; this line supplies the runtime value, deferred until here so
    // steps 1-3's results are already durable before this heavier module
    // graph (Nest decorators, the generated Prisma client, the adapter)
    // is loaded at all.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LocalPrismaService } = require(LOCAL_PRISMA_SERVICE_PATH) as {
      LocalPrismaService: new (file: string) => LocalPrismaServiceType
    }

    service = new LocalPrismaService(dbFile)

    // Exercises the real production path in order: assertLocalNativeAbiSelected()
    // (the ABI guard -- refuses here if `electron` was not selected),
    // $connect() through PrismaBetterSqlite3, and the foreign_keys pragma
    // set-then-verify. See local-prisma.service.ts's own doc comment.
    await service.onModuleInit()

    const user = await service.user.create({
      data: {
        id: 'verify-native-runtime-user',
        email: 'verify-native-runtime@example.com',
        username: 'verify-native-runtime',
        passwordHash: 'not-a-real-hash-this-is-a-diagnostic-fixture',
        updatedAt: new Date(),
      },
    })
    const count = await service.user.count()

    if (count !== 1) {
      throw new Error(`expected user.count() === 1 after a single create, got ${count}`)
    }

    record(
      stepName,
      'PASS',
      `LocalPrismaService.onModuleInit() -> create() -> count(): created User(id=${JSON.stringify(user.id)}), count()=${count}`,
    )
  } catch (err) {
    recordFailureAndThrow(stepName, describeError(err))
  } finally {
    if (service) {
      await service.onModuleDestroy().catch(() => {
        // Best-effort: the step's own result (pass or fail) has already
        // been recorded; a teardown failure here must not overwrite it.
      })
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Best-effort cleanup only -- a leaked temp dir under the OS's own
        // tmp root is not a reason to fail a diagnostic that already has
        // its real answer.
      }
    }
  }
}

// -----------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------

async function main(): Promise<void> {
  step1ReportVersions()
  step2RootV13()
  step3AdapterV12()
  await step4RealPrismaQuery()
}

writeHeader()

main()
  .then(() => {
    appendFileSync(OUTPUT_PATH, `\nRESULT: PASS -- all ${results.length} steps succeeded.\n`)
    // Electron does not exit on its own once the main script's top-level
    // code finishes -- observed directly while developing this script (a
    // run with no window and no pending timers still hung until killed).
    // Explicit process.exit() is what makes a normal run actually
    // terminate instead of needing the caller's hard timeout to kill it.
    process.exit(0)
  })
  .catch((err) => {
    appendFileSync(OUTPUT_PATH, `\nRESULT: FAIL -- ${describeError(err)}\n`)
    process.exit(1)
  })
