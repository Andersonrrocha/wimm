#!/usr/bin/env -S npx tsx
/**
 * Selects which compiled ABI of the Prisma-pinned `better-sqlite3` copy is
 * active in this checkout: `node`, for the API test suite, or `electron`,
 * for the desktop app.
 *
 * **The problem this solves.** Two copies of `better-sqlite3` live in this
 * repo's `node_modules` and they are not equivalent:
 *
 * - `node_modules/better-sqlite3` (root) is true N-API and ships prebuilt
 *   binaries for every platform. It needs no rebuild for any supported
 *   runtime and is never touched by this script.
 * - `node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3`
 *   is pre-N-API, built from source, and tied to the exact
 *   `NODE_MODULE_VERSION` of whatever process compiled it. This is the copy
 *   `LocalPrismaService` depends on through the adapter, and `@prisma/adapter-better-sqlite3`
 *   hard-pins it -- it cannot be swapped for the portable one. It can only
 *   be built for *one* runtime at a time, but the API test suite needs the
 *   Node build and the running desktop app needs the Electron build.
 *
 * **The fix.** Compile that second copy once per runtime, cache each result
 * outside the package's own `build/` directory (so a rebuild for one runtime
 * can never clobber the other's cached artifact), and make day-to-day
 * "selection" a file copy plus a marker write instead of a rebuild. The
 * marker is read by `apps/api/src/prisma/local/native-abi-guard.ts`, which
 * refuses to let `LocalPrismaService` connect when it disagrees with the
 * runtime actually in use.
 *
 * **Where the cache lives, and why.** `.cache/native-abi/` at the repo root,
 * not inside `node_modules/`. Everything under `node_modules/` is already
 * git-ignored wholesale and is exactly the tree `pnpm install` is entitled to
 * prune, rewrite, or recreate on every install -- a cache that must survive
 * across installs cannot live there. A top-level, explicitly git-ignored
 * directory is the same reasoning `.turbo/` and `dist/` already follow in
 * this repo's `.gitignore`.
 *
 * **Never trust a rebuild tool's own summary.** `@electron/rebuild` prints
 * "✔ Rebuild Complete" whether or not it actually touched the file this
 * script cares about (observed directly: it left the root v13 `prebuilds/`
 * byte-identical while only the v12 copy changed). So `buildForTarget` below
 * hashes the live binary before and after every build and refuses to cache
 * the result if the hash didn't change, or if no binary appeared at all.
 */
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type NativeAbiTarget = 'node' | 'electron'

export interface NativeAbiMarker {
  target: NativeAbiTarget
  updatedAt: string
}

export interface NativeAbiPaths {
  /** Repo root -- also the cwd `@electron/rebuild`'s `-m apps/api` is relative to. */
  repoRoot: string
  /** Git-ignored cache holding one compiled binary per runtime. */
  cacheDir: string
  /** Records which target is currently copied into `liveBinary`. */
  markerFile: string
  /** The `better-sqlite3` package directory `@prisma/adapter-better-sqlite3` pins. */
  adapterDir: string
  /** The `.node` file Node/Electron actually `dlopen`s at runtime. */
  liveBinary: string
}

export function resolveNativeAbiPaths(repoRoot: string): NativeAbiPaths {
  const cacheDir = join(repoRoot, '.cache', 'native-abi')
  const adapterDir = join(repoRoot, 'node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3')

  return {
    repoRoot,
    cacheDir,
    markerFile: join(cacheDir, 'marker.json'),
    adapterDir,
    liveBinary: join(adapterDir, 'build/Release/better_sqlite3.node'),
  }
}

function cachedBinaryPath(paths: NativeAbiPaths, target: NativeAbiTarget): string {
  return join(paths.cacheDir, target, 'better_sqlite3.node')
}

function fileHash(file: string): string | undefined {
  if (!existsSync(file)) return undefined
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function readNativeAbiMarker(paths: NativeAbiPaths): NativeAbiMarker | undefined {
  if (!existsSync(paths.markerFile)) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(paths.markerFile, 'utf8'))
  } catch {
    return undefined
  }

  const candidate = parsed as Partial<NativeAbiMarker> | null
  if (candidate?.target !== 'node' && candidate?.target !== 'electron') return undefined

  return { target: candidate.target, updatedAt: candidate.updatedAt ?? '' }
}

function writeNativeAbiMarker(paths: NativeAbiPaths, target: NativeAbiTarget): void {
  mkdirSync(paths.cacheDir, { recursive: true })
  const marker: NativeAbiMarker = { target, updatedAt: new Date().toISOString() }
  writeFileSync(paths.markerFile, JSON.stringify(marker, null, 2) + '\n')
}

function installedElectronVersion(repoRoot: string): string {
  const pkgPath = join(repoRoot, 'node_modules', 'electron', 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(
      `select-native-abi: cannot determine the installed Electron version -- ${pkgPath} does not exist. ` +
        'Run "pnpm install" first.',
    )
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
  if (!pkg.version) {
    throw new Error(`select-native-abi: ${pkgPath} has no "version" field.`)
  }
  return pkg.version
}

/**
 * Runs the proven rebuild command for `target`, leaving a correct, freshly
 * built binary at `paths.liveBinary`. Both commands are known to work
 * (verified directly on this machine) -- this function's job is only to
 * invoke them correctly and to verify the artifact actually changed, not to
 * re-derive them. It does not touch the cache: `selectNativeAbiAt` owns
 * populating the cache from whatever `paths.liveBinary` holds once a build
 * (real or, in tests, fake) returns, so every `BuildFn` only has one
 * obligation to satisfy.
 */
/**
 * `npx` is `npx.cmd` on Windows, and `execFileSync` without `shell: true`
 * cannot execute a `.cmd` -- it fails with ENOENT. The arguments below are all
 * hardcoded literals, never user input, so a shell adds no injection surface
 * here; it is only how Windows reaches a batch wrapper at all.
 *
 * This matters because the cross-platform CI job runs this script on Windows,
 * and a fresh runner has an empty artifact cache, so it takes the build path
 * rather than the fast copy. Without this the Windows job would fail during
 * setup and never reach the question it was added to answer.
 */
export function needsShellForNpx(platform: string): boolean {
  return platform === 'win32'
}

function runNpx(args: string[], cwd: string): void {
  execFileSync('npx', args, { cwd, stdio: 'inherit', shell: needsShellForNpx(process.platform) })
}

export function buildForTarget(paths: NativeAbiPaths, target: NativeAbiTarget): void {
  console.log(`[select-native-abi] No cached '${target}' build yet -- compiling it once (this can take a while)...`)

  const before = fileHash(paths.liveBinary)

  if (target === 'node') {
    runNpx(['node-gyp', 'rebuild'], paths.adapterDir)
  } else {
    const electronVersion = installedElectronVersion(paths.repoRoot)
    runNpx(
      ['@electron/rebuild', '-v', electronVersion, '-m', 'apps/api', '-o', 'better-sqlite3', '-f'],
      paths.repoRoot,
    )
  }

  if (!existsSync(paths.liveBinary)) {
    throw new Error(
      `select-native-abi: the '${target}' rebuild reported success but ${paths.liveBinary} does not exist. ` +
        'Do not trust a rebuild tool\'s own summary -- see this file\'s doc comment.',
    )
  }

  const after = fileHash(paths.liveBinary)
  if (before !== undefined && before === after) {
    throw new Error(
      `select-native-abi: the '${target}' rebuild reported success but did not change ${paths.liveBinary}. ` +
        "@electron/rebuild is known to print '✔ Rebuild Complete' while silently touching nothing -- " +
        "never trust that message alone; see this file's doc comment.",
    )
  }

  console.log(`[select-native-abi] Built '${target}' at ${paths.liveBinary}.`)
}

export type BuildFn = (paths: NativeAbiPaths, target: NativeAbiTarget) => void

/**
 * Selects `target` against an explicit set of paths. `selectNativeAbi` below
 * is the real entry point; this variant exists so tests can point the whole
 * mechanism at a throwaway directory and inject a fake `build`, instead of
 * touching this repo's actual `node_modules` and running a real 30-second
 * compile on every test run.
 */
export function selectNativeAbiAt(paths: NativeAbiPaths, target: NativeAbiTarget, build: BuildFn = buildForTarget): void {
  mkdirSync(paths.cacheDir, { recursive: true })

  const cachedPath = cachedBinaryPath(paths, target)
  if (!existsSync(cachedPath)) {
    build(paths, target)
    // The build's only obligation is a correct `paths.liveBinary`; cache it
    // here so both the real build and every test double share one place
    // that decides what "cached" means.
    mkdirSync(dirname(cachedPath), { recursive: true })
    copyFileSync(paths.liveBinary, cachedPath)
    console.log(`[select-native-abi] Cached the '${target}' build at ${cachedPath}.`)
  }

  const marker = readNativeAbiMarker(paths)
  if (marker?.target === target && existsSync(paths.liveBinary)) {
    console.log(`[select-native-abi] '${target}' is already selected -- nothing to do.`)
    return
  }

  mkdirSync(dirname(paths.liveBinary), { recursive: true })
  // Unlink before copying rather than overwriting in place. On macOS the
  // kernel caches code-signing validation per file identity (inode), and
  // rewriting the bytes of an existing `.node` can leave that cache stale:
  // a later `dlopen()` is then killed with SIGKILL and no catchable error,
  // even when the file's contents are byte-identical to a build that loads
  // fine. Observed directly during phase 4a while switching ABIs
  // repeatedly. Replacing the file gives the new binary a fresh inode, so
  // validation runs against what is actually on disk.
  //
  // A silent SIGKILL is the exact failure class this whole mechanism exists
  // to remove, so this is not a micro-optimisation -- overwriting in place
  // reintroduces it one layer down.
  if (existsSync(paths.liveBinary)) rmSync(paths.liveBinary)
  copyFileSync(cachedPath, paths.liveBinary)
  writeNativeAbiMarker(paths, target)
  console.log(`[select-native-abi] Selected '${target}' (${cachedPath} -> ${paths.liveBinary}).`)
}

const REPO_ROOT = join(__dirname, '..')

/** Selects the native ABI for `target` in this checkout. See the module doc comment. */
export function selectNativeAbi(target: NativeAbiTarget): void {
  selectNativeAbiAt(resolveNativeAbiPaths(REPO_ROOT), target)
}

function parseTarget(argv: readonly string[]): NativeAbiTarget {
  const value = argv[2]
  if (value !== 'node' && value !== 'electron') {
    console.error(`Usage: select-native-abi.ts <node|electron>\nGot: ${JSON.stringify(value)}`)
    process.exit(1)
  }
  return value
}

if (require.main === module) {
  try {
    selectNativeAbi(parseTarget(process.argv))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
