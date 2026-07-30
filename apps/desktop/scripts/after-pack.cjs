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
 * rebuilds per runtime. Confirmed empirically while proving this task: the
 * packaged app's `package.json` at that nested path reports `"version":
 * "13.0.1"`, while `pnpm list`'s own JSON output (which `electron-builder`
 * consumes) correctly reports `12.11.1` for the same tree position -- the
 * substitution happens in `electron-builder`'s hoisting step, not in pnpm's
 * own dependency resolution.
 *
 * That substitution is not merely "the wrong version number": driving the
 * real `LocalPrismaService` -> `PrismaBetterSqlite3` -> `better-sqlite3`
 * path through the substituted `13.0.1` copy inside the packaged app hung
 * indefinitely (observed directly with `sample` -- the main thread sat
 * inside V8/Node's module-execution machinery, never returning, never
 * crashing) rather than working or failing loudly. A raw, standalone
 * `require()` + round-trip of that same substituted binary succeeds in
 * isolation (it is a legitimate, ABI-correct N-API build) -- the hang is
 * specific to how `@prisma/adapter-better-sqlite3`'s own code drives it,
 * not to the binary being unloadable. Silently shipping a dependency
 * version electron-builder never actually rebuilt or intended to select is
 * exactly the "may simply be absent from the bundle" class of landmine this
 * task exists to catch, just manifesting as a hang instead of a missing
 * file.
 *
 * **The fix.** After `electron-builder` finishes collecting and unpacking
 * node_modules (this hook runs after packing, before signing -- see
 * `afterSign` in this same directory, which must run *after* this so the
 * code signature seals the corrected files, not the substituted ones),
 * overwrite the packaged app's copy of that one nested directory with this
 * checkout's own, known-good copy: the exact one `scripts/select-native-abi.ts
 * electron` already selected and `apps/desktop/scripts/verify-native-runtime.ts`
 * already proved works end-to-end through `LocalPrismaService`. This is a
 * whole-directory copy (JS wrapper + native binary together), not just the
 * `.node` file, because the wrapper code in `lib/*.js` is itself
 * version-specific and must match the binary it loads.
 *
 * Refuses loudly (throws, failing the whole `package` script) if this
 * checkout's own copy is not `12.11.1` or has no `.node` binary at all --
 * silently shipping *something* here would defeat the entire point of this
 * hook. This is the same "verify, then refuse" contract
 * `native-abi-guard.ts` and `select-native-abi.ts` already use.
 */
const fs = require('fs')
const path = require('path')

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
 * instance for this nested path in the first place, see the module doc
 * comment -- never had a reason to include them, and the packaged app ships
 * with no `bindings` anywhere. Confirmed empirically: `require('bindings')`
 * from inside the corrected 12.11.1 copy failed with "Cannot find module
 * 'bindings'" the first time this hook shipped only `better-sqlite3` itself.
 * Both packages are pure JS (no native code, nothing ABI-specific), so a
 * plain top-level copy into the packaged app's own `node_modules` -- where
 * Node's normal upward module-resolution walk from
 * `.../adapter-better-sqlite3/node_modules/better-sqlite3/lib/database.js`
 * will find them -- is sufficient.
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
 * link in bundle") -- confirmed empirically after this hook's first version
 * shipped that symlink verbatim. Excluding `.bin` avoids the whole class of
 * problem rather than trying to rewrite the link target.
 */
function copyRecursive(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('.bin'),
  })
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

  const appName = context.packager.appInfo.productFilename
  const appOutDir = context.appOutDir
  const unpackedDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources', 'app.asar.unpacked')
  const destDir = path.join(unpackedDir, NESTED_RELATIVE_PATH)

  if (!fs.existsSync(unpackedDir)) {
    throw new Error(
      `[after-pack] refusing to continue -- expected an unpacked asar directory at ${unpackedDir} ` +
        '(asarUnpack should have produced one for **/*.node). Nothing to fix.',
    )
  }

  console.log(`[after-pack] replacing ${destDir}`)
  console.log(`[after-pack]   with the electron-ABI-rebuilt ${sourceDir} (version ${sourceVersion})`)
  copyRecursive(sourceDir, destDir)

  const destVersion = readVersion(destDir)
  const destBinary = path.join(destDir, 'build', 'Release', 'better_sqlite3.node')
  if (destVersion !== EXPECTED_VERSION || !fs.existsSync(destBinary)) {
    throw new Error(
      `[after-pack] copy verification failed -- ${destDir} now reports version ${JSON.stringify(destVersion)} ` +
        `and binary-exists=${fs.existsSync(destBinary)}, expected version ${JSON.stringify(EXPECTED_VERSION)} ` +
        'and the binary to exist.',
    )
  }

  // See PURE_JS_DEPENDENCIES's doc comment -- 12.11.1's own runtime lookup
  // needs these, and electron-builder's collector never included them.
  for (const depName of PURE_JS_DEPENDENCIES) {
    const depSource = path.join(REPO_ROOT, 'node_modules', depName)
    if (!fs.existsSync(depSource)) {
      throw new Error(
        `[after-pack] refusing to continue -- this checkout has no node_modules/${depName}, but the ` +
          `12.11.1 better-sqlite3 copy requires it at runtime (require('bindings') from lib/database.js). ` +
          'Run "pnpm install" from the repo root.',
      )
    }
    const depDest = path.join(unpackedDir, 'node_modules', depName)
    console.log(`[after-pack] copying ${depSource} -> ${depDest}`)
    copyRecursive(depSource, depDest)
  }

  console.log('[after-pack] done')
}
