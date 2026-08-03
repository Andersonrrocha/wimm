import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  buildForTarget,
  type BuildFn,
  type NativeAbiPaths,
  needsShellForNpx,
  readNativeAbiMarker,
  resolveNativeAbiPaths,
  selectNativeAbiAt,
} from './select-native-abi'

jest.mock('child_process')
const mockedExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>

/**
 * These tests never touch this repo's real node_modules or run a real
 * compile: `selectNativeAbiAt` takes an explicit `NativeAbiPaths` and an
 * injectable `build` function, precisely so this can be verified against a
 * throwaway directory instead. The exported `selectNativeAbi` (fixed to this
 * repo's real paths and the real rebuild commands) is the thin, effectively
 * untestable wrapper around this.
 */
describe('selectNativeAbiAt', () => {
  let repoRoot: string
  let paths: NativeAbiPaths

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'wimm-select-native-abi-'))
    paths = resolveNativeAbiPaths(repoRoot)
    mkdirSync(dirname(paths.liveBinary), { recursive: true })
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  function fakeBuild(content: string): BuildFn {
    return (p) => {
      mkdirSync(dirname(p.liveBinary), { recursive: true })
      writeFileSync(p.liveBinary, content)
    }
  }

  it('builds when the cache is empty, then copies the result into place and writes the marker', () => {
    const build = jest.fn(fakeBuild('node-binary-v1'))

    selectNativeAbiAt(paths, 'node', build)

    expect(build).toHaveBeenCalledTimes(1)
    expect(readFileSync(paths.liveBinary, 'utf8')).toBe('node-binary-v1')
    expect(readFileSync(join(paths.cacheDir, 'node', 'better_sqlite3.node'), 'utf8')).toBe('node-binary-v1')
    expect(readNativeAbiMarker(paths)?.target).toBe('node')
  })

  it('does not rebuild on a second selection of the same target that is already active', () => {
    const build = jest.fn(fakeBuild('node-binary-v1'))
    selectNativeAbiAt(paths, 'node', build)

    build.mockClear()
    selectNativeAbiAt(paths, 'node', build)

    expect(build).not.toHaveBeenCalled()
  })

  it('does not rewrite the marker file on a true no-op re-selection', () => {
    const build = jest.fn(fakeBuild('node-binary-v1'))
    selectNativeAbiAt(paths, 'node', build)
    const markerAfterFirst = readFileSync(paths.markerFile, 'utf8')

    selectNativeAbiAt(paths, 'node', build)

    expect(readFileSync(paths.markerFile, 'utf8')).toBe(markerAfterFirst)
  })

  it('switches between two already-cached targets with a copy, not a rebuild', () => {
    const buildNode = jest.fn(fakeBuild('node-binary'))
    const buildElectron = jest.fn(fakeBuild('electron-binary'))

    selectNativeAbiAt(paths, 'node', buildNode)
    selectNativeAbiAt(paths, 'electron', buildElectron)
    expect(readFileSync(paths.liveBinary, 'utf8')).toBe('electron-binary')
    expect(readNativeAbiMarker(paths)?.target).toBe('electron')

    buildNode.mockClear()
    buildElectron.mockClear()
    selectNativeAbiAt(paths, 'node', buildNode)

    expect(buildNode).not.toHaveBeenCalled()
    expect(readFileSync(paths.liveBinary, 'utf8')).toBe('node-binary')
    expect(readNativeAbiMarker(paths)?.target).toBe('node')
  })

  it('builds again if the live binary was selected before but the cache for the other target is still missing', () => {
    const buildNode = jest.fn(fakeBuild('node-binary'))
    selectNativeAbiAt(paths, 'node', buildNode)

    const buildElectron = jest.fn(fakeBuild('electron-binary'))
    selectNativeAbiAt(paths, 'electron', buildElectron)

    expect(buildElectron).toHaveBeenCalledTimes(1)
  })

  it('propagates a build failure without writing a marker or touching the cache', () => {
    const failingBuild: BuildFn = () => {
      throw new Error('rebuild for target failed: no compiler found')
    }

    expect(() => selectNativeAbiAt(paths, 'node', failingBuild)).toThrow(/rebuild for target failed/)
    expect(readNativeAbiMarker(paths)).toBeUndefined()
  })

  it('treats a build that reports success but produces no binary as a failure', () => {
    // Simulates the exact "lied about what it touched" hazard this script's
    // doc comment calls out: a build step that returns normally but never
    // actually produced (or changed) the artifact.
    const noOpBuild: BuildFn = () => {
      /* pretends to succeed without writing anything */
    }

    expect(() => selectNativeAbiAt(paths, 'node', noOpBuild)).toThrow()
    expect(readNativeAbiMarker(paths)).toBeUndefined()
  })
})

/**
 * `buildForTarget` is the piece that actually shells out and is where the
 * "never trust the rebuild tool's own summary" safety net lives -- see the
 * module doc comment for the observed `@electron/rebuild` failure mode this
 * guards against. `child_process` is mocked so no real compiler ever runs.
 */
describe('buildForTarget', () => {
  let repoRoot: string
  let paths: NativeAbiPaths

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'wimm-select-native-abi-build-'))
    paths = resolveNativeAbiPaths(repoRoot)
    mkdirSync(dirname(paths.liveBinary), { recursive: true })
    mockedExecFileSync.mockReset()
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('runs "npx node-gyp rebuild" inside the adapter directory for the node target', () => {
    mockedExecFileSync.mockImplementation(() => {
      writeFileSync(paths.liveBinary, 'freshly-built')
      return Buffer.from('')
    })

    buildForTarget(paths, 'node')

    expect(mockedExecFileSync).toHaveBeenCalledWith('npx', ['node-gyp', 'rebuild'], {
      cwd: paths.adapterDir,
      stdio: 'inherit',
      // Windows needs a shell to reach `npx.cmd` at all; every other platform
      // must not get one, since a shell is pure added surface there. See
      // `runNpx` in select-native-abi.ts.
      shell: process.platform === 'win32',
    })
  })

  it('runs the exact documented @electron/rebuild command, using the installed Electron version', () => {
    mkdirSync(join(paths.repoRoot, 'node_modules', 'electron'), { recursive: true })
    writeFileSync(
      join(paths.repoRoot, 'node_modules', 'electron', 'package.json'),
      JSON.stringify({ version: '43.2.0' }),
    )
    mockedExecFileSync.mockImplementation(() => {
      writeFileSync(paths.liveBinary, 'freshly-built-electron')
      return Buffer.from('')
    })

    buildForTarget(paths, 'electron')

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['@electron/rebuild', '-v', '43.2.0', '-m', 'apps/api', '-o', 'better-sqlite3', '-f'],
      { cwd: paths.repoRoot, stdio: 'inherit', shell: process.platform === 'win32' },
    )
  })

  it('refuses to cache a build that reports success but leaves the binary unchanged', () => {
    writeFileSync(paths.liveBinary, 'stale-binary')
    mockedExecFileSync.mockImplementation(() => Buffer.from('')) // touches nothing

    expect(() => buildForTarget(paths, 'node')).toThrow(/did not change/)
  })

  it('refuses to cache a build that reports success but produces no binary at all', () => {
    mockedExecFileSync.mockImplementation(() => Buffer.from('')) // never writes liveBinary

    expect(() => buildForTarget(paths, 'node')).toThrow(/does not exist/)
  })

  it('fails with a clear message when the electron target cannot find an installed Electron version', () => {
    // No node_modules/electron/package.json seeded.
    expect(() => buildForTarget(paths, 'electron')).toThrow(/cannot determine the installed Electron version/)
    expect(mockedExecFileSync).not.toHaveBeenCalled()
  })
})

describe('needsShellForNpx', () => {
  /**
   * Pinned as a rule rather than by repeating `process.platform === 'win32'`
   * in the assertion. A spec that mirrors the implementation's own expression
   * agrees with it on whatever machine happens to run, so it would pass even
   * if the rule were inverted -- which is exactly what happened when this was
   * first written on macOS.
   */
  it('asks for a shell on Windows, where npx is npx.cmd and execFileSync cannot run a .cmd', () => {
    expect(needsShellForNpx('win32')).toBe(true)
  })

  it('does not ask for a shell anywhere else, since a shell is pure added surface there', () => {
    expect(needsShellForNpx('darwin')).toBe(false)
    expect(needsShellForNpx('linux')).toBe(false)
  })
})
