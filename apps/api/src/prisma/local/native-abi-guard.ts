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
 *
 * **Inert outside a development checkout.** The marker mechanism only means
 * anything where the two ABIs actually contend for one artifact: a
 * `node_modules` this repo's own tooling builds and rebuilds. A *packaged*
 * Electron app has no such thing -- no repo checkout, no `.cache/`, and
 * `electron-builder` rebuilds native dependencies for the packaged runtime
 * at package time, so its copy is already correct by construction (see the
 * plan doc: "packaged builds are already correct"). If this guard refused
 * on a missing marker unconditionally, it would brick every packaged build,
 * refusing to connect in exactly the situation where the binary is right.
 * `isDevelopmentCheckout` is the signal that turns the guard off there. It
 * does not check `app.isPackaged`, and apps/api does not import `electron`
 * to get one -- Phase 3 kept the API free of that dependency on purpose.
 * Instead it checks for `pnpm-workspace.yaml` at the computed repo root:
 * that file is committed at this monorepo's root, is never part of
 * `electron-builder`'s packaged `files` allowlist (`apps/desktop/package.json`'s
 * `build.files` lists only the `out` build directory and `package.json`
 * itself -- nothing else ships), and is not something an ordinary
 * development session or CI run ever lacks. An environment variable was
 * considered and rejected: it is exactly the kind of thing a developer
 * could set (deliberately or by copy-pasting a stale `.env`) to silently
 * disable the guard during ordinary development, which is precisely the
 * SIGSEGV / `NODE_MODULE_VERSION` hazard this task exists to eliminate.
 * Structural absence of this repo's own workspace file cannot be spoofed by
 * anything short of deliberately sabotaging the checkout itself.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export type NativeAbiTarget = 'node' | 'electron'

interface NativeAbiMarker {
  target: NativeAbiTarget
}

function currentRuntime(): NativeAbiTarget {
  return typeof process.versions.electron === 'string' ? 'electron' : 'node'
}

function markerFileFor(repoRoot: string): string {
  return join(repoRoot, '.cache', 'native-abi', 'marker.json')
}

/** See the module doc comment ("Inert outside a development checkout"). */
function isDevelopmentCheckout(repoRoot: string): boolean {
  return existsSync(join(repoRoot, 'pnpm-workspace.yaml'))
}

function fixCommand(target: NativeAbiTarget): string {
  return `npx tsx scripts/select-native-abi.ts ${target}`
}

/**
 * Reads and validates the marker at `<repoRoot>/.cache/native-abi/marker.json`.
 *
 * Returns `undefined` only when the file genuinely does not exist yet --
 * "never selected" is not corruption, and callers refuse for a different,
 * more specific reason than they do for corruption (see
 * `assertNativeAbiSelectedAt`). Every other way this file can fail to be
 * read -- unreadable (e.g. a directory sits where the file should be),
 * unparseable JSON, or valid JSON with no recognizable `target` -- throws,
 * naming the file and what is actually wrong with it. Silently treating any
 * of those the same as "missing" would misdiagnose the problem: a corrupt
 * marker means the ABI *was* selected and something damaged the record of
 * it, not that it was never selected at all. This mirrors
 * `profile-registry.ts`'s `readRegistry`, which draws exactly this line
 * between "file absent" and "file present but broken" for the same reason
 * -- see that module's doc comment.
 */
function readMarker(repoRoot: string): NativeAbiMarker | undefined {
  const markerFile = markerFileFor(repoRoot)

  if (!existsSync(markerFile)) return undefined

  let raw: string
  try {
    raw = readFileSync(markerFile, 'utf8')
  } catch (err) {
    throw new Error(`the marker file exists but could not be read (${(err as Error).message})`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`the marker file is corrupt -- not valid JSON (${(err as Error).message})`)
  }

  const target = (parsed as Partial<NativeAbiMarker> | null)?.target
  if (target !== 'node' && target !== 'electron') {
    throw new Error(
      `the marker file is corrupt -- expected "target" to be "node" or "electron", got ${JSON.stringify(target)}`,
    )
  }

  return { target }
}

/**
 * Throws unless the native ABI marker confirms the currently-active
 * `better-sqlite3` build (the one `@prisma/adapter-better-sqlite3` will load)
 * matches the runtime this process is actually running under -- or unless
 * `repoRoot` doesn't look like a development checkout at all, in which case
 * this is a no-op (see the module doc comment). Takes an explicit `repoRoot`
 * so tests can point it at a throwaway directory instead of this repo's own
 * `pnpm-workspace.yaml` and `.cache/native-abi/marker.json`; `assertLocalNativeAbiSelected`
 * below is the real entry point, fixed to this checkout's actual root.
 *
 * Call this before `$connect()` -- `PrismaBetterSqlite3`'s constructor does
 * not touch the native binary (it only stores config), but `.connect()`
 * does, via `new Database(...)` deep inside the adapter. That is the last
 * safe point to refuse.
 */
export function assertNativeAbiSelectedAt(repoRoot: string): void {
  if (!isDevelopmentCheckout(repoRoot)) return

  const runtime = currentRuntime()
  const markerFile = markerFileFor(repoRoot)

  let marker: NativeAbiMarker | undefined
  try {
    marker = readMarker(repoRoot)
  } catch (err) {
    throw new Error(
      `LocalPrismaService: refusing to connect -- ${(err as Error).message} (${markerFile}). ` +
        `Run "${fixCommand(runtime)}" from the repo root to rebuild and reselect, then retry.`,
    )
  }

  if (!marker) {
    throw new Error(
      `LocalPrismaService: refusing to connect -- no native ABI marker found at ${markerFile}. ` +
        'The Prisma-pinned better-sqlite3 copy has not been built for either runtime yet in this checkout. ' +
        `Run "${fixCommand(runtime)}" from the repo root, then retry.`,
    )
  }

  if (marker.target !== runtime) {
    throw new Error(
      `LocalPrismaService: refusing to connect -- the native ABI marker at ${markerFile} says "${marker.target}", ` +
        `but this process is running under "${runtime}". The Prisma-pinned better-sqlite3 copy currently in ` +
        `node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3 was built for "${marker.target}" ` +
        `and cannot be loaded by "${runtime}" without either a raw NODE_MODULE_VERSION error or undefined behaviour. ` +
        `Run "${fixCommand(runtime)}" from the repo root, then retry.`,
    )
  }
}

// This mirrors the cache/marker layout `scripts/select-native-abi.ts` writes,
// but cannot import that module directly: apps/api's tsconfig `rootDir` is
// `./src`, and a script living at the repo root falls outside it. The two
// files agree on this path independently, the same way
// `check-constraints.ts` and the live database independently agree on a
// schema contract -- see that module's doc comment for the same pattern.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')

export function assertLocalNativeAbiSelected(): void {
  assertNativeAbiSelectedAt(REPO_ROOT)
}
