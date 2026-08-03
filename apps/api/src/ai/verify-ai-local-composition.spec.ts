import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assertExcludesHostedOnlyProviders,
  computeReachability,
  HOSTED_ENTRY,
  LOCAL_ENTRY,
} from '../../scripts/verify-ai-local-composition'

/**
 * Minimal `tsconfig.json` for the isolated fixture tests below -- no
 * decorator metadata, no path aliases, nothing this repository's own
 * `tsconfig.json` needs that a two-file fixture does not.
 */
function writeFixtureTsconfig(dir: string): string {
  const tsconfigPath = join(dir, 'tsconfig.json')
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        module: 'commonjs',
        target: 'es2021',
        strict: false,
        skipLibCheck: true,
      },
    }),
  )
  return tsconfigPath
}

describe('verify-ai-local-composition (real codebase)', () => {
  it('does not find any hosted-only module reachable from the real local composition root', () => {
    const { hostedOnlyFilesReached } = computeReachability(LOCAL_ENTRY)

    expect(hostedOnlyFilesReached).toEqual([])
  })

  it('assertExcludesHostedOnlyProviders does not throw for the real local composition root', () => {
    expect(() => assertExcludesHostedOnlyProviders()).not.toThrow()
  })

  it('DOES find the hosted-only stub reachable from the real hosted composition root (negative control)', () => {
    // Proves the check is not vacuous: the exact same detection this suite
    // relies on for `app.local.module.ts` genuinely fires for a root that
    // really does import `HostedAiModule` (`app.module.ts`).
    const { hostedOnlyFilesReached } = computeReachability(HOSTED_ENTRY)

    const relativePaths = hostedOnlyFilesReached.map((file) => file.replace(process.cwd(), ''))
    expect(hostedOnlyFilesReached.length).toBeGreaterThan(0)
    expect(relativePaths.some((file) => file.includes('chatgpt-oauth-provider.stub'))).toBe(true)
    expect(relativePaths.some((file) => file.includes('hosted-ai.module'))).toBe(true)
  })
})

describe('computeReachability (isolated fixtures, independent of this repository\'s own source tree)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-ai-local-composition-fixture-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('walks transitive imports, not just the entry file\'s own direct imports', () => {
    // entry -> mid -> ai/hosted/deep : deep is reachable even though entry
    // never imports it directly, proving this is a real graph walk.
    writeFileSync(join(dir, 'entry.ts'), `import './mid'\nexport const entry = 1\n`)
    writeFileSync(join(dir, 'mid.ts'), `import './ai/hosted/deep'\nexport const mid = 1\n`)
    mkdirSync(join(dir, 'ai', 'hosted'), { recursive: true })
    writeFileSync(join(dir, 'ai', 'hosted', 'deep.ts'), `export const deep = 1\n`)
    const tsconfigPath = writeFixtureTsconfig(dir)

    const result = computeReachability(join(dir, 'entry.ts'), tsconfigPath, dir)

    expect(result.reachableFiles).toHaveLength(3)
    expect(result.hostedOnlyFilesReached).toEqual([join(dir, 'ai', 'hosted', 'deep.ts')])
  })

  it('finds nothing hosted-only when nothing reachable sits under ai/hosted/', () => {
    writeFileSync(join(dir, 'entry.ts'), `import './mid'\nexport const entry = 1\n`)
    writeFileSync(join(dir, 'mid.ts'), `export const mid = 1\n`)
    const tsconfigPath = writeFixtureTsconfig(dir)

    const result = computeReachability(join(dir, 'entry.ts'), tsconfigPath, dir)

    expect(result.reachableFiles).toHaveLength(2)
    expect(result.hostedOnlyFilesReached).toEqual([])
  })
})
