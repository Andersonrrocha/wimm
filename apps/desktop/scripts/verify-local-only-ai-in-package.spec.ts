/**
 * Tests for the packaging presence guard.
 *
 * This file is why `jest.config.js` now includes `<rootDir>/scripts` in its
 * roots. The guard had no test for its whole life, and that is not
 * incidental: `apps/desktop/scripts/` was covered by no harness in the repo
 * -- the root `jest.config.js` is scoped to `<rootDir>/scripts` at the
 * repository root, and this package's config reached only `src/main` and
 * `src/renderer/lib`. A guard nothing tests is how its blind spot survived
 * eleven modules' worth of growth: it passed on any non-empty list, so ten
 * of eleven modules could go missing and it printed OK.
 *
 * Neither the archive nor the build output is produced here. Both edges are
 * injected, which is what lets the partial-drop case be stated directly --
 * the alternative, packaging a real app to test the packaging check, is a
 * minutes-long build per assertion.
 */
const {
  LOCAL_ONLY_MARKER,
  findLocalOnlyEntries,
  assertLocalOnlyAiShipped,
  readExpectedModules,
} = require('./verify-local-only-ai-in-package.cjs')

const ASAR = '/fake/app.asar'
const PREFIX = `node_modules/@wimm/api/dist${LOCAL_ONLY_MARKER}`

/** Three stand-ins for the eleven real modules; the count is irrelevant. */
const MODULES = ['chatgpt-oidc.js', 'chatgpt.controller.js', 'local-only-ai.module.js']

const listing = (names: string[]) => () => [
  'package.json',
  'node_modules/@wimm/api/dist/main.js',
  ...names.map((name) => `${PREFIX}${name}`),
]

describe('findLocalOnlyEntries', () => {
  it('keeps only the paths under the local-only marker', () => {
    const entries = findLocalOnlyEntries(ASAR, listing(MODULES))
    expect(entries).toEqual(MODULES.map((name) => `${PREFIX}${name}`))
  })
})

describe('assertLocalOnlyAiShipped', () => {
  it('passes when every expected module is in the archive', () => {
    expect(() =>
      assertLocalOnlyAiShipped(ASAR, {
        listPackage: listing(MODULES),
        expectedModules: () => MODULES,
      }),
    ).not.toThrow()
  })

  // The case the old guard missed entirely: the archive carries some
  // local-only files, so a non-emptiness check is satisfied, while a module
  // that fails at require time inside the shipped app is absent.
  it('refuses a partial drop and names the modules that went missing', () => {
    expect(() =>
      assertLocalOnlyAiShipped(ASAR, {
        listPackage: listing(['chatgpt-oidc.js']),
        expectedModules: () => MODULES,
      }),
    ).toThrow(/missing 2 of 3 .*chatgpt\.controller\.js, local-only-ai\.module\.js/s)
  })

  it('points at build.files when the archive carries no local-only file at all', () => {
    expect(() =>
      assertLocalOnlyAiShipped(ASAR, {
        listPackage: listing([]),
        expectedModules: () => MODULES,
      }),
    ).toThrow(/ships no compiled local-only AI provider file/)
  })

  // A derived reference set makes the guard honest about additions, and
  // creates one new way for it to prove nothing: an empty reference matches
  // every archive. It must refuse rather than report OK.
  it('refuses when it has no reference to check against', () => {
    expect(() =>
      assertLocalOnlyAiShipped(ASAR, {
        listPackage: listing(MODULES),
        expectedModules: () => [],
      }),
    ).toThrow(/can prove nothing/)
  })

  it('does not accept a module whose name merely appears inside another path', () => {
    expect(() =>
      assertLocalOnlyAiShipped(ASAR, {
        listPackage: () => [`${PREFIX}vendored/chatgpt-oidc.js.map`],
        expectedModules: () => ['chatgpt-oidc.js'],
      }),
    ).toThrow(/missing 1 of 1/)
  })
})

describe('readExpectedModules', () => {
  // Pinned against the real build output rather than a fixture: the point of
  // deriving the set is that it tracks what @wimm/api actually compiled.
  it('reads the compiled modules and excludes source maps and declarations', () => {
    const names = readExpectedModules()
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((name: string) => name.endsWith('.js'))).toBe(true)
    expect(names).toContain('local-only-ai.module.js')
    expect(names.some((name: string) => name.endsWith('.d.ts') || name.endsWith('.map'))).toBe(false)
  })
})
