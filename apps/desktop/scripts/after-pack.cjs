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
 *
 * **A second, independent instance of the same class of bug: `express`'s
 * private `path-to-regexp`.** Found in this task's fix round 3, via a
 * packaged-build regression the `better-sqlite3` fix above does not touch at
 * all. `express`'s own `package.json` pins `path-to-regexp` at `~0.1.12` --
 * deliberately the legacy 0.x line, which is the version whose bare `*`
 * wildcard token matches an arbitrary number of path segments (`/api/*`
 * matching `/api/users/me`). `@nestjs/core` separately depends on
 * `path-to-regexp@3.3.0` for its own, unrelated route-matching internals.
 * This checkout's real `node_modules` (see `REPO_ROOT`) correctly keeps both
 * versions side by side -- `node_modules/path-to-regexp` at `3.3.0` for
 * `@nestjs/core`, and a *nested* `node_modules/express/node_modules/path-to-regexp`
 * at `0.1.13` that `express`'s own `require('path-to-regexp')` resolves to
 * first (Node's module resolution always prefers the closest `node_modules`
 * up from the requiring file). `electron-builder`'s collector, exactly as it
 * did for the nested `better-sqlite3` above, resolves that nested slot to the
 * *wrong* physical copy: the packaged app's
 * `node_modules/express/node_modules/path-to-regexp` ends up holding a copy
 * of `3.3.0`, not `0.1.13` -- confirmed empirically by comparing the two
 * trees directly. `path-to-regexp@3.3.0` does not implement the legacy bare
 * `*` semantics at all (confirmed empirically: it compiles `/api/*` to a
 * regex that matches the *literal* string `/api/*`, never `/api/users/me`),
 * so every request in the packaged app silently fails to match the
 * `ActiveProfileMiddleware` Nest registers via `consumer.apply(...).forRoutes('*')`
 * (`ProfileModule.configure`, `apps/api/src/profile/profile.module.ts`) --
 * `req.user` is therefore never set, and every `@CurrentUser()`-decorated
 * route throws a bare, generic `UnauthorizedException()`
 * (`apps/api/src/common/decorators/current-user.decorator.ts`). That 401 has
 * the exact same JSON shape as `SessionTokenGuard`'s own 401, which is what
 * initially made this look like a session-token mismatch bug from the
 * renderer's side -- it is not; `SessionTokenGuard` itself was proven correct
 * by instrumentation (matching token, correct DI symbol identity, `canActivate`
 * returning `true`) before this was found. See `## Fix round 3` in this
 * task's report for the full isolation trail (a standalone repro booting
 * `AppLocalModule` directly from the packaged, extracted layout, bypassing
 * this app's own `local-api.ts` entirely) that pinned this down.
 *
 * The fix mirrors the `better-sqlite3` one exactly, and is simpler: no native
 * binary is involved, so nothing needs `asarUnpack` -- the corrected
 * `path-to-regexp` copy is overlaid into the same extracted tree the
 * `better-sqlite3` fix already extracts, and ships fully packed inside the
 * repacked `app.asar` like any other plain JS dependency.
 *
 * **A third instance, and the moment this stopped being a one-off-patch
 * problem.** `p-locate` (a transitive dependency of `electron-store` ->
 * `conf` -> `pkg-up`, used by `store.ts`'s `new Store()` when its fallback
 * package-root lookup runs -- which happens to not be exercised when the app
 * runs from its real installed path, only from one with no ancestor
 * `package.json`, e.g. `/Applications`) pins `p-limit` at `^2.2.0`; this
 * checkout's real nested copy is `2.3.0`. `electron-builder`'s collector
 * resolves that nested slot to an unrelated, hoisted top-level
 * `node_modules/p-limit` this workspace happens to also contain at `3.1.0`
 * (needed only by devDependencies -- `jest`, `electron-builder`'s own
 * `dir-compare`, `@expo/fingerprint` -- never shipped otherwise) -- and that
 * wrong copy is itself missing its own `yocto-queue` dependency entirely,
 * since `3.1.0`'s `require('yocto-queue')` was never a dependency the
 * *correct* (2.3.0) resolution needed in the first place.
 *
 * Investigating this one all the way to "what should the fix even overlay"
 * is what surfaced the real scope of the problem: running the structural
 * check `verify-dependency-graph.cjs` now provides (see that module's own
 * doc comment) against this task's own already-packaged output found not
 * three broken dependency edges but **twenty**, across at least seventeen
 * distinct packages -- `p-locate`/`p-limit` among them, but also `express`'s
 * and `body-parser`'s and `finalhandler`'s and `send`'s own private `debug`,
 * `@nestjs/config`'s own `lodash` and `dotenv-expand`, `electron-store`'s own
 * `type-fest`, `multer`'s own `mkdirp`, `pkg-up`'s *entire own private copy*
 * of the `find-up`/`locate-path`/`p-locate`/`p-limit`/`path-exists` chain
 * (distinct from, and older than, the top-level `find-up` this repo also
 * has), and several more. Every one of them is the identical shape: a
 * package present in the packaged output, with at least one of its own
 * declared `dependencies` silently resolved to the wrong physical copy (or
 * to nothing at all) by `electron-builder`'s collector, while this
 * checkout's own dev `node_modules` -- verified directly -- has the correct
 * nested override sitting right there the whole time.
 *
 * Hand-listing the fourth, fifth, ... twentieth of these one constant block
 * at a time (as `NESTED_RELATIVE_PATH` and `EXPRESS_PATH_TO_REGEXP_RELATIVE_PATH`
 * above do) is exactly the "losing game" this task's own brief warned
 * against. So, past this point, only the two fixes with genuine extra
 * complexity stay hand-written above: `better-sqlite3` (native-module ABI
 * and `asarUnpack` concerns no generic mechanism should paper over) and
 * `express`'s `path-to-regexp` (already a proven, specific fix, kept as-is
 * rather than churned for no functional gain). Every other plain-JS instance
 * of this same bug -- `p-locate`/`p-limit`/`yocto-queue` included -- is
 * corrected by one general mechanism, `restorePlainDependencyOverrides`
 * below: it re-derives, from this checkout's own real dev tree, exactly
 * which nested overrides the packaged tree is missing or has wrong, and
 * overlays only those, iterating until the packaged tree's own dependency
 * graph is self-consistent (correcting one wrong nested package can reveal
 * that *its* own dependency is also wrong or missing -- see that function's
 * doc comment for a concrete example). `verifyDependencyGraph`, run as the
 * very last step of this hook, is what proves the result is actually
 * correct rather than merely "didn't throw during the copy."
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
const {
  listNodeModulePackagesFromDisk,
  resolveDependencyDir,
  rangeIsSatisfied,
  findDependencyGraphProblems,
  verifyDependencyGraph,
} = require('./verify-dependency-graph.cjs')
const { assertLocalOnlyAiShipped } = require('./verify-local-only-ai-in-package.cjs')

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

/**
 * `express`'s own private `path-to-regexp` copy -- see this file's doc
 * comment's "A second, independent instance of the same class of bug"
 * section for the full explanation of why this nested path specifically
 * (not the top-level `node_modules/path-to-regexp`, which `@nestjs/core`
 * uses and which electron-builder collects correctly) needs correcting.
 */
const EXPRESS_PATH_TO_REGEXP_RELATIVE_PATH = path.join(
  'node_modules',
  'express',
  'node_modules',
  'path-to-regexp',
)
const EXPECTED_EXPRESS_PATH_TO_REGEXP_VERSION = '0.1.13'

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

/**
 * Deletes one entry from a package's own `dependencies` field, in the
 * *extracted-tree copy* only (never the dev checkout this hook reads from --
 * callers must pass a path under `extractTo`). Used for two narrowly-justified
 * cases -- see `INSTALL_ONLY_DEPENDENCIES_TO_STRIP` (install-lifecycle-only)
 * and `UNUSED_RUNTIME_DEPENDENCIES_TO_STRIP` (verified dead at runtime for
 * this app's actual usage) below, and `verify-dependency-graph.cjs`'s doc
 * comment ("What it deliberately does not check") for the full reasoning.
 * No-ops if the entry is already absent.
 */
function stripDependencyDeclaration(packageDir, depName) {
  const pkgJsonPath = path.join(packageDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  if (pkg.dependencies && depName in pkg.dependencies) {
    delete pkg.dependencies[depName]
    fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
    console.log(`[after-pack] stripped "${depName}" dependency declaration from ${pkgJsonPath}`)
  }
}

/**
 * `better-sqlite3@12.x`'s own `package.json` declares `prebuild-install` as a
 * regular (non-dev) `dependency` -- used only by its own `install` lifecycle
 * script to fetch a prebuilt binary, never `require()`d by the package's
 * runtime code (`lib/database.js`'s exhaustive `bindings` search-candidate
 * trace, captured verbatim in this task's Fix round 1, never mentions it).
 * Left in place, `verifyDependencyGraph` below would refuse to ship a build
 * that has never needed this package at runtime -- a false alarm on a
 * genuine limitation of treating `dependencies` as a pure runtime-requires
 * list (see that module's doc comment). Narrow and explicit on purpose: this
 * is not a general "ignore install-time tooling" allowance, just the one
 * instance this hook already controls by hand and has verified is safe.
 */
const INSTALL_ONLY_DEPENDENCIES_TO_STRIP = [{ relativeDir: NESTED_RELATIVE_PATH, depName: 'prebuild-install' }]

/**
 * `pdf-parse@2.4.5`'s own `package.json` declares `pdfjs-dist` and
 * `@napi-rs/canvas` as regular (non-optional) `dependencies`, but its actual
 * CJS entry point (`dist/pdf-parse/cjs/index.cjs`, what `require('pdf-parse')`
 * resolves to and the only file `extract-pdf-text.ts`'s `new PDFParse(...)`
 * ever loads) needs neither at runtime for the text-only extraction this
 * app's two PDF parsers (Banrisul, Cresol) perform:
 *
 * - `pdfjs-dist` is not `require()`d by that entry point at all -- confirmed
 *   directly by grepping the built bundle for the literal string
 *   `"pdfjs-dist"`: it appears only inside the bundled sourcemap and
 *   TypeScript's own erased `import type` declarations, never in the actual
 *   executable code. `pdf-parse`'s own build process bundles `pdfjs-dist`'s
 *   engine (`pdfjs-dist/legacy/build/pdf.mjs`) directly into its CJS output
 *   at build time, so the separate `pdfjs-dist` package in `node_modules` is
 *   dead weight for this dependent.
 * - `@napi-rs/canvas` is loaded through a dynamic, `try`/`catch`-wrapped
 *   `require()` used only to polyfill browser-only globals
 *   (`DOMMatrix`/`ImageData`) that `pdfjs-dist`'s canvas-rendering and
 *   image-extraction paths need -- confirmed by reading the built bundle's
 *   own source: the failure path logs a warning and continues, it does not
 *   throw. Neither of the two PDF parsers in this codebase calls
 *   `PDFParse#getImage`/`#getTable`/anything canvas-related -- only
 *   `#getText()` (`apps/api/src/imports/parsers/{banrisul-cc,cresol}/extract-*-pdf-text.ts`).
 *
 * Verified empirically, not assumed: with both `node_modules/pdfjs-dist` and
 * `node_modules/@napi-rs` physically removed from this checkout, `@wimm/api`'s
 * full test suite (67 suites / 592 tests, including every Banrisul and
 * Cresol PDF fixture) still passes unchanged -- see this task's report for
 * the exact commands and output. `package.json`'s `build.files` excludes
 * both packages (plus `pdf-parse`'s own unused `esm`/`web`/`worker` build
 * variants -- browser and ESM outputs this CJS-only `require()` never
 * touches, same empirical proof) from the packaged tree entirely; stripping
 * these two now-dangling `dependencies` entries here, before
 * `restorePlainDependencyOverrides` runs, is what keeps `verifyDependencyGraph`
 * from "fixing" the deliberate exclusion by copying both packages back in
 * from this checkout's own dev tree -- exactly the same reason
 * `prebuild-install` above must be stripped before that same restoration
 * pass. This is not a general "ignore whatever's inconvenient" allowance:
 * it is two specific, hand-verified entries for one specific package, same
 * narrow shape as `INSTALL_ONLY_DEPENDENCIES_TO_STRIP`.
 *
 * Confirmed empirically, not assumed: temporarily emptying this list and
 * repackaging still passed `verifyDependencyGraph` (317 packages, 382 edges,
 * all resolved) -- but only because `restorePlainDependencyOverrides` had
 * silently copied `pdfjs-dist` back in from this checkout's own dev tree to
 * satisfy `pdf-parse`'s otherwise-dangling declaration, growing the packaged
 * `.app` from 412 MB back to 447 MB. The structural check alone cannot tell
 * "deliberately excluded" apart from "accidentally missing" -- that
 * distinction is exactly what stripping the declaration here records.
 */
const PDF_PARSE_RELATIVE_PATH = path.join('node_modules', 'pdf-parse')
const UNUSED_RUNTIME_DEPENDENCIES_TO_STRIP = [
  { relativeDir: PDF_PARSE_RELATIVE_PATH, depName: 'pdfjs-dist' },
  { relativeDir: PDF_PARSE_RELATIVE_PATH, depName: '@napi-rs/canvas' },
]

const MAX_RESTORATION_PASSES = 10

/**
 * Restores every plain (no native binary involved) nested dependency
 * override that this checkout's own dev `node_modules` has, but the
 * extracted, packaged tree at `extractTo` is missing or has at the wrong
 * version -- see this file's own doc comment ("A third instance, and the
 * moment this stopped being a one-off-patch problem") for why a general
 * mechanism replaced hand-listing a fourth, fifth, ... constant.
 *
 * **Why this loops instead of applying one pass.** Correcting one wrong
 * nested package can reveal that *its own* dependency is also wrong or
 * missing, in the packaged tree specifically (not in dev, where it was
 * already fine). Concretely, hit while building this mechanism: the packaged
 * tree's `@anthropic-ai/sdk/node_modules/@types/node` was itself the wrong
 * (hoisted, too-new) instance; only *after* restoring the correct nested
 * `@types/node` from dev did that package's own `undici-types` dependency
 * (a different declared range than the wrong instance had) resolve
 * correctly against the tree's existing top-level copy. A single pass over a
 * snapshot taken before any fix would have missed this; re-scanning the
 * *packaged* tree fresh every iteration is what catches it.
 *
 * Each iteration: list the packaged tree's own current state, find every
 * broken dependency edge (`findDependencyGraphProblems`), and for each one,
 * check whether *this checkout's own dev tree* resolves the same
 * dependent-directory + dependency-name edge to something that actually
 * satisfies the declared range. If so, copy that dev directory into the
 * packaged tree at the identical relative path (recreating dev's own
 * resolved shape, not inventing a new one). Stops when a full pass finds no
 * more problems, or makes no further progress (whatever remains is not
 * something this checkout's own dev tree can answer -- left for
 * `verifyDependencyGraph`, run after the repack, to report and fail on
 * honestly rather than silently ignore).
 */
function restorePlainDependencyOverrides(extractTo) {
  const devPackages = listNodeModulePackagesFromDisk(REPO_ROOT)
  const restored = []

  for (let pass = 0; pass < MAX_RESTORATION_PASSES; pass++) {
    const packagedPackages = listNodeModulePackagesFromDisk(extractTo)
    const problems = findDependencyGraphProblems(packagedPackages)
    if (problems.length === 0) {
      console.log(`[after-pack] restorePlainDependencyOverrides: clean after ${pass} pass(es), ${restored.length} correction(s)`)
      return restored
    }

    let progressed = false
    for (const problem of problems) {
      const devResolvedDir = resolveDependencyDir(devPackages, problem.dependentDir, problem.depName)
      if (!devResolvedDir) continue
      const devInfo = devPackages.get(devResolvedDir)
      if (!rangeIsSatisfied(problem.declaredRange, devInfo.version)) continue

      const alreadyRestored = restored.some((r) => r.relativeDir === devResolvedDir)
      if (alreadyRestored) continue

      const src = path.join(REPO_ROOT, devResolvedDir)
      const dest = path.join(extractTo, devResolvedDir)
      console.log(
        `[after-pack] restorePlainDependencyOverrides: overlaying ${devResolvedDir} (${devInfo.version}) from dev ` +
          `-- fixes ${problem.dependentName}@${problem.dependentVersion}'s "${problem.depName}" ` +
          `(${JSON.stringify(problem.declaredRange)})`,
      )
      copyRecursive(src, dest)
      restored.push({ relativeDir: devResolvedDir, version: devInfo.version })
      progressed = true
    }

    if (!progressed) {
      console.log(
        `[after-pack] restorePlainDependencyOverrides: ${problems.length} problem(s) remain that this checkout's ` +
          'own dev tree cannot resolve -- leaving them for the final verifyDependencyGraph check to report.',
      )
      return restored
    }
  }

  console.log(
    `[after-pack] restorePlainDependencyOverrides: reached the ${MAX_RESTORATION_PASSES}-pass safety limit -- ` +
      'leaving any remainder for the final check.',
  )
  return restored
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

  const expressPathToRegexpSourceDir = path.join(REPO_ROOT, EXPRESS_PATH_TO_REGEXP_RELATIVE_PATH)
  const expressPathToRegexpSourceVersion = readVersion(expressPathToRegexpSourceDir)
  if (expressPathToRegexpSourceVersion !== EXPECTED_EXPRESS_PATH_TO_REGEXP_VERSION) {
    throw new Error(
      `[after-pack] refusing to continue -- this checkout's own ${EXPRESS_PATH_TO_REGEXP_RELATIVE_PATH} reports ` +
        `version ${JSON.stringify(expressPathToRegexpSourceVersion)}, expected ` +
        `${JSON.stringify(EXPECTED_EXPRESS_PATH_TO_REGEXP_VERSION)}. Run "pnpm install" from the repo root -- ` +
        "express's own package.json pins this at ~0.1.12.",
    )
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

  // Correct express's own private path-to-regexp copy -- see this file's doc
  // comment. Pure JS, no native binary, so nothing here needs asarUnpack;
  // it simply overlays into the same extracted tree before the repack below.
  const destExpressPathToRegexpDir = path.join(extractTo, EXPRESS_PATH_TO_REGEXP_RELATIVE_PATH)
  console.log(`[after-pack] replacing ${destExpressPathToRegexpDir}`)
  console.log(
    `[after-pack]   with ${expressPathToRegexpSourceDir} (version ${expressPathToRegexpSourceVersion})`,
  )
  copyRecursive(expressPathToRegexpSourceDir, destExpressPathToRegexpDir)

  // Strip prebuild-install (install-lifecycle-only, never required at
  // runtime) from the corrected better-sqlite3 copy's own package.json --
  // see INSTALL_ONLY_DEPENDENCIES_TO_STRIP's doc comment. Must happen before
  // restorePlainDependencyOverrides below, or that mechanism would otherwise
  // faithfully "fix" this by pulling in prebuild-install's entire real
  // install-time dependency tree (tar-fs, node-abi, pump, rc, ... -- verified
  // empirically while building this mechanism: omitting this step first
  // pulled in 53 packages instead of the ~27 plain overrides actually
  // needed).
  for (const { relativeDir, depName } of INSTALL_ONLY_DEPENDENCIES_TO_STRIP) {
    stripDependencyDeclaration(path.join(extractTo, relativeDir), depName)
  }

  // Strip pdf-parse's now-dangling pdfjs-dist/@napi-rs/canvas dependency
  // declarations -- see UNUSED_RUNTIME_DEPENDENCIES_TO_STRIP's doc comment.
  // Must happen before restorePlainDependencyOverrides below for the exact
  // same reason as the prebuild-install strip above: that mechanism would
  // otherwise "fix" the deliberate `build.files` exclusion of both packages
  // by copying them straight back in from this checkout's own dev tree,
  // undoing the whole point of excluding them.
  for (const { relativeDir, depName } of UNUSED_RUNTIME_DEPENDENCIES_TO_STRIP) {
    stripDependencyDeclaration(path.join(extractTo, relativeDir), depName)
  }

  // Restore every other plain nested dependency override this checkout's dev
  // tree has but the packaged tree is missing or has wrong -- see
  // restorePlainDependencyOverrides's own doc comment. This is what actually
  // fixes the p-locate/p-limit/yocto-queue bug (and everything else the
  // structural check below would otherwise catch).
  restorePlainDependencyOverrides(extractTo)

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

  // `asar.extractAll(asarPath, ...)` above already read and cached this
  // archive's header once, keyed by `asarPath` (`@electron/asar`'s
  // `disk.readFilesystemSync` caches by path to avoid re-reading a header on
  // every call). `asarPath` now points at a brand new file with a different
  // byte layout -- without invalidating that cache, a later read through the
  // asar library at the same path (the express/path-to-regexp verification
  // below) would resolve file offsets against the *old* header against the
  // *new* file's bytes, silently returning garbage from an unrelated offset
  // instead of throwing "not found". Confirmed empirically: omitting this
  // produced exactly that -- a "not valid JSON" error reading what turned out
  // to be a fragment of an unrelated bundled file, not a missing-file error.
  asar.uncache(asarPath)

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

  // express's own path-to-regexp stays packed (no native binary, nothing to
  // unpack) -- verify by reading straight out of the repacked archive itself
  // rather than app.asar.unpacked, which has no entry for it at all.
  const expressPathToRegexpPackageJsonEntry = [
    ...EXPRESS_PATH_TO_REGEXP_RELATIVE_PATH.split(path.sep),
    'package.json',
  ].join('/')
  let expressPathToRegexpDestVersion
  try {
    const raw = asar.extractFile(asarPath, expressPathToRegexpPackageJsonEntry)
    expressPathToRegexpDestVersion = JSON.parse(raw.toString('utf8')).version
  } catch (err) {
    throw new Error(
      `[after-pack] repack verification failed -- could not read ${expressPathToRegexpPackageJsonEntry} back out ` +
        `of the repacked ${asarPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (expressPathToRegexpDestVersion !== EXPECTED_EXPRESS_PATH_TO_REGEXP_VERSION) {
    throw new Error(
      `[after-pack] repack verification failed -- ${EXPRESS_PATH_TO_REGEXP_RELATIVE_PATH} inside the repacked ` +
        `app.asar now reports version ${JSON.stringify(expressPathToRegexpDestVersion)}, expected ` +
        `${JSON.stringify(EXPECTED_EXPRESS_PATH_TO_REGEXP_VERSION)}.`,
    )
  }

  // Final, general structural check -- see verify-dependency-graph.cjs's own
  // doc comment for exactly what this validates and what it deliberately
  // does not. Runs last, against the real repacked archive, after every
  // targeted and general overlay above: this is what catches anything none
  // of those specifically knew to fix, and -- unlike the two checks above --
  // it must throw and fail this whole `package` script on any real problem,
  // not just log one. A packaging step that notices a broken dependency
  // graph and ships it anyway is worse than not checking at all.
  const graphSummary = verifyDependencyGraph(asarPath)
  console.log(
    `[after-pack] verifyDependencyGraph: OK -- ${graphSummary.packagesChecked} package(s), ` +
      `${graphSummary.edgesChecked} declared dependency edge(s), all resolved and in range.`,
  )

  // Second structural check, same "throw on any real problem" contract --
  // see verify-local-only-ai-in-package.cjs's own doc comment. Proves the
  // *shipped bytes* of this specific repacked archive DO contain the compiled
  // local-only AI provider: ChatGPT plan usage is licensed for exactly this
  // build (free, open-source, run on the user's own machine), so a packaging
  // glob that quietly stopped matching would ship an app whose AI
  // categorization silently does not work. The complementary source-level
  // proof -- that the *hosted* root's import graph never reaches that code,
  // since a remotely hosted app needs OpenAI's waitlist -- lives in
  // apps/api/scripts/verify-ai-hosted-composition.ts.
  assertLocalOnlyAiShipped(asarPath)
  console.log('[after-pack] assertLocalOnlyAiShipped: OK -- the compiled local-only AI provider is in the archive.')

  console.log('[after-pack] done')
}
