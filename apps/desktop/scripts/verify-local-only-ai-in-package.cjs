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

/**
 * Any packaged path containing this segment is local-only by convention.
 * Kept as a single exported constant so a future local-only surface
 * elsewhere in `@wimm/api` (or a second package) is covered by the same
 * marker without inventing a new one.
 */
const LOCAL_ONLY_MARKER = '/ai/local-only/'

/**
 * Every entry in `asarPath` whose path contains `LOCAL_ONLY_MARKER`, read
 * from the real archive rather than from packaging configuration.
 */
function findLocalOnlyEntries(asarPath) {
  return asar.listPackage(asarPath).filter((entryPath) => entryPath.includes(LOCAL_ONLY_MARKER))
}

/**
 * Throws if `asarPath` ships no local-only AI provider file at all. The
 * mutation proof for this breaks it on purpose by restoring a
 * `"!node_modules/@wimm/api/dist/ai/local-only/**\/*"` exclusion to
 * `build.files` and repackaging: the files vanish from the archive and this
 * throws.
 */
function assertLocalOnlyAiShipped(asarPath) {
  const localOnlyEntries = findLocalOnlyEntries(asarPath)

  if (localOnlyEntries.length === 0) {
    throw new Error(
      `[verify-local-only-ai-in-package] refusing to continue -- ${asarPath} ships no compiled ` +
        'local-only AI provider file. ChatGPT plan usage is licensed for exactly this build (free, ' +
        'open-source, running on the user\'s own machine), so stripping it would ship an app whose AI ' +
        'categorization silently does not work. Check that build.files does not exclude ' +
        'node_modules/@wimm/api/dist/ai/local-only/, and that @wimm/api was built before packaging.',
    )
  }
}

module.exports = {
  LOCAL_ONLY_MARKER,
  findLocalOnlyEntries,
  assertLocalOnlyAiShipped,
}
