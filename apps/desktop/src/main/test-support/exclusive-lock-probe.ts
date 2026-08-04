/**
 * Shared test-only technique for proving a profile's SQLite connection is
 * genuinely, OS-level closed -- not just that some `close()` function was
 * called and returned. First built for `local-api.spec.ts`'s `switchProfile`
 * proof (Phase 4c task 3); reused here, unmodified, by `updater.spec.ts`'s
 * proof that `quitAndInstallUpdate` (`../updater.ts`) closes the current
 * profile's connection before ever asking `electron-updater` to install
 * anything (Stage 4 task 4.4 -- "reuse it rather than writing a second one"
 * is a hard constraint of that task, not just tidiness). Extracted into its
 * own module on this, its second use, per this repo's own rule: abstract
 * only on the second duplication.
 *
 * The exclusive-lock proof below needs a probe that shares OS-level lock
 * visibility with the REAL connection `LocalPrismaService` uses at runtime.
 * The obvious choice -- the root workspace `better-sqlite3` package, the
 * exact one `assertExclusiveAccess` itself uses
 * (`apps/api/src/prisma/local/snapshot.ts`) -- does NOT work here:
 * `@prisma/adapter-better-sqlite3` bundles a *different* `better-sqlite3`
 * build internally (see `native-abi-guard.ts`'s doc comment for why two
 * builds exist in this repo at all), and empirically, in this environment, a
 * lock held by that bundled build is invisible to a probe using the root
 * build, and vice versa -- confirmed directly while building the original
 * `switchProfile` test (see the phase 4c task 3 report): a raw
 * `better-sqlite3` (root) probe against a REAL, live, genuinely
 * mid-transaction `LocalPrismaService` connection reports no lock at all. A
 * test built on that probe would pass identically whether or not the code
 * under test actually closed anything, which is exactly the "proves nothing
 * about the operating system" failure both that task and this one warn
 * against. `ADAPTER_BETTER_SQLITE3_DIR` below is the exact path
 * `scripts/select-native-abi.ts` and `apps/desktop/scripts/verify-native-
 * runtime.ts` already use for this same bundled copy; this module reuses it
 * for the probe only -- never for anything this app ships.
 */
import { join } from 'node:path'

import { LocalPrismaService } from '@wimm/api/dist/prisma/local/local-prisma.service'

import type { LocalApiHandle } from '../local-api'

const ADAPTER_BETTER_SQLITE3_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3',
)

interface AdapterBuildDatabase {
  pragma(sql: string): unknown
  exec(sql: string): unknown
  close(): void
}

// eslint-disable-next-line @typescript-eslint/no-var-requires -- must be the exact bundled build, not the root workspace one; see the module doc comment.
const AdapterDatabase = require(ADAPTER_BETTER_SQLITE3_DIR) as new (file: string) => AdapterBuildDatabase

/**
 * True if a brand-new connection to `file`, opened with the SAME
 * `better-sqlite3` build `LocalPrismaService` uses (see the module doc
 * comment), can immediately escalate to an exclusive write lock:
 * `busy_timeout = 0` (a conflict fails immediately instead of blocking) then
 * `BEGIN IMMEDIATE` followed by `COMMIT`. Mirrors `assertExclusiveAccess`'s
 * own technique (`apps/api/src/prisma/local/snapshot.ts`) exactly, just
 * against the build that can actually see a lock this app's own connections
 * hold.
 */
export function canAcquireExclusiveLock(file: string): boolean {
  const probe = new AdapterDatabase(file)
  probe.pragma('busy_timeout = 0')
  try {
    probe.exec('BEGIN IMMEDIATE')
    probe.exec('COMMIT')
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_BUSY') return false
    throw err
  } finally {
    probe.close()
  }
}

/**
 * Starts a genuine, held, uncommitted write transaction against `handle`'s
 * own database, through its own real `LocalPrismaService`
 * (`handle.app.get(...)`) -- see `LocalApiHandle.app`'s doc comment for why
 * this is the only way found to put a real, OS-level SQLite lock on a
 * profile's file that later matters for proving a teardown genuinely
 * releases it. An idle connection -- even a fully open one -- holds no
 * SQLite lock at all, so there is nothing for `canAcquireExclusiveLock` to
 * catch unless a transaction is genuinely in flight.
 *
 * The returned `started` promise resolves only once the write inside the
 * transaction has actually completed -- i.e. once the lock is genuinely
 * held -- so a caller that awaits it before probing never races the
 * transaction's own async startup (an earlier version of the original
 * `switchProfile` test probed immediately after calling this function, with
 * no synchronization at all, and flaked exactly this way: the probe ran
 * before `BEGIN` had even been issued). The transaction then stays open
 * until the returned `release` is called. `settled` resolves once it has
 * actually finished one way or another -- including "abandoned because the
 * connection was closed out from under it", which is the expected, correct
 * outcome of a genuine `close()` (see the phase 4c task 3 report:
 * `app.close()` does not wait for a pending interactive transaction, it
 * tears the connection down immediately, and the transaction's own promise
 * later rejects with a "Transaction not found" error from Prisma). That
 * rejection is swallowed here rather than asserted on, because it is a side
 * effect of the close a test is proving happened, not something the test
 * needs to name.
 */
export function holdOpenTransaction(handle: LocalApiHandle): {
  started: Promise<void>
  release: () => void
  settled: Promise<void>
} {
  const prisma = handle.app.get(LocalPrismaService)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let signalStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })

  const settled = prisma
    .$transaction(async (tx) => {
      const user = await tx.user.findFirstOrThrow()
      await tx.category.create({ data: { userId: user.id, name: 'Held open by a test', type: 'EXPENSE' } })
      signalStarted()
      await gate
    })
    .then(() => undefined)
    .catch(() => undefined)

  return { started, release, settled }
}
