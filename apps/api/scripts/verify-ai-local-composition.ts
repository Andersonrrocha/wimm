/**
 * Build-level proof that the LOCAL composition root cannot reach a
 * hosted-only AI provider module.
 *
 * **Why this exists.** The owner's standing constraint is that ChatGPT
 * OAuth stays in the personally-hosted build only, never the public one --
 * and Stage 3 of the desktop completion program
 * (`docs/superpowers/plans/2026-08-03-desktop-completion-program.md`) is
 * explicit that this must be a *build-level* property, not a runtime
 * `if (mode === 'hosted')`: a runtime branch still compiles the hosted
 * provider's code into the public binary, where anyone can read it. The
 * point is that the code is not there at all.
 *
 * **What "not there" means here, precisely.** `apps/api`'s own `nest build`
 * compiles every file under `src/` regardless of whether anything imports
 * it (`tsconfig.json`'s `include` is a wildcard glob over the whole tree,
 * not a reachability walk) -- so the ordinary build alone proves nothing about
 * exclusion; a hosted-only file sits in `dist/` either way. What actually
 * determines whether a module could ever be *reached* from a given
 * composition root is TypeScript's own module-resolution graph starting
 * from that root's entry file -- the same graph a real bundler (Rollup,
 * esbuild, webpack) would tree-shake against. This script asks the real
 * TypeScript compiler for exactly that graph, rooted at
 * `app.local.module.ts`, and asserts a hosted-only file is not in it.
 *
 * **The marker convention.** Any file whose path contains an `ai/hosted/`
 * segment is, by convention, hosted-only -- see
 * `ai/hosted/chatgpt-oauth-provider.stub.ts` and `hosted-ai.module.ts`'s
 * doc comments, which this script's marker directly reflects. There is no
 * real ChatGPT OAuth provider in the tree yet (Stage 3 builds the seam, not
 * the provider); `ChatGptOauthProviderStub` is a realistic stand-in living
 * at that exact path, used both by this script's own test suite and by the
 * Stage 3 mutation proof to show the check actually fires.
 *
 * **What this proves, and what it does not.** This proves the *source-level*
 * import graph reachable from `app.local.module.ts` never reaches
 * `ai/hosted/`. It does NOT prove the packaged desktop app ships without
 * that file's compiled JS -- today `apps/api/dist` is a single, whole-project
 * build shared by both composition roots, so the hosted-only file's compiled
 * output is present in `dist/` (dead code, never imported by anything local
 * actually runs, but physically shipped) until the packaging pipeline itself
 * is split. That split is real work for Stage 4 (distribution), deferred
 * deliberately rather than built now against a stand-in with no real
 * hosted-only provider yet to design the packaging split against -- see the
 * Stage 3 report's "what is proven now vs. deferred" section.
 *
 * Run: `pnpm --filter @wimm/api run verify:ai-local-composition`
 */
import { dirname, join, relative, sep } from 'path'
import * as ts from 'typescript'

export const API_ROOT = join(__dirname, '..')
export const TSCONFIG_PATH = join(API_ROOT, 'tsconfig.json')
export const LOCAL_ENTRY = join(API_ROOT, 'src', 'app.local.module.ts')
export const HOSTED_ENTRY = join(API_ROOT, 'src', 'app.module.ts')

/** Any file under this segment is hosted-only by convention -- see the module doc comment. */
const HOSTED_ONLY_SEGMENT = `${sep}ai${sep}hosted${sep}`

/** Normalizes a path to always use `/` so the marker check is platform-independent. */
function toPosix(filePath: string): string {
  return filePath.split(sep).join('/')
}

function isHostedOnly(filePath: string): boolean {
  return toPosix(filePath).includes(toPosix(HOSTED_ONLY_SEGMENT))
}

export interface ReachabilityResult {
  /** Every `apps/api/src/**` file TypeScript's own module resolution reaches from `entryFile`, including `entryFile` itself. */
  reachableFiles: string[]
  /** The subset of `reachableFiles` that sit under a hosted-only marker path. */
  hostedOnlyFilesReached: string[]
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
 * `srcRoot` defaults to `apps/api/src` (this package's own source tree) --
 * overridable so `verify-ai-local-composition.spec.ts` can prove this
 * function's transitive-reachability behavior against small, isolated
 * fixture files instead of only ever exercising it through this repository's
 * own real module graph.
 */
export function computeReachability(
  entryFile: string = LOCAL_ENTRY,
  tsconfigPath: string = TSCONFIG_PATH,
  srcRoot: string = join(API_ROOT, 'src'),
): ReachabilityResult {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(
      `verify-ai-local-composition: could not read ${tsconfigPath}: ` +
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
    hostedOnlyFilesReached: reachableFiles.filter(isHostedOnly),
  }
}

/**
 * Throws, naming every offending file, if `entryFile`'s reachable graph
 * contains a hosted-only module. This is the assertion Task 3.2's mutation
 * proof breaks on purpose: registering a hosted-only module into
 * `app.local.module.ts`'s `imports` makes it reachable, and this throws.
 */
export function assertExcludesHostedOnlyProviders(
  entryFile: string = LOCAL_ENTRY,
  tsconfigPath: string = TSCONFIG_PATH,
): void {
  const { hostedOnlyFilesReached } = computeReachability(entryFile, tsconfigPath)

  if (hostedOnlyFilesReached.length > 0) {
    throw new Error(
      `[verify-ai-local-composition] the local composition root (${relative(API_ROOT, entryFile)}) ` +
        `reaches ${hostedOnlyFilesReached.length} hosted-only AI provider module(s), which must never ` +
        'compile into the local/public build:\n' +
        hostedOnlyFilesReached.map((file) => `  - ${relative(API_ROOT, file)}`).join('\n'),
    )
  }
}

function main(): number {
  try {
    assertExcludesHostedOnlyProviders()
  } catch (err) {
    console.error((err as Error).message)
    return 1
  }

  console.log(
    '[verify-ai-local-composition] OK -- app.local.module.ts does not reach any hosted-only AI provider module.',
  )
  return 0
}

if (require.main === module) {
  process.exit(main())
}
