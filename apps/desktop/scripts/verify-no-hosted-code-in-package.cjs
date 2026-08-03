/**
 * Structural verification that the packaged `app.asar` ships no compiled
 * hosted-only AI provider module.
 *
 * **Why this exists, on top of `apps/api/scripts/verify-ai-local-composition.ts`.**
 * That script proves a *source-level* property: TypeScript's own module
 * resolution, rooted at `app.local.module.ts`, never reaches anything under
 * `src/ai/hosted/` -- see its own doc comment, in particular the "What this
 * proves, and what it does not" section, which names the exact gap this
 * module closes. `apps/api`'s `tsc` build compiles every file under `src/`
 * regardless of whether the local composition root imports it (`tsconfig.json`'s
 * `include` is a wildcard glob, not a reachability walk), so a hosted-only
 * file's compiled JavaScript sits in `apps/api/dist/ai/hosted/` either way.
 * `apps/desktop`'s own packaging previously shipped every file under
 * `node_modules/@wimm/api/dist/` wholesale (see `package.json`'s
 * `build.files`) -- the public/local desktop build therefore physically
 * contained `hosted-ai.module.js` and
 * `chatgpt-oauth-provider.stub.js`, dead code, never imported by anything the
 * local composition runs, but present and readable by anyone who opens the
 * `app.asar` archive. The owner's standing constraint (ChatGPT OAuth stays
 * only in the personally-hosted build) is about what the public build
 * *ships*, not just what it *runs* -- readable-but-dead is still a leak of
 * which hosted-only surface exists and how it is shaped.
 *
 * **The fix, and what this module proves about it.** `package.json`'s
 * `build.files` now excludes everything under `node_modules/@wimm/api/dist/ai/hosted/`
 * from the packaged tree entirely, the same technique already used to keep
 * `apps/api/src` and the Postgres migrations directory out of the bundle.
 * That exclusion runs inside `electron-builder`'s own file collection, before
 * `afterPack` ever sees the packed archive -- a configuration change that
 * "looks right" is not proof it took effect (this project has been burned by
 * exactly that kind of unverified assumption before). This module is the
 * proof: it reads the *actual, final, repacked* `app.asar` `after-pack.cjs`
 * produces and asserts no entry path contains the hosted-only marker.
 * `after-pack.cjs` calls `assertNoHostedOnlyCodeInPackage` as its last step,
 * exactly where it also calls `verifyDependencyGraph` -- both run against the
 * real repacked archive, both throw (failing the whole `package` script)
 * rather than log-and-continue.
 *
 * **The marker convention.** Identical to `verify-ai-local-composition.ts`'s
 * `HOSTED_ONLY_SEGMENT`: any path containing an `ai/hosted/` segment is
 * hosted-only by convention. Asar entry paths (from `@electron/asar`'s
 * `listPackage`) are always `/`-separated with a leading slash regardless of
 * host OS, so -- unlike the source-level check, which normalizes `path.sep`
 * for a Windows dev checkout -- this module never needs to translate
 * separators.
 *
 * **What this does not prove.** That the local composition's *source* never
 * reaches a hosted-only module -- that is `verify-ai-local-composition.ts`'s
 * job, run separately (`pnpm --filter @wimm/api run verify:ai-local-composition`),
 * not duplicated here. This module only proves the *shipped bytes* of one
 * specific packaged archive contain no hosted-only file, which is a claim
 * about the packaging pipeline, not about the TypeScript import graph.
 */
const asar = require('@electron/asar')

/**
 * Any packaged path containing this segment is hosted-only by convention --
 * see the module doc comment. Kept as a single exported constant so a future
 * hosted-only surface elsewhere in `@wimm/api` (or a second package) can be
 * covered by the same marker convention without inventing a new one.
 */
const HOSTED_ONLY_MARKER = '/ai/hosted/'

/**
 * Every entry in `asarPath` whose path contains `HOSTED_ONLY_MARKER`. Reads
 * the real archive via `@electron/asar`'s own `listPackage` -- the same
 * archive-reading primitive `verify-dependency-graph.cjs` already uses --
 * rather than re-deriving file lists from the pre-pack `files` glob, which
 * would only prove the *configuration* looks right, not that the actual
 * bytes on disk match it.
 */
function findHostedOnlyEntries(asarPath) {
  return asar.listPackage(asarPath).filter((entryPath) => entryPath.includes(HOSTED_ONLY_MARKER))
}

/**
 * Throws, naming every offending file, if `asarPath` contains any
 * hosted-only entry. This is the assertion this task's mutation proof breaks
 * on purpose: temporarily removing the `build.files` exclusion for
 * `node_modules/@wimm/api/dist/ai/hosted/**` and repackaging makes the
 * hosted-only compiled files reappear in the archive, and this throws,
 * naming them.
 */
function assertNoHostedOnlyCodeInPackage(asarPath) {
  const hostedOnlyEntries = findHostedOnlyEntries(asarPath)

  if (hostedOnlyEntries.length > 0) {
    throw new Error(
      `[verify-no-hosted-code-in-package] refusing to continue -- ${asarPath} contains ` +
        `${hostedOnlyEntries.length} compiled hosted-only AI provider file(s). The ChatGPT OAuth integration ` +
        'must exist only in the personally-hosted build, never the public/local one -- these files must be ' +
        "excluded from packaging (see apps/desktop/package.json's build.files):\n" +
        hostedOnlyEntries.map((entryPath) => `  - ${entryPath}`).join('\n'),
    )
  }
}

module.exports = {
  HOSTED_ONLY_MARKER,
  findHostedOnlyEntries,
  assertNoHostedOnlyCodeInPackage,
}
