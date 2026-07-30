/**
 * Structural verification (and, via the exports `after-pack.cjs` reuses for
 * restoration, the resolution engine that fix builds on top of) of the
 * packaged `node_modules` dependency graph.
 *
 * **Why this exists.** `electron-builder`'s pnpm-aware node-modules collector
 * has now silently resolved a package's own nested, version-conflicted
 * dependency to the *wrong physical instance* three separate times in this
 * repository's `node-linker=hoisted` workspace, each found only by a human
 * hitting the runtime symptom:
 *
 * 1. `@prisma/adapter-better-sqlite3`'s pinned `better-sqlite3@12.11.1` was
 *    replaced by the root workspace's portable `13.0.1` -> native binary
 *    unloadable (see `after-pack.cjs`'s doc comment).
 * 2. `express`'s pinned `path-to-regexp@~0.1.12` was replaced by
 *    `@nestjs/core`'s unrelated `3.3.0` -> `/api/*` stopped matching any real
 *    request path, so `ActiveProfileMiddleware` never ran (same file).
 * 3. `p-locate`'s pinned `p-limit@^2.2.0` was replaced by an unrelated,
 *    hoisted top-level `p-limit@3.1.0` (itself missing its own `yocto-queue`
 *    dependency entirely) -- see `after-pack.cjs`'s doc comment.
 *
 * Two of those are wrong-version substitutions; one is an outright missing
 * dependency. All three share one shape: *a package is present in the
 * packaged layout, but at least one of its own declared runtime dependencies
 * does not resolve correctly from where that package actually sits.*
 *
 * **How large the actual class turned out to be.** Running the check this
 * module implements against this task's own already-packaged (pre-fix)
 * output found not three but **twenty-two** such edges, across at least
 * eighteen distinct packages (`debug`, `lodash`, `type-fest`, `mkdirp`,
 * `mimic-fn`, `builder-util-runtime`, `consola`, `dotenv-expand`,
 * `postgres-array`, `@types/node`, `undici-types`, `@prisma/debug`,
 * `path-exists`, `p-try`, `yocto-queue`, plus the three above). Checked
 * directly against this checkout's own dev `node_modules`, every one of
 * those packages' dependents (`express`, `body-parser`, `finalhandler`,
 * `send`, `@nestjs/config`, `electron-store`, `multer`, `debounce-fn`,
 * `electron-updater`, `@prisma/adapter-pg`, `@anthropic-ai/sdk`,
 * `@nuxtjs/opencollective`, `find-up`, `pkg-up`, `p-locate`, ...) genuinely
 * *does* carry its own correct nested override in the real dev tree --
 * `pnpm`'s hoisting keeps them precisely because they conflict with whatever
 * got hoisted to the top. `electron-builder`'s collector drops nearly all of
 * them. `yocto-queue` was simply the one a human happened to hit first.
 *
 * This is why `after-pack.cjs` no longer hand-lists every individual
 * pure-JS package needing correction (as it once did for `bindings` and
 * `file-uri-to-path`): past the two packages that carry real native-module
 * complexity (`better-sqlite3`'s ABI/`asarUnpack` handling, kept as its own
 * targeted overlay) and `express`'s private `path-to-regexp` (also kept, no
 * native complexity but already a proven, specific fix), the rest is handled
 * by one general mechanism, `restorePlainDependencyOverrides` in
 * `after-pack.cjs`, built on the same `findDependencyGraphProblems` /
 * `resolveDependencyDir` primitives this module exports for the final check.
 * Continuing to hand-list packages one at a time, now that the true scope is
 * known, would be exactly the "losing game" this task's own brief warns
 * against.
 *
 * **What the exported `verifyDependencyGraph` checks.** For every
 * `package.json` at a genuine package boundary anywhere under a
 * `node_modules/` path in the packaged `app.asar` (including entries
 * `asarUnpack` redirects to the sibling `.unpacked` directory --
 * `@electron/asar`'s own `extractFile` follows that redirect transparently,
 * confirmed by reading `node_modules/@electron/asar/lib/disk.js`'s
 * `readFileSync`, so this module never needs to know or care which storage a
 * given file actually uses), and for every name in that package's own
 * `dependencies` field: resolve where a `require(name)` from that package's
 * own directory would actually land, using the same upward
 * `node_modules`-walk Node itself uses, and confirm (a) something exists
 * there at all, and (b) its `version` satisfies the range the dependent
 * declared.
 *
 * **"Genuine package boundary"** matters and is not a formality: a first,
 * naive version of this check (every path ending in `/package.json` under
 * `node_modules/`) also flagged `fast-uri/benchmark`'s own `package.json` --
 * a benchmarking sub-project `fast-uri` happens to ship inside its published
 * tarball, with its own unrelated `dependencies` (`tinybench`, `uri-js`)
 * that nothing ever `require()`s. A real installed package directory is
 * exactly `node_modules/<name>` or `node_modules/@scope/<name>` -- nothing
 * with a further path segment in between. `isPackageBoundary` below enforces
 * that shape structurally (not by naming `fast-uri` or `benchmark`
 * specifically, which would only ever catch the one instance already found).
 *
 * **What it deliberately does not check**, so a future maintainer does not
 * mistake silence for a guarantee:
 * - `devDependencies`, `peerDependencies`, `optionalDependencies` -- Node
 *   itself does not require any of these to be physically present next to a
 *   dependent, so "missing" is not necessarily wrong for them. This is also
 *   deliberately why `@napi-rs/canvas`'s platform-specific `optionalDependencies`
 *   (a known, already-flagged gap -- see the task report's concern #3) does
 *   not trip this check: those are optional by the packages' own contract.
 * - Install-time-only `dependencies` entries such as `prebuild-install`
 *   (declared by `better-sqlite3@12.x`'s own `package.json`, used only by its
 *   `install` lifecycle script to fetch a prebuilt binary -- never
 *   `require()`d by the package's own runtime code, confirmed by the
 *   exhaustive `bindings` search-candidate trace Task 4's Fix round 1
 *   captured verbatim). This module has no static way to distinguish
 *   "required at runtime" from "required by a lifecycle script" purely from
 *   the dependency graph's shape, so rather than guess, `after-pack.cjs`
 *   strips that one known, verified-safe entry from its own corrected
 *   `better-sqlite3` overlay's `package.json` before this check ever sees it
 *   -- a narrow, documented exception for a package this hook already
 *   controls by hand, not a general allowance.
 * - The *app's own* root `package.json` (`/package.json` at the asar root,
 *   i.e. `@wimm/desktop`'s manifest). Its `dependencies` field intentionally
 *   lists packages (`react`, `axios`, `date-fns`, ...) that are deliberately
 *   *excluded* from the packaged `node_modules` tree via the `files` globs in
 *   `apps/desktop/package.json` (Task 4's Fix round 2 -- they are inlined into
 *   `out/renderer` by Vite at build time and never `require()`d by
 *   `out/main`/`out/preload`). Checking the root manifest the same way as
 *   every other package would flag every one of those as "missing" -- a
 *   known-safe, already-verified design decision, not a defect.
 * - Whether a resolved dependency is *reachable* by any real code path at
 *   runtime. This check is structural, not a call-graph analysis: it flags a
 *   package whose own declared dependency doesn't resolve correctly
 *   regardless of whether anything currently exercises that require() call --
 *   which is exactly how bug #3 above was found (a real regression sitting in
 *   a fallback path `store.ts`'s happy path never took).
 * - It does not repair anything it finds. A build-time integrity check that
 *   notices a broken bundle and patches around it invites the same silent
 *   drift this module exists to stop; `verifyDependencyGraph` only reports,
 *   precisely, and throws. (The *separate* restoration in `after-pack.cjs`
 *   runs strictly before the repack, against dev's own real tree, not
 *   against findings from this check acting on the final artifact.)
 *
 * **On failure**, `verifyDependencyGraph` throws a single `Error` listing
 * every problem found (not just the first), each naming the dependent
 * package, the dependency name and declared range, and either "does not
 * resolve" or the wrong version and where it actually resolved to -- so a
 * maintainer can fix everything in one pass rather than rebuilding once per
 * discovery, which is the whole point.
 */
const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')
const semver = require('semver')

const PACKAGE_JSON_SUFFIX = '/package.json'
const NODE_MODULES_SEGMENT = '/node_modules/'

/**
 * Returns the containing directory's path (posix, leading-slash style for
 * the asar-rooted convention this module uses throughout: root is `''`), or
 * `null` once the root itself has been passed in -- i.e. there is nothing
 * further up to check.
 */
function parentDir(dir) {
  if (dir === '') return null
  const idx = dir.lastIndexOf('/')
  if (idx < 0) return null
  return dir.slice(0, idx)
}

/**
 * Whether `dir` (a package directory path like
 * `/node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3`)
 * sits at a genuine installed-package boundary: exactly `node_modules/<name>`
 * or `node_modules/@scope/<name>`, with no further path segment in between.
 * See the module doc comment's "Genuine package boundary" section for why
 * this exists (the `fast-uri/benchmark` false positive it excludes).
 */
function isPackageBoundary(dir) {
  const lastIdx = dir.lastIndexOf(NODE_MODULES_SEGMENT)
  if (lastIdx === -1) return false
  const tail = dir.slice(lastIdx + NODE_MODULES_SEGMENT.length)
  if (tail === '') return false
  const segments = tail.split('/')
  return tail.startsWith('@') ? segments.length === 2 : segments.length === 1
}

/**
 * Reads every `node_modules/.../package.json` at a genuine package boundary
 * out of the packaged archive (via `asar.listPackage`/`asar.extractFile`,
 * which transparently redirect to `app.asar.unpacked` for any entry
 * `asarUnpack` pulled out onto real disk -- see the module doc comment),
 * keyed by the package's own directory path (asar-style, leading slash).
 * Deliberately skips the asar root's own `/package.json` -- see "What it
 * deliberately does not check" above.
 */
function listNodeModulePackagesFromAsar(asarPath) {
  const allPaths = asar.listPackage(asarPath)
  const packages = new Map()

  for (const entryPath of allPaths) {
    if (!entryPath.endsWith(PACKAGE_JSON_SUFFIX)) continue
    if (!entryPath.includes(NODE_MODULES_SEGMENT)) continue

    const dir = entryPath.slice(0, -PACKAGE_JSON_SUFFIX.length)
    if (!isPackageBoundary(dir)) continue

    const relativePath = entryPath.replace(/^\//, '')
    let pkg
    try {
      const raw = asar.extractFile(asarPath, relativePath)
      pkg = JSON.parse(raw.toString('utf8'))
    } catch (err) {
      throw new Error(
        `[verify-dependency-graph] could not read and parse ${entryPath} out of ${asarPath}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
    }

    packages.set(dir, {
      name: typeof pkg.name === 'string' ? pkg.name : '(unnamed)',
      version: typeof pkg.version === 'string' ? pkg.version : '(unversioned)',
      dependencies: pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {},
    })
  }

  return packages
}

/**
 * Same shape as `listNodeModulePackagesFromAsar`, but walks a real directory
 * tree (used against both this checkout's own dev `node_modules` and the
 * `afterPack` hook's extracted, pre-repack temp tree). Only ever descends
 * into directories actually named `node_modules`, so -- unlike a naive
 * "every package.json under node_modules" scan -- it can never wander into a
 * bundled sub-project like `fast-uri/benchmark`; every registered entry is a
 * real package boundary by construction, not by pattern-matching.
 */
function listNodeModulePackagesFromDisk(rootDir) {
  const packages = new Map()
  walkNodeModulesDir(path.join(rootDir, 'node_modules'), '/node_modules', packages)
  return packages
}

function walkNodeModulesDir(realNodeModulesDir, relNodeModulesDir, packages) {
  let entries
  try {
    entries = fs.readdirSync(realNodeModulesDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name === '.bin') continue
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

    if (entry.name.startsWith('@')) {
      const scopeReal = path.join(realNodeModulesDir, entry.name)
      const scopeRel = `${relNodeModulesDir}/${entry.name}`
      let scopedEntries
      try {
        scopedEntries = fs.readdirSync(scopeReal, { withFileTypes: true })
      } catch {
        continue
      }
      for (const scoped of scopedEntries) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        registerPackageDir(path.join(scopeReal, scoped.name), `${scopeRel}/${scoped.name}`, packages)
      }
    } else {
      registerPackageDir(path.join(realNodeModulesDir, entry.name), `${relNodeModulesDir}/${entry.name}`, packages)
    }
  }
}

function registerPackageDir(realPackageDir, relPackageDir, packages) {
  const pkgJsonPath = path.join(realPackageDir, 'package.json')
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
      packages.set(relPackageDir, {
        name: typeof pkg.name === 'string' ? pkg.name : '(unnamed)',
        version: typeof pkg.version === 'string' ? pkg.version : '(unversioned)',
        dependencies: pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {},
      })
    } catch {
      // Unreadable/corrupt package.json -- not this walker's job to
      // validate; simply not registering it means anything depending on it
      // will honestly report "does not resolve".
    }
  }

  const nestedNodeModules = path.join(realPackageDir, 'node_modules')
  if (fs.existsSync(nestedNodeModules)) {
    walkNodeModulesDir(nestedNodeModules, `${relPackageDir}/node_modules`, packages)
  }
}

/**
 * Resolves `depName` as `require(depName)` would from a file inside
 * `fromDir`, using the same upward `node_modules`-walk Node's own resolver
 * uses: check `fromDir/node_modules/<depName>`, then repeat from each
 * ancestor directory up to the tree root. Returns the resolved package's
 * directory path, or `null` if nothing exists anywhere in the walk -- exactly
 * the situation that produced the `yocto-queue` bug.
 */
function resolveDependencyDir(packages, fromDir, depName) {
  let dir = fromDir
  while (dir !== null) {
    const candidate = `${dir}/node_modules/${depName}`
    if (packages.has(candidate)) return candidate
    dir = parentDir(dir)
  }
  return null
}

/**
 * Whether `resolvedVersion` satisfies `declaredRange`, tolerating the two
 * non-ordinary-semver specifiers this workspace actually uses:
 * - `workspace:*` (pnpm/npm workspace protocol, used by `@wimm/api`'s and
 *   `@wimm/desktop`'s own dependency on `@wimm/shared`/`@wimm/api`) -- always
 *   satisfied once something resolves at all; the workspace protocol has no
 *   independent version constraint of its own to check against.
 * - Anything else `semver.validRange` cannot parse (a git/url/tag specifier)
 *   -- existence-only, consistent with this check being proportionate rather
 *   than a full package-manager reimplementation (see the module doc
 *   comment's "What it deliberately does not check").
 */
function rangeIsSatisfied(declaredRange, resolvedVersion) {
  if (typeof declaredRange !== 'string') return true
  if (declaredRange.startsWith('workspace:')) return true
  if (!semver.validRange(declaredRange)) return true
  if (typeof resolvedVersion !== 'string' || !semver.valid(resolvedVersion)) return false
  return semver.satisfies(resolvedVersion, declaredRange, { includePrerelease: true })
}

/**
 * Pure function: given a `packages` map (either flavor above), returns every
 * dependency edge that is broken -- either unresolvable or resolved to a
 * version outside the declared range -- as structured objects, not strings,
 * so callers (the restoration pass in `after-pack.cjs`, and this module's own
 * `verifyDependencyGraph`) can both consume them.
 */
function findDependencyGraphProblems(packages) {
  const problems = []

  for (const [dir, info] of packages) {
    for (const [depName, declaredRange] of Object.entries(info.dependencies)) {
      const resolvedDir = resolveDependencyDir(packages, dir, depName)

      if (!resolvedDir) {
        problems.push({
          kind: 'unresolvable',
          dependentDir: dir,
          dependentName: info.name,
          dependentVersion: info.version,
          depName,
          declaredRange,
          resolvedDir: null,
          resolvedVersion: null,
        })
        continue
      }

      const resolved = packages.get(resolvedDir)
      if (!rangeIsSatisfied(declaredRange, resolved.version)) {
        problems.push({
          kind: 'version-mismatch',
          dependentDir: dir,
          dependentName: info.name,
          dependentVersion: info.version,
          depName,
          declaredRange,
          resolvedDir,
          resolvedVersion: resolved.version,
        })
      }
    }
  }

  return problems
}

function formatProblem(problem) {
  const base =
    `${problem.dependentName}@${problem.dependentVersion} (at ${problem.dependentDir}) depends on ` +
    `"${problem.depName}" (${JSON.stringify(problem.declaredRange)})`
  if (problem.kind === 'unresolvable') {
    return `${base}, which does not resolve to any package directory in the packaged layout.`
  }
  return (
    `${base}, but it resolves to ${problem.resolvedDir} at version ${JSON.stringify(problem.resolvedVersion)}, ` +
    `which does not satisfy ${JSON.stringify(problem.declaredRange)}.`
  )
}

/**
 * Walks every package in the packaged `app.asar` at `asarPath` and verifies
 * that every one of its own declared `dependencies` resolves to a real
 * package directory in the packaged layout, at a version satisfying the
 * declared range. Throws a single `Error` describing every problem found if
 * any exist; otherwise returns a small summary for logging.
 */
function verifyDependencyGraph(asarPath) {
  const packages = listNodeModulePackagesFromAsar(asarPath)
  const problems = findDependencyGraphProblems(packages)

  if (problems.length > 0) {
    throw new Error(
      `[verify-dependency-graph] the packaged dependency graph is broken -- ${problems.length} problem(s) found:\n` +
        problems.map((problem, i) => `  ${i + 1}. ${formatProblem(problem)}`).join('\n'),
    )
  }

  let edgesChecked = 0
  for (const info of packages.values()) edgesChecked += Object.keys(info.dependencies).length

  return { packagesChecked: packages.size, edgesChecked }
}

module.exports = {
  listNodeModulePackagesFromAsar,
  listNodeModulePackagesFromDisk,
  resolveDependencyDir,
  rangeIsSatisfied,
  findDependencyGraphProblems,
  formatProblem,
  verifyDependencyGraph,
}
