/**
 * Build-level proof that the packaged desktop app **does** ship the
 * local-only AI provider module.
 *
 * **This assertion was inverted on 2026-10-02, and the direction is a
 * licensing fact.** It used to assert the opposite -- that no
 * `ai/hosted/` file reached the archive -- because the owner's standing rule
 * was that the ChatGPT integration belonged to his personally-hosted build
 * alone. OpenAI's DevDay 2026 terms resolved that the other way round:
 * "ChatGPT plan usage" is offered to open-source projects and personal
 * projects that run locally, while a paid or remotely hosted app must join a
 * waitlist. This desktop build is free, open-source and runs on the user's
 * own machine, so it is precisely the eligible one. The exclusion is gone
 * from `build.files`, and what needs guarding is the opposite failure.
 *
 * **Why a presence check earns its place.** This project's packaging has
 * repeatedly dropped things silently: `electron-builder`'s collector
 * substituted the wrong `better-sqlite3`, substituted `path-to-regexp` into
 * `express`'s own nested tree, and omitted `yocto-queue` entirely --
 * twenty broken dependency edges across seventeen packages in one build. A
 * `files` glob or an `asarUnpack` rule that quietly stops matching would
 * ship an app whose AI categorization simply does not work, with nothing
 * failing at build time. That is the failure this guards.
 *
 * **Why read the archive and not the config.** `asar.listPackage` reads the
 * real bytes on disk -- the same primitive `verify-dependency-graph.cjs`
 * uses. Re-deriving file lists from the pre-pack `files` glob would only
 * prove the *configuration* looks right, which is the mistake this project
 * has been bitten by before.
 *
 * **What this proves, and what it does not.** It proves the compiled
 * local-only provider is present in this specific archive. It says nothing
 * about whether the hosted composition can reach that code -- that is
 * `apps/api/scripts/verify-ai-hosted-composition.ts`'s job, at the source
 * import-graph level.
 *
 * `after-pack.cjs` calls `assertLocalOnlyAiShipped` as its last step.
 */
const asar = require('@electron/asar')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Any packaged path containing this segment is local-only by convention.
 * Kept as a single exported constant so a future local-only surface
 * elsewhere in `@wimm/api` (or a second package) is covered by the same
 * marker without inventing a new one.
 */
const LOCAL_ONLY_MARKER = '/ai/local-only/'

/**
 * Where the compiled modules this guard expects to find come from: the
 * `@wimm/api` build output that packaging is supposed to copy into the
 * archive.
 *
 * Derived rather than hard-coded. A frozen list of eleven module names would
 * be a second place to update every time a local-only module is added, and
 * the failure mode of forgetting is silent -- the new module could be
 * dropped from the archive and this guard would still pass, which is the
 * class of bug it exists to prevent.
 */
const BUILT_LOCAL_ONLY_DIR = path.join(__dirname, '..', '..', 'api', 'dist', 'ai', 'local-only')

/**
 * Every entry in `asarPath` whose path contains `LOCAL_ONLY_MARKER`, read
 * from the real archive rather than from packaging configuration.
 */
function findLocalOnlyEntries(asarPath, listPackage = asar.listPackage) {
  return listPackage(asarPath).filter((entryPath) => entryPath.includes(LOCAL_ONLY_MARKER))
}

/**
 * The compiled module filenames the archive must carry, read from
 * `BUILT_LOCAL_ONLY_DIR`.
 *
 * Source maps and declaration files are excluded: they are build artefacts
 * whose absence breaks no runtime behaviour, and requiring them would make
 * this guard fail for a correct archive built with `sourceMap: false`.
 */
function readExpectedModules(dir = BUILT_LOCAL_ONLY_DIR) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort()
}

/**
 * Throws unless `asarPath` ships every compiled local-only AI module.
 *
 * **Why every module and not merely one.** This check used to pass as long
 * as the filtered list was non-empty. That closed the total-exclusion case
 * -- a restored `build.files` exclusion makes the files vanish wholesale --
 * and left a partial drop invisible: ten of eleven modules missing still
 * printed OK, and `electron-builder`'s collector has dropped individual
 * files in this project before (it omitted `yocto-queue` entirely, and
 * substituted `path-to-regexp` into `express`'s own nested tree). A module
 * missing from `node_modules/@wimm/api/dist/ai/local-only/` fails at
 * `require` time inside the packaged app, long after the build reported
 * success, and the user sees AI categorization that silently does nothing.
 *
 * The two failures are reported separately on purpose: an empty archive
 * list points at `build.files` and at whether `@wimm/api` was built, while a
 * partial list points at the collector and names the modules that went
 * missing. Collapsing them would send a reader to the wrong place.
 *
 * `listPackage` and `expectedModules` are injectable for the same reason the
 * rest of this feature injects its edges: the real ones read the filesystem,
 * and the spec needs to drive both sides without producing an archive.
 */
function assertLocalOnlyAiShipped(
  asarPath,
  { listPackage = asar.listPackage, expectedModules = readExpectedModules } = {},
) {
  const localOnlyEntries = findLocalOnlyEntries(asarPath, listPackage)

  if (localOnlyEntries.length === 0) {
    throw new Error(
      `[verify-local-only-ai-in-package] refusing to continue -- ${asarPath} ships no compiled ` +
        'local-only AI provider file. ChatGPT plan usage is licensed for exactly this build (free, ' +
        'open-source, running on the user\'s own machine), so stripping it would ship an app whose AI ' +
        'categorization silently does not work. Check that build.files does not exclude ' +
        'node_modules/@wimm/api/dist/ai/local-only/, and that @wimm/api was built before packaging.',
    )
  }

  const expected = expectedModules()

  // A guard that derives what to look for cannot prove anything when the
  // reference itself is empty -- it would report OK for any archive at all.
  // That is the same vacuous pass this function was rewritten to close, one
  // level up, so it gets its own refusal rather than being folded into the
  // check above.
  if (expected.length === 0) {
    throw new Error(
      '[verify-local-only-ai-in-package] refusing to continue -- found no compiled modules in ' +
        `${BUILT_LOCAL_ONLY_DIR} to check the archive against, so this guard can prove nothing. ` +
        'Build @wimm/api before packaging.',
    )
  }

  const missing = expected.filter(
    (name) => !localOnlyEntries.some((entryPath) => entryPath.endsWith(`${LOCAL_ONLY_MARKER}${name}`)),
  )

  if (missing.length > 0) {
    throw new Error(
      `[verify-local-only-ai-in-package] refusing to continue -- ${asarPath} is missing ` +
        `${missing.length} of ${expected.length} compiled local-only AI modules: ` +
        `${missing.join(', ')}. The archive carries some of them, so build.files is matching; ` +
        "this is electron-builder's file collector dropping individual files, which it has done " +
        'in this project before. Each missing module fails at require time inside the packaged ' +
        'app, after the build reports success.',
    )
  }
}

module.exports = {
  LOCAL_ONLY_MARKER,
  BUILT_LOCAL_ONLY_DIR,
  findLocalOnlyEntries,
  readExpectedModules,
  assertLocalOnlyAiShipped,
}
