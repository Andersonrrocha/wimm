/**
 * electron-builder `afterPack` hook.
 *
 * **The bug this works around.** `electron-builder`'s own pnpm-aware
 * node-modules collector (`pnpm list --prod --json --depth Infinity` plus
 * its own hoisting pass -- see `app-builder-lib/out/node-module-collector/`)
 * correctly *identifies* that `@prisma/adapter-better-sqlite3` pins its own
 * nested copy of `better-sqlite3` at `12.11.1` (distinct from the root
 * workspace's portable `13.0.1`), but its hoist/locate step resolves that
 * nested dependency's *physical files* to the wrong instance: the packaged
 * app ends up with `node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3`
 * containing `13.0.1`'s N-API prebuilds (`prebuilds/darwin-arm64.node`, ...)
 * instead of the pinned `12.11.1` this repo's own `scripts/select-native-abi.ts`
 * rebuilds per runtime. Confirmed empirically: the packaged app's
 * `package.json` at that nested path reported `"version": "13.0.1"`, while
 * `pnpm list`'s own JSON output (which `electron-builder` consumes) correctly
 * reports `12.11.1` for the same tree position -- the substitution happens in
 * `electron-builder`'s hoisting step, not in pnpm's own dependency resolution.
 *
 * **Why patching `app.asar.unpacked` alone is not enough.** A first version
 * of this hook only overwrote the real files under `app.asar.unpacked` (the
 * companion directory `asarUnpack` redirects native-module reads to) and left
 * `app.asar` itself untouched. That is insufficient: `app.asar`'s own header
 * -- a JSON index baked into the front of the archive at pack time -- still
 * described the *original* (wrong, 13.0.1) file layout for that nested path,
 * including which specific files are marked `unpacked: true`. Electron's
 * asar-aware `fs` integration decides whether a given virtual path
 * (`.../app.asar/node_modules/.../better-sqlite3/...`) redirects to the real
 * unpacked companion by consulting *that header*, not by checking the real
 * filesystem -- so a file that genuinely exists on disk in the corrected
 * `app.asar.unpacked` tree, but was never listed as a header entry at all
 * (13.0.1 doesn't have `build/Release/better_sqlite3.node`; it uses
 * `prebuilds/<platform>.node`), is invisible to any code resolving it through
 * the virtual `app.asar` path. This is exactly what broke at runtime: the
 * `bindings` package (which 12.11.1 depends on to locate its own native
 * binary -- 13.x's true-N-API build needs no such lookup, so the original,
 * wrong collection never pulled `bindings` in as a dependency at all) probed
 * `.../build/Release/better_sqlite3.node` among its candidates and got a
 * clean "not found" for a file that was, in reality, sitting right there on
 * disk -- because the header had no entry for that path. That failure is
 * caught by `apps/desktop/src/main/index.ts`'s own `bootLocalApi` try/catch
 * (it is not silently swallowed), but the catch block's only recourse today
 * is `dialog.showErrorBox`, a blocking native modal -- which is what actually
 * produced the appearance of an indefinite hang with no window and no
 * further output in a non-interactive launch. See `## Fix round 1` in this
 * task's report for the full instrumentation trail that pinned this down.
 *
 * **The fix.** Don't patch the unpacked companion in isolation -- extract the
 * *whole* `app.asar` (at this point, immediately after `electron-builder`'s
 * own packing, its header and its unpacked companion are still mutually
 * consistent, just wrong for this one nested path), overlay the corrected
 * `better-sqlite3` copy plus its `bindings`/`file-uri-to-path` runtime
 * dependencies into the extracted tree, and **repack `app.asar` from
 * scratch** so a fresh, correct header is generated for every path -- not
 * just the ones this hook touches. The repack preserves every directory
 * `electron-builder` had already chosen to unpack (discovered by reading the
 * *original* `app.asar.unpacked` before this hook mutates anything, so this
 * does not depend on a hardcoded list that could drift as other native
 * dependencies come and go) and adds this hook's three corrected directories
 * to that set explicitly, so they end up unpacked too even on a build where
 * they started out fully packed (as `bindings`/`file-uri-to-path` did before
 * this fix).
 *
 * Refuses loudly (throws, failing the whole `package` script) if the source
 * copy isn't `12.11.1`, has no `.node` binary, or the repack's own result
 * doesn't verify -- silently shipping *something* here would defeat the
 * entire point of this hook. Same verify-then-refuse contract
 * `native-abi-guard.ts` and `select-native-abi.ts` already use.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const asar = require('@electron/asar')
// `builder-util`'s `Arch` enum is already a transitive dependency of
// electron-builder itself (not something this hook adds) -- used only to
// turn `context.arch` (a numeric enum value) back into the string
// (`"arm64"`, `"x64"`, ...) `prunePrebuilds` needs to pick the one prebuild
// this specific build actually runs on, robustly across architectures
// rather than assuming this machine's own `arm64`.
const { Arch } = require('builder-util')

function archName(arch) {
  return Arch[arch]
}

const NESTED_RELATIVE_PATH = path.join(
  'node_modules',
  '@prisma',
  'adapter-better-sqlite3',
  'node_modules',
  'better-sqlite3',
)

const EXPECTED_VERSION = '12.11.1'

/**
 * `better-sqlite3` 12.x (pre-N-API) locates its native binary at runtime
 * through the `bindings` package (`lib/database.js` -> `require('bindings')`),
 * which in turn depends on `file-uri-to-path`. Neither is a dependency of
 * `better-sqlite3` 13.x (true N-API needs no such lookup), so
 * `electron-builder`'s collector -- having resolved the *wrong* (13.x)
 * instance for this nested path in the first place -- never had a reason to
 * include them at all. Both are pure JS (no native code), so a plain
 * top-level copy into the repacked app's own `node_modules`, unpacked
 * alongside the corrected `better-sqlite3`, is sufficient.
 */
const PURE_JS_DEPENDENCIES = ['bindings', 'file-uri-to-path']

// This file lives at apps/desktop/scripts/after-pack.cjs -- three levels up is the repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

function readVersion(packageJsonDir) {
  const pkgPath = path.join(packageJsonDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  return pkg.version
}

/**
 * Copies `src` to `dest`, skipping `node_modules/.bin` entirely.
 *
 * `better-sqlite3`'s own `node_modules` contains a `.bin/prebuild-install`
 * symlink (a normal package-manager-created CLI shim, relevant only to this
 * checkout's own dev tooling, never required at runtime). `fs.cpSync`'s
 * `recursive` mode preserves symlinks as symlinks rather than dereferencing
 * them -- copying that shim verbatim carries over its relative target
 * (several `../` segments reached through this checkout's own node_modules
 * layout), which does not resolve to anything inside the packaged app.
 * `codesign --verify --deep --strict` rejects a bundle containing a symlink
 * with an invalid destination outright ("invalid destination for symbolic
 * link in bundle") -- confirmed empirically. Excluding `.bin` avoids the
 * whole class of problem rather than trying to rewrite the link target.
 */
function copyRecursive(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('.bin'),
  })
}

/**
 * Strips node-gyp's build-time byproducts from a `better-sqlite3`-shaped
 * directory (root or nested), keeping only what is needed to `require()` the
 * package at runtime: the JS wrapper (`lib/`), `package.json`/`LICENSE`, and
 * the compiled addon (`build/Release/*.node` -- nothing else under `build/`).
 *
 * Measured directly on this repo's own packaged output before this function
 * existed: `deps/` (the bundled SQLite amalgamation source, ~9.8 MB per
 * copy), `src/` (this addon's own C++ source, ~160 KB), and everything under
 * `build/` besides the compiled `.node` file itself (intermediate `.o`/`.a`
 * objects, `.deps/` dependency files, Makefiles, `gyp-mac-tool`, a
 * `test_extension.node` built only for this package's own test suite -- 9+
 * MB per copy) are 100% build-time artifacts. None of them are read at
 * runtime -- `require('better-sqlite3')` only ever touches `lib/*.js` and
 * the one compiled addon `bindings.js` locates. Removing them is safe
 * precisely because compilation already happened before this hook runs;
 * there is nothing left that will ever rebuild from `deps`/`src` again for
 * this shipped copy.
 *
 * No-ops (does not throw) if the directory does not look like this package
 * at all, so callers can call it speculatively.
 */
function pruneBetterSqlite3BuildArtifacts(dir) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) return

  fs.rmSync(path.join(dir, 'deps'), { recursive: true, force: true })
  fs.rmSync(path.join(dir, 'src'), { recursive: true, force: true })
  fs.rmSync(path.join(dir, 'binding.gyp'), { force: true })
  // `bin/<platform>-<arch>-<abi>/better-sqlite3.node` is a stale artifact of
  // however this specific copy was originally installed (prebuild-install's
  // own cache convention) -- confirmed empirically that `bindings`' own
  // search order (the error trace this task's report captures verbatim)
  // never probes this path; only `build/Release/*.node` and a handful of
  // other candidates rooted at the package directory are ever tried.
  fs.rmSync(path.join(dir, 'bin'), { recursive: true, force: true })

  const buildDir = path.join(dir, 'build')
  if (!fs.existsSync(buildDir)) return
  const releaseDir = path.join(buildDir, 'Release')
  const compiledAddons = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).filter((name) => name.endsWith('.node') && name !== 'test_extension.node')
    : []
  // Rebuild `build/` from scratch containing only the compiled addon(s) --
  // simpler and more robust than trying to enumerate every intermediate
  // byproduct gyp/make can leave behind.
  for (const addon of compiledAddons) {
    const tmp = path.join(dir, `.__keep__${addon}`)
    fs.cpSync(path.join(releaseDir, addon), tmp)
    fs.rmSync(buildDir, { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, 'build', 'Release'), { recursive: true })
    fs.renameSync(tmp, path.join(dir, 'build', 'Release', addon))
  }
  if (compiledAddons.length === 0) {
    fs.rmSync(buildDir, { recursive: true, force: true })
  }
}

/**
 * Prunes a `prebuilds/<platform>-<arch>.node` directory (the layout the
 * *root*, portable `better-sqlite3` copy ships -- see
 * `apps/api/src/prisma/local/native-abi-guard.ts`'s doc comment for why this
 * copy is distinct from the pinned nested one) down to just the file this
 * packaged build actually runs on. electron-builder's own collector does not
 * prune this layout on its own -- confirmed directly: a `darwin`/`arm64`
 * package built on this machine still shipped all eight platform binaries
 * (~16 MB) before this function existed, for a build that can only ever load
 * one of them.
 */
function prunePrebuilds(prebuildsDir, platform, arch) {
  if (!fs.existsSync(prebuildsDir)) return
  const keep = `${platform}-${arch}.node`
  for (const name of fs.readdirSync(prebuildsDir)) {
    if (name !== keep) {
      fs.rmSync(path.join(prebuildsDir, name), { force: true })
    }
  }
}

/**
 * Reads which top-level `node_modules/*` (and one level of `@scope/*`)
 * entries `electron-builder` already chose to unpack, by inspecting the
 * *original* `app.asar.unpacked/node_modules` directory before this hook
 * changes anything. Returned as directory-relative paths
 * (`node_modules/bcrypt`, `node_modules/@prisma/adapter-better-sqlite3`),
 * suitable for building an `unpackDir` glob that preserves them across the
 * repack -- so this hook never has to hardcode which *other* native
 * dependencies (bcrypt, @napi-rs, ...) happen to need unpacking today.
 */
function discoverAlreadyUnpackedDirs(unpackedNodeModulesDir) {
  if (!fs.existsSync(unpackedNodeModulesDir)) return []

  const result = []
  for (const entry of fs.readdirSync(unpackedNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(unpackedNodeModulesDir, entry.name)
      for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scoped.isDirectory()) {
          result.push(path.join('node_modules', entry.name, scoped.name))
        }
      }
    } else {
      result.push(path.join('node_modules', entry.name))
    }
  }
  return result
}

/**
 * Builds the `unpackDir` glob electron-builder's own asar packer produces
 * (unpack the *whole* directory, not just the matched file) for every
 * directory in `relativeDirs`. Each alternative is suffixed with `{/**,}` so
 * it matches both the bare directory itself and anything nested under it --
 * plain `dir/**` alone does not match `dir` with zero trailing segments,
 * which is what `@electron/asar`'s own per-file check needs (it tests a
 * file's *parent directory* against this pattern, not the file itself).
 * Verified empirically against `@electron/asar`'s actual matching code
 * (`isUnpackedDir` in `lib/asar.js`) before relying on it here.
 */
function buildUnpackDirPattern(relativeDirs) {
  const posixDirs = relativeDirs.map((d) => d.split(path.sep).join('/'))
  return `{${posixDirs.map((d) => `${d}{/**,}`).join(',')}}`
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    // This hook is only proven for the macOS packaged layout
    // (`Contents/Resources/app.asar.unpacked`) -- see the module doc
    // comment. Other platforms are out of this task's scope; refusing
    // silently here would be worse than simply not running.
    return
  }

  const sourceDir = path.join(REPO_ROOT, NESTED_RELATIVE_PATH)
  const sourceVersion = readVersion(sourceDir)
  if (sourceVersion !== EXPECTED_VERSION) {
    throw new Error(
      `[after-pack] refusing to continue -- this checkout's own ${NESTED_RELATIVE_PATH} reports version ` +
        `${JSON.stringify(sourceVersion)}, expected ${JSON.stringify(EXPECTED_VERSION)}. Run ` +
        `"npx tsx scripts/select-native-abi.ts electron" from the repo root before packaging.`,
    )
  }
  const sourceBinary = path.join(sourceDir, 'build', 'Release', 'better_sqlite3.node')
  if (!fs.existsSync(sourceBinary)) {
    throw new Error(
      `[after-pack] refusing to continue -- ${sourceBinary} does not exist. Run ` +
        `"npx tsx scripts/select-native-abi.ts electron" from the repo root before packaging.`,
    )
  }
  for (const depName of PURE_JS_DEPENDENCIES) {
    if (!fs.existsSync(path.join(REPO_ROOT, 'node_modules', depName))) {
      throw new Error(
        `[after-pack] refusing to continue -- this checkout has no node_modules/${depName}, but the ` +
          `${EXPECTED_VERSION} better-sqlite3 copy requires it at runtime (require('bindings') from ` +
          'lib/database.js). Run "pnpm install" from the repo root.',
      )
    }
  }

  const appName = context.packager.appInfo.productFilename
  const appOutDir = context.appOutDir
  const resourcesDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources')
  const asarPath = path.join(resourcesDir, 'app.asar')
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')

  if (!fs.existsSync(asarPath)) {
    throw new Error(`[after-pack] refusing to continue -- expected an asar archive at ${asarPath}.`)
  }
  if (!fs.existsSync(unpackedDir)) {
    throw new Error(
      `[after-pack] refusing to continue -- expected an unpacked asar directory at ${unpackedDir} ` +
        '(asarUnpack should have produced one for **/*.node). Nothing to fix.',
    )
  }

  // Discover what electron-builder already decided to unpack BEFORE this
  // hook changes anything on disk, so the repack below preserves it exactly
  // -- see discoverAlreadyUnpackedDirs's doc comment.
  const alreadyUnpacked = discoverAlreadyUnpackedDirs(path.join(unpackedDir, 'node_modules'))
  console.log(`[after-pack] directories electron-builder already unpacked: ${alreadyUnpacked.join(', ')}`)

  const extractTo = path.join(os.tmpdir(), `wimm-asar-repack-${Date.now()}-${process.pid}`)

  console.log(`[after-pack] extracting ${asarPath} -> ${extractTo}`)
  fs.rmSync(extractTo, { recursive: true, force: true })
  asar.extractAll(asarPath, extractTo)

  // Overlay the corrected native module and its runtime dependencies onto
  // the extracted tree, at the same relative paths.
  const destNestedDir = path.join(extractTo, NESTED_RELATIVE_PATH)
  console.log(`[after-pack] replacing ${destNestedDir}`)
  console.log(`[after-pack]   with the electron-ABI-rebuilt ${sourceDir} (version ${sourceVersion})`)
  copyRecursive(sourceDir, destNestedDir)

  for (const depName of PURE_JS_DEPENDENCIES) {
    const depSource = path.join(REPO_ROOT, 'node_modules', depName)
    const depDest = path.join(extractTo, 'node_modules', depName)
    console.log(`[after-pack] copying ${depSource} -> ${depDest}`)
    copyRecursive(depSource, depDest)
  }

  // Strip node-gyp build byproducts and other-platform prebuilds from every
  // better-sqlite3 copy this package ships -- see pruneBetterSqlite3BuildArtifacts's
  // and prunePrebuilds's doc comments. This covers both the nested copy just
  // corrected above and the separate, portable root copy `open-local-database.ts`/
  // `snapshot.ts` use directly (untouched by the correction above, but shipping
  // the same kind of build-time cruft since it comes from the same kind of
  // node-gyp-built package).
  const rootBetterSqlite3Dir = path.join(extractTo, 'node_modules', 'better-sqlite3')
  pruneBetterSqlite3BuildArtifacts(rootBetterSqlite3Dir)
  prunePrebuilds(path.join(rootBetterSqlite3Dir, 'prebuilds'), 'darwin', archName(context.arch))
  pruneBetterSqlite3BuildArtifacts(destNestedDir)

  // Repack, preserving every directory electron-builder had already chosen
  // to unpack, plus this hook's three corrected directories explicitly (they
  // may not have been unpacked at all before -- bindings/file-uri-to-path
  // never were, since the wrong 13.x collection never pulled them in).
  const relativeNestedDir = NESTED_RELATIVE_PATH.split(path.sep).join('/')
  const unpackDirSet = new Set([
    ...alreadyUnpacked.map((d) => d.split(path.sep).join('/')),
    relativeNestedDir,
    ...PURE_JS_DEPENDENCIES.map((d) => `node_modules/${d}`),
  ])
  const unpackDirPattern = buildUnpackDirPattern([...unpackDirSet])
  console.log(`[after-pack] repacking with unpackDir pattern: ${unpackDirPattern}`)

  fs.rmSync(asarPath, { force: true })
  fs.rmSync(unpackedDir, { recursive: true, force: true })
  await asar.createPackageWithOptions(extractTo, asarPath, {
    unpack: '*.node',
    unpackDir: unpackDirPattern,
  })

  fs.rmSync(extractTo, { recursive: true, force: true })

  // Verify the repack actually produced what this hook set out to fix --
  // never assume a call that "didn't throw" did the right thing.
  const destVersion = readVersion(path.join(unpackedDir, NESTED_RELATIVE_PATH))
  const destBinary = path.join(unpackedDir, NESTED_RELATIVE_PATH, 'build', 'Release', 'better_sqlite3.node')
  if (destVersion !== EXPECTED_VERSION || !fs.existsSync(destBinary)) {
    throw new Error(
      `[after-pack] repack verification failed -- ${path.join(unpackedDir, NESTED_RELATIVE_PATH)} now reports ` +
        `version ${JSON.stringify(destVersion)} and binary-exists=${fs.existsSync(destBinary)}, expected version ` +
        `${JSON.stringify(EXPECTED_VERSION)} and the binary to exist.`,
    )
  }
  for (const depName of PURE_JS_DEPENDENCIES) {
    const depUnpackedPath = path.join(unpackedDir, 'node_modules', depName)
    if (!fs.existsSync(depUnpackedPath)) {
      throw new Error(
        `[after-pack] repack verification failed -- ${depUnpackedPath} does not exist after repacking. ` +
          `${depName} must be unpacked alongside better-sqlite3 for its runtime require() to find it.`,
      )
    }
  }

  console.log('[after-pack] done')
}
