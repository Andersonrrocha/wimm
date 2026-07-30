import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { assertLocalNativeAbiSelected, assertNativeAbiSelectedAt } from './native-abi-guard'

/**
 * The guard's real entry point (`assertLocalNativeAbiSelected`) reads real
 * files at fixed, repo-relative paths rather than anything injectable --
 * that is the whole point, it has to agree with `scripts/select-native-abi.ts`
 * and with the actual packaged/dev-checkout distinction without importing
 * either. `assertNativeAbiSelectedAt(repoRoot)` exists so these tests can
 * drive the exact same logic against a disposable temp directory instead of
 * this repo's own `pnpm-workspace.yaml` and `.cache/native-abi/marker.json`
 * -- safe, fast, and leaves nothing behind, including on a mid-test crash
 * (a `try`/`finally`-guarded rename of this repo's real workspace file was
 * considered and rejected for exactly that risk).
 *
 * This is the guard's whole reason to exist: it fires in rare states (a
 * forgotten swap, an interrupted build, a stale checkout, a packaged app
 * with no marker at all) that an ordinary `pnpm test` run never exercises,
 * because `pretest` fixes the ABI before jest even starts -- see
 * task-4a-3-report.md's mutation-proof section for how the guard is proven
 * against the real suite with `pretest` bypassed. These tests are what runs
 * on every ordinary `pnpm test`, so they assert on message *content* (the
 * mismatch named, which file, the exact fix command), not merely that a
 * throw happened -- a guard that throws something unhelpful defeats its own
 * purpose just as surely as one that doesn't throw at all.
 */

let hadElectron: boolean
let originalElectron: string | undefined

beforeEach(() => {
  hadElectron = 'electron' in process.versions
  originalElectron = process.versions.electron
})

afterEach(() => {
  if (hadElectron) {
    Object.defineProperty(process.versions, 'electron', { value: originalElectron, configurable: true })
  } else {
    delete (process.versions as { electron?: string }).electron
  }
})

function setRuntime(runtime: 'node' | 'electron'): void {
  if (runtime === 'electron') {
    Object.defineProperty(process.versions, 'electron', { value: '43.2.0', configurable: true })
  } else {
    delete (process.versions as { electron?: string }).electron
  }
}

function markerPathIn(repoRoot: string): string {
  return join(repoRoot, '.cache', 'native-abi', 'marker.json')
}

function writeMarkerIn(repoRoot: string, contents: string): void {
  const file = markerPathIn(repoRoot)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

/** A temp dir that looks like a real checkout of this monorepo: has `pnpm-workspace.yaml`. */
function makeDevCheckoutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wimm-native-abi-guard-dev-'))
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n')
  return dir
}

/** A temp dir that looks like a packaged app's resources: no `pnpm-workspace.yaml`, nothing at all. */
function makePackagedAppDir(): string {
  return mkdtempSync(join(tmpdir(), 'wimm-native-abi-guard-packaged-'))
}

function thrownBy(fn: () => void): Error | undefined {
  try {
    fn()
    return undefined
  } catch (err) {
    return err as Error
  }
}

describe('assertNativeAbiSelectedAt -- development checkout', () => {
  let dir: string

  beforeEach(() => {
    dir = makeDevCheckoutDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not throw when the marker matches the current runtime (node)', () => {
    setRuntime('node')
    writeMarkerIn(dir, JSON.stringify({ target: 'node' }))
    expect(() => assertNativeAbiSelectedAt(dir)).not.toThrow()
  })

  it('does not throw when the marker matches the current runtime (electron)', () => {
    setRuntime('electron')
    writeMarkerIn(dir, JSON.stringify({ target: 'electron' }))
    expect(() => assertNativeAbiSelectedAt(dir)).not.toThrow()
  })

  it('names the mismatch and the exact fix command when the marker says "electron" but the runtime is node', () => {
    setRuntime('node')
    writeMarkerIn(dir, JSON.stringify({ target: 'electron' }))

    const thrown = thrownBy(() => assertNativeAbiSelectedAt(dir))

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/marker.*says "electron"/i)
    expect(thrown!.message).toMatch(/running under "node"/i)
    expect(thrown!.message).toContain(markerPathIn(dir))
    // Names the exact, copy-pasteable command to fix it, for the runtime
    // actually in use (node) -- not the stale marker value (electron).
    expect(thrown!.message).toContain('npx tsx scripts/select-native-abi.ts node')
  })

  it('names the mismatch and the exact fix command when the marker says "node" but the runtime is electron (the reverse direction)', () => {
    setRuntime('electron')
    writeMarkerIn(dir, JSON.stringify({ target: 'node' }))

    const thrown = thrownBy(() => assertNativeAbiSelectedAt(dir))

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/marker.*says "node"/i)
    expect(thrown!.message).toMatch(/running under "electron"/i)
    expect(thrown!.message).toContain('npx tsx scripts/select-native-abi.ts electron')
  })

  it('refuses, naming the file and the fix command, when the marker is missing entirely', () => {
    setRuntime('node')
    // No marker written at all -- `dir/.cache` doesn't even exist yet.

    const thrown = thrownBy(() => assertNativeAbiSelectedAt(dir))

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/no native ABI marker found/i)
    expect(thrown!.message).toContain(markerPathIn(dir))
    expect(thrown!.message).toContain('npx tsx scripts/select-native-abi.ts node')
  })

  it('reports a corrupt (malformed JSON) marker distinctly from a missing one', () => {
    setRuntime('node')
    writeMarkerIn(dir, 'not json{{{')

    const thrown = thrownBy(() => assertNativeAbiSelectedAt(dir))

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/corrupt/i)
    expect(thrown!.message).toMatch(/not valid JSON/i)
    // The whole point of Finding B: this must NOT read like "never selected".
    expect(thrown!.message).not.toMatch(/no native ABI marker found/i)
    expect(thrown!.message).toContain(markerPathIn(dir))
    expect(thrown!.message).toContain('npx tsx scripts/select-native-abi.ts node')
  })

  it('reports a corrupt (unreadable) marker distinctly from both missing and malformed-JSON', () => {
    setRuntime('node')
    // existsSync() is true for a directory too, so this exercises the read
    // failure path (readFileSync throwing EISDIR) distinctly from "file
    // absent" and from "file present but not valid JSON".
    mkdirSync(markerPathIn(dir), { recursive: true })

    const thrown = thrownBy(() => assertNativeAbiSelectedAt(dir))

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/could not be read/i)
    expect(thrown!.message).not.toMatch(/no native ABI marker found/i)
    expect(thrown!.message).not.toMatch(/not valid JSON/i)
    expect(thrown!.message).toContain(markerPathIn(dir))
  })

  it('reports a corrupt (unrecognized target value) marker distinctly from a missing one', () => {
    setRuntime('node')
    writeMarkerIn(dir, JSON.stringify({ target: 'bogus' }))

    const thrown = thrownBy(() => assertNativeAbiSelectedAt(dir))

    expect(thrown).toBeDefined()
    expect(thrown!.message).toMatch(/corrupt/i)
    expect(thrown!.message).toContain('"bogus"')
    expect(thrown!.message).not.toMatch(/no native ABI marker found/i)
  })
})

describe('assertNativeAbiSelectedAt -- packaged app (no development checkout layout)', () => {
  let dir: string

  beforeEach(() => {
    dir = makePackagedAppDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is inert with no marker file at all, under the electron runtime a real packaged app would run under', () => {
    setRuntime('electron')
    // No pnpm-workspace.yaml, no .cache/, no marker -- exactly a packaged
    // app's resources directory. A real packaged app has this shape
    // precisely because electron-builder's `files` allowlist
    // (apps/desktop/package.json) ships only `out/**/*` and `package.json`.
    expect(() => assertNativeAbiSelectedAt(dir)).not.toThrow()
  })

  it('stays inert even with a mismatched marker present -- proves this is structural, not an accidental pass', () => {
    setRuntime('node')
    writeMarkerIn(dir, JSON.stringify({ target: 'electron' }))
    // If this dir were treated as a development checkout, this exact
    // marker/runtime combination would throw (see the mismatch test above).
    // It must not, because `dir` does not look like a checkout at all.
    expect(() => assertNativeAbiSelectedAt(dir)).not.toThrow()
  })

  it('stays inert even with a corrupt marker present', () => {
    setRuntime('electron')
    writeMarkerIn(dir, 'not json{{{')
    expect(() => assertNativeAbiSelectedAt(dir)).not.toThrow()
  })
})

describe('assertLocalNativeAbiSelected -- real entry point, this checkout', () => {
  it('does not throw against this checkout\'s own marker, kept in sync by pretest before this suite ran', () => {
    // No setup, no mutation: this is a sanity check that the real,
    // non-injectable REPO_ROOT this file computes from its own __dirname
    // actually resolves to this repo's root (finding pnpm-workspace.yaml
    // and the real .cache/native-abi/marker.json `apps/api`'s `pretest`
    // wrote), not a throwaway or parametrized one.
    expect(() => assertLocalNativeAbiSelected()).not.toThrow()
  })
})
