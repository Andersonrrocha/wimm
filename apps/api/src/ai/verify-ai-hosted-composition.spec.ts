import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assertExcludesLocalOnlyProviders,
  computeReachability,
  HOSTED_ENTRY,
  LOCAL_ENTRY,
} from '../../scripts/verify-ai-hosted-composition'

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

describe('verify-ai-hosted-composition (real codebase)', () => {
  it('does not find any local-only module reachable from the real hosted composition root', () => {
    const { localOnlyFilesReached } = computeReachability(HOSTED_ENTRY)

    expect(localOnlyFilesReached).toEqual([])
  })

  it('assertExcludesLocalOnlyProviders does not throw for the real hosted composition root', () => {
    expect(() => assertExcludesLocalOnlyProviders()).not.toThrow()
  })

  it('DOES find the local-only provider reachable from the real local composition root (negative control)', () => {
    // Proves the check is not vacuous, and proves it in both directions at
    // once: the same detection this suite relies on for `app.module.ts`
    // genuinely fires for the root that really does import
    // `LocalOnlyAiModule` -- so a passing hosted assertion means the file is
    // excluded there, not that the marker matches nothing anywhere.
    const { localOnlyFilesReached } = computeReachability(LOCAL_ENTRY)

    const relativePaths = localOnlyFilesReached.map((file) => file.replace(process.cwd(), ''))
    expect(localOnlyFilesReached.length).toBeGreaterThan(0)
    expect(relativePaths.some((file) => file.includes('chatgpt-oauth-provider.ts'))).toBe(true)
    expect(relativePaths.some((file) => file.includes('local-only-ai.module'))).toBe(true)
  })
})

describe('computeReachability (isolated fixtures, independent of this repository\'s own source tree)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-ai-hosted-composition-fixture-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('walks transitive imports, not just the entry file\'s own direct imports', () => {
    // entry -> mid -> ai/local-only/deep : deep is reachable even though
    // entry never imports it directly, proving this is a real graph walk.
    writeFileSync(join(dir, 'entry.ts'), `import './mid'\nexport const entry = 1\n`)
    writeFileSync(join(dir, 'mid.ts'), `import './ai/local-only/deep'\nexport const mid = 1\n`)
    mkdirSync(join(dir, 'ai', 'local-only'), { recursive: true })
    writeFileSync(join(dir, 'ai', 'local-only', 'deep.ts'), `export const deep = 1\n`)
    const tsconfigPath = writeFixtureTsconfig(dir)

    const result = computeReachability(join(dir, 'entry.ts'), tsconfigPath, dir)

    expect(result.reachableFiles).toHaveLength(3)
    expect(result.localOnlyFilesReached).toEqual([join(dir, 'ai', 'local-only', 'deep.ts')])
  })

  it('finds nothing local-only when nothing reachable sits under ai/local-only/', () => {
    writeFileSync(join(dir, 'entry.ts'), `import './mid'\nexport const entry = 1\n`)
    writeFileSync(join(dir, 'mid.ts'), `export const mid = 1\n`)
    const tsconfigPath = writeFixtureTsconfig(dir)

    const result = computeReachability(join(dir, 'entry.ts'), tsconfigPath, dir)

    expect(result.reachableFiles).toHaveLength(2)
    expect(result.localOnlyFilesReached).toEqual([])
  })
})
