/**
 * Refuse to let the local Prisma path open a database when the wrong native
 * ABI of `better-sqlite3` is active in this checkout.
 *
 * **Why this exists.** Two copies of `better-sqlite3` live in this repo's
 * `node_modules` (see `scripts/select-native-abi.ts` for the full story):
 * the root workspace copy (true N-API, portable across runtimes, used by
 * `openLocalDatabase` and `snapshot.ts`), and the copy
 * `@prisma/adapter-better-sqlite3` pins internally (pre-N-API, tied to the
 * exact `NODE_MODULE_VERSION` it was compiled for). That second copy is the
 * one `LocalPrismaService` depends on through the adapter, and it can only
 * be built for one runtime -- Node or Electron -- at a time. `openLocalDatabase`
 * never touches this hazard at all; it uses the portable copy.
 *
 * `scripts/select-native-abi.ts` swaps the compiled artifact and records the
 * active choice in a marker file. This guard reads that marker and compares
 * it against the runtime the current process is actually executing under.
 * A mismatch means the wrong binary is sitting in
 * `node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3/build/Release`
 * for this process, and `PrismaBetterSqlite3.connect()` will hit it -- either
 * a raw, confusing `NODE_MODULE_VERSION` error, or (Node loading an
 * Electron-built addon, or vice versa) undefined behaviour. This guard turns
 * that into one sentence naming the mismatch and the exact fix, checked
 * *before* `$connect()` ever reaches the native binary.
 *
 * Same contract as `openLocalDatabase` and `LocalPrismaService`'s pragma
 * check: verify, then refuse -- never warn and continue. A missing marker is
 * refused rather than defaulted to "node", because guessing wrong here is
 * exactly the failure this guard exists to prevent.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export type NativeAbiTarget = 'node' | 'electron'

interface NativeAbiMarker {
  target: NativeAbiTarget
}

// This mirrors the cache/marker layout `scripts/select-native-abi.ts` writes,
// but cannot import that module directly: apps/api's tsconfig `rootDir` is
// `./src`, and a script living at the repo root falls outside it. The two
// files agree on this path independently, the same way
// `check-constraints.ts` and the live database independently agree on a
// schema contract -- see that module's doc comment for the same pattern.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const MARKER_FILE = join(REPO_ROOT, '.cache', 'native-abi', 'marker.json')

function currentRuntime(): NativeAbiTarget {
  return typeof process.versions.electron === 'string' ? 'electron' : 'node'
}

function readMarker(): NativeAbiMarker | undefined {
  if (!existsSync(MARKER_FILE)) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(MARKER_FILE, 'utf8'))
  } catch {
    return undefined
  }

  const target = (parsed as Partial<NativeAbiMarker> | null)?.target
  return target === 'node' || target === 'electron' ? { target } : undefined
}

function fixCommand(target: NativeAbiTarget): string {
  return `npx tsx scripts/select-native-abi.ts ${target}`
}

/**
 * Throws unless the native ABI marker confirms the currently-active
 * `better-sqlite3` build (the one `@prisma/adapter-better-sqlite3` will load)
 * matches the runtime this process is actually running under.
 *
 * Call this before `$connect()` -- `PrismaBetterSqlite3`'s constructor does
 * not touch the native binary (it only stores config), but `.connect()`
 * does, via `new Database(...)` deep inside the adapter. That is the last
 * safe point to refuse.
 */
export function assertLocalNativeAbiSelected(): void {
  const runtime = currentRuntime()
  const marker = readMarker()

  if (!marker) {
    throw new Error(
      `LocalPrismaService: refusing to connect -- no native ABI marker found at ${MARKER_FILE}. ` +
        'The Prisma-pinned better-sqlite3 copy has not been built for either runtime yet in this checkout. ' +
        `Run "${fixCommand(runtime)}" from the repo root, then retry.`,
    )
  }

  if (marker.target !== runtime) {
    throw new Error(
      `LocalPrismaService: refusing to connect -- the native ABI marker at ${MARKER_FILE} says "${marker.target}", ` +
        `but this process is running under "${runtime}". The Prisma-pinned better-sqlite3 copy currently in ` +
        `node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3 was built for "${marker.target}" ` +
        `and cannot be loaded by "${runtime}" without either a raw NODE_MODULE_VERSION error or undefined behaviour. ` +
        `Run "${fixCommand(runtime)}" from the repo root, then retry.`,
    )
  }
}
