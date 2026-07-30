/**
 * Dependency-graph resolution engine shared by `after-pack.cjs`.
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
 * **How large the actual class turned out to be.** Walking this checkout's
 * own already-packaged (pre-fix) output with the resolution engine below
 * found not three but **twenty** such broken edges, across at least
 * seventeen distinct packages (`debug`, `lodash`, `type-fest`, `mkdirp`,
 * `mimic-fn`, `builder-util-runtime`, `consola`, `dotenv-expand`,
 * `postgres-array`, `@types/node`, `p-try`, `yocto-queue`, plus `p-locate`
 * itself and `pkg-up`'s *entire own private copy* of the
 * `find-up`/`locate-path`/`p-locate`/`p-limit`/`path-exists` chain). Checked
 * directly against this checkout's own dev `node_modules`, every one of
 * those packages' dependents genuinely *does* carry its own correct nested
 * override in the real dev tree -- `pnpm`'s hoisting keeps them precisely
 * because they conflict with whatever got hoisted to the top.
 * `electron-builder`'s collector drops nearly all of them. `yocto-queue` was
 * simply the one a human happened to hit first.
 *
 * This is why `after-pack.cjs`'s `restorePlainDependencyOverrides` no longer
 * hand-lists every individual pure-JS package needing correction (as it once
 * did for `bindings` and `file-uri-to-path`): past the two packages that
 * carry real native-module complexity (`better-sqlite3`'s ABI/`asarUnpack`
 * handling, kept as its own targeted overlay) and `express`'s private
 * `path-to-regexp` (also kept, no native complexity but already a proven,
 * specific fix), the rest is handled by one general mechanism built on the
 * primitives this module exports: it re-derives, from this checkout's own
 * real dev tree, exactly which nested overrides the packaged tree is missing
 * or has wrong, and overlays only those. Continuing to hand-list packages one
 * at a time, now that the true scope is known, would be exactly the "losing
 * game" this task's own brief warns against.
 *
 * **What this module provides.**
 * - `listNodeModulePackagesFromDisk(rootDir)`: walks a real directory tree
 *   (this checkout's own dev `node_modules`, or `after-pack.cjs`'s extracted,
 *   pre-repack temp tree) and returns every package it finds, keyed by
 *   directory path, with its declared `dependencies`. Only ever descends
 *   into directories actually named `node_modules`, so it can never wander
 *   into a bundled sub-project inside some package's own tarball (a real
 *   false positive an earlier, naive "every package.json under node_modules"
 *   version of this scan hit: `fast-uri/benchmark`'s own `package.json`, an
 *   unrelated benchmarking script `fast-uri` ships with its own
 *   `dependencies` that nothing ever `require()`s).
 * - `resolveDependencyDir(packages, fromDir, depName)`: resolves `depName` as
 *   `require(depName)` would from a file inside `fromDir`, using the same
 *   upward `node_modules`-walk Node's own resolver uses.
 * - `rangeIsSatisfied(declaredRange, resolvedVersion)`: whether a resolved
 *   version satisfies a declared range, tolerating the `workspace:*` protocol
 *   (`@wimm/api`'s and `@wimm/desktop`'s own dependency on `@wimm/shared`) and
 *   any other non-ordinary-semver specifier (existence-only, since this is a
 *   build-time integrity aid, not a package-manager reimplementation).
 * - `findDependencyGraphProblems(packages)`: pure function returning every
 *   broken dependency edge in a `packages` map as structured objects (not
 *   strings), so callers can both report and act on them.
 */
const fs = require('fs')
const path = require('path')
const semver = require('semver')

/**
 * Returns the containing directory's path (posix, leading-slash style for
 * the convention this module uses throughout: root is `''`), or `null` once
 * the root itself has been passed in -- i.e. there is nothing further up to
 * check.
 */
function parentDir(dir) {
  if (dir === '') return null
  const idx = dir.lastIndexOf('/')
  if (idx < 0) return null
  return dir.slice(0, idx)
}

/**
 * Walks a real directory tree (used against both this checkout's own dev
 * `node_modules` and `after-pack.cjs`'s extracted, pre-repack temp tree).
 * Only ever descends into directories actually named `node_modules`, so
 * every registered entry is a real package boundary by construction, not by
 * pattern-matching.
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
 *   -- existence-only, consistent with this being proportionate rather than
 *   a full package-manager reimplementation.
 */
function rangeIsSatisfied(declaredRange, resolvedVersion) {
  if (typeof declaredRange !== 'string') return true
  if (declaredRange.startsWith('workspace:')) return true
  if (!semver.validRange(declaredRange)) return true
  if (typeof resolvedVersion !== 'string' || !semver.valid(resolvedVersion)) return false
  return semver.satisfies(resolvedVersion, declaredRange, { includePrerelease: true })
}

/**
 * Pure function: given a `packages` map, returns every dependency edge that
 * is broken -- either unresolvable or resolved to a version outside the
 * declared range -- as structured objects, not strings, so callers (the
 * restoration pass in `after-pack.cjs`) can act on them.
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

module.exports = {
  listNodeModulePackagesFromDisk,
  resolveDependencyDir,
  rangeIsSatisfied,
  findDependencyGraphProblems,
}
