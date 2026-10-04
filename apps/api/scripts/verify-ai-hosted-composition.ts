/**
 * Build-level proof that the HOSTED composition root cannot reach a
 * local-only AI provider module.
 *
 * **Why this exists, and why it points this way.** OpenAI's "ChatGPT plan
 * usage" -- letting an end user spend their own ChatGPT Plus/Pro allowance
 * inside a third-party app -- is offered to "open-source projects, personal
 * projects that run locally, and selected private apps". A paid or
 * *remotely hosted* app has to join a waitlist first. WIMM's public desktop
 * build is free, open-source and runs entirely on the user's own machine, so
 * it is the eligible one; the owner's personal instance on his VPS is the
 * remotely hosted case. So the provider belongs to the LOCAL composition and
 * must stay out of the hosted one.
 *
 * **This invariant was inverted on 2026-10-02, and the direction is a
 * licensing fact, not an architectural preference.** Until then this script
 * asserted the opposite -- that the *local* root could not reach
 * `ai/hosted/` -- because the owner's standing rule was that ChatGPT OAuth
 * stayed in his hosted build only, on the assumption that using a
 * subscription inside a distributed app was the ambiguous case. OpenAI's
 * DevDay 2026 terms resolved that ambiguity the other way round. If the
 * owner later joins the waitlist and is approved for his hosted instance,
 * this check stops being required -- and should then be removed by decision,
 * not left to rot. Whoever does that: the mechanism below is sound and
 * reusable; only the policy changed.
 *
 * **Why build-level and not a runtime flag.** A runtime
 * `if (mode === 'local')` still compiles the provider into the hosted
 * binary. The point is that the code is not reachable there at all.
 *
 * **What "not reachable" means here, precisely.** `apps/api`'s own
 * `nest build` compiles every file under `src/` whether or not anything
 * imports it (`tsconfig.json`'s `include` is a wildcard glob, not a
 * reachability walk), so the ordinary build proves nothing about exclusion.
 * What determines whether a module could ever be *reached* from a given
 * composition root is TypeScript's own module-resolution graph starting at
 * that root's entry file -- the same graph a bundler would tree-shake
 * against. This script asks the real compiler for exactly that graph, rooted
 * at `app.module.ts`, and asserts no local-only file is in it.
 *
 * **The marker convention.** Any file whose path contains an
 * `ai/local-only/` segment is local-only by convention. The directory name
 * states the invariant rather than naming a build, deliberately: the
 * previous name (`ai/hosted/`) encoded a *policy assumption* about which
 * build owned the code, and that is precisely what turned out to be wrong.
 * The real ChatGPT plan-usage provider (`ChatGptOAuthProvider`) sits at
 * that path, and this script's own suite uses it, via `app.local.module.ts`,
 * as the negative control that shows the check actually fires.
 *
 * **What this proves, and what it does not.** This proves the source-level
 * import graph reachable from `app.module.ts` never reaches
 * `ai/local-only/`. It does NOT prove the hosted deployment ships without
 * that file's compiled JS: `apps/api/dist` is still one whole-project build
 * shared by both roots, so the local-only file's output sits in `dist/`
 * either way -- dead and unreachable, but present. For the hosted side that
 * is a weaker concern than it was for the public desktop build: what the
 * licensing terms turn on is whether a remotely hosted app *offers* plan
 * usage, which the import graph governs, not whether unreachable bytes exist
 * on the owner's own server. The desktop package does enforce the byte-level
 * version of this (see `apps/desktop/scripts/after-pack.cjs`), and that
 * assertion was inverted alongside this one.
 *
 * Run: `pnpm --filter @wimm/api run verify:ai-hosted-composition`
 */
import { dirname, join, relative, sep } from 'path'
import * as ts from 'typescript'

export const API_ROOT = join(__dirname, '..')
export const TSCONFIG_PATH = join(API_ROOT, 'tsconfig.json')
export const LOCAL_ENTRY = join(API_ROOT, 'src', 'app.local.module.ts')
export const HOSTED_ENTRY = join(API_ROOT, 'src', 'app.module.ts')

/** Any file under this segment is local-only by convention -- see the module doc comment. */
const LOCAL_ONLY_SEGMENT = `${sep}ai${sep}local-only${sep}`

/** Normalizes a path to always use `/` so the marker check is platform-independent. */
function toPosix(filePath: string): string {
  return filePath.split(sep).join('/')
}

function isLocalOnly(filePath: string): boolean {
  return toPosix(filePath).includes(toPosix(LOCAL_ONLY_SEGMENT))
}

export interface ReachabilityResult {
  /** Every `apps/api/src/**` file TypeScript's own module resolution reaches from `entryFile`, including `entryFile` itself. */
  reachableFiles: string[]
  /** The subset of `reachableFiles` that sit under a local-only marker path. */
  localOnlyFilesReached: string[]
}

/**
 * Computes the real, compiler-resolved set of `srcRoot`'s own files
 * reachable from `entryFile`, using `tsconfigPath` for every resolution
 * setting (`baseUrl`, `paths`, `module`, ...) so this matches exactly what
 * the real build would resolve -- just rooted at one file instead of
 * globbing every file under `srcRoot`.
 *
 * Node's own `lib.*.d.ts` files and anything under `node_modules` are
 * excluded from `reachableFiles`: this check is about which of the
 * project's *own* modules a composition root can reach, not about the
 * ambient type-checking environment.
 *
 * `srcRoot` defaults to `apps/api/src` -- overridable so the spec can prove
 * this function's transitive-reachability behavior against small, isolated
 * fixture files instead of only ever exercising it through this
 * repository's own real module graph.
 */
export function computeReachability(
  entryFile: string = HOSTED_ENTRY,
  tsconfigPath: string = TSCONFIG_PATH,
  srcRoot: string = join(API_ROOT, 'src'),
): ReachabilityResult {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(
      `verify-ai-hosted-composition: could not read ${tsconfigPath}: ` +
        ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'),
    )
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsconfigPath))

  const program = ts.createProgram({
    rootNames: [entryFile],
    options: { ...parsed.options, noEmit: true },
  })

  const normalizedSrcRoot = toPosix(srcRoot) + '/'
  const reachableFiles = program
    .getSourceFiles()
    .map((sourceFile) => sourceFile.fileName)
    .filter((fileName) => toPosix(fileName).startsWith(normalizedSrcRoot))
    .sort()

  return {
    reachableFiles,
    localOnlyFilesReached: reachableFiles.filter(isLocalOnly),
  }
}

/**
 * Throws, naming every offending file, if `entryFile`'s reachable graph
 * contains a local-only module. This is the assertion the mutation proof
 * breaks on purpose: registering a local-only module into
 * `app.module.ts`'s `imports` makes it reachable, and this throws.
 */
export function assertExcludesLocalOnlyProviders(
  entryFile: string = HOSTED_ENTRY,
  tsconfigPath: string = TSCONFIG_PATH,
): void {
  const { localOnlyFilesReached } = computeReachability(entryFile, tsconfigPath)

  if (localOnlyFilesReached.length > 0) {
    throw new Error(
      `[verify-ai-hosted-composition] the hosted composition root (${relative(API_ROOT, entryFile)}) ` +
        `reaches ${localOnlyFilesReached.length} local-only AI provider module(s), which must never ` +
        'compile into the remotely-hosted build:\n' +
        localOnlyFilesReached.map((file) => `  - ${relative(API_ROOT, file)}`).join('\n'),
    )
  }
}

function main(): number {
  try {
    assertExcludesLocalOnlyProviders()
  } catch (err) {
    console.error((err as Error).message)
    return 1
  }

  console.log(
    '[verify-ai-hosted-composition] OK -- app.module.ts does not reach any local-only AI provider module.',
  )
  return 0
}

if (require.main === module) {
  process.exit(main())
}
