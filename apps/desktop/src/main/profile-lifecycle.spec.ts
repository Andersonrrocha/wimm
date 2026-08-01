/**
 * TDD for `decideProfileSituation` -- the pure function this task's plan
 * calls out as "the part that can silently do the wrong thing" (see the
 * module doc comment in `profile-lifecycle.ts`). Every case here is
 * expressed as a plain `ProfileListResult` value, with no filesystem
 * involved at all: the whole point of separating this from
 * `resolveProfileSituation` is that the zero/one/several/corrupt decision
 * can be proven correct without ever touching disk.
 *
 * `resolveProfileSituation` and `validateProfileName` get their own
 * `describe` blocks below, against a real temp directory and
 * `profile-registry.ts` respectively, since they are not pure.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProfile } from '@wimm/api/dist/prisma/local/profile-registry'

import {
  decideProfileSituation,
  InvalidProfileNameError,
  PROFILE_NAME_MAX_LENGTH,
  resolveProfileSituation,
  validateProfileName,
  type ProfileListResult,
} from './profile-lifecycle'

function profile(id: string, overrides: Partial<{ name: string; lastOpenedAt: string | null }> = {}) {
  return {
    id,
    name: overrides.name ?? `Profile ${id}`,
    dbFileName: `${id}.db`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: overrides.lastOpenedAt ?? null,
  }
}

describe('decideProfileSituation (pure -- no filesystem)', () => {
  it('returns "no-profiles" for an empty list', () => {
    const result: ProfileListResult = { ok: true, profiles: [] }
    expect(decideProfileSituation(result)).toEqual({ kind: 'no-profiles' })
  })

  it('returns "single-profile" carrying that one profile, for a list of exactly one', () => {
    const p = profile('a')
    const result: ProfileListResult = { ok: true, profiles: [p] }
    expect(decideProfileSituation(result)).toEqual({ kind: 'single-profile', profile: p })
  })

  it('returns "multiple-profiles" carrying every profile, for a list of two or more', () => {
    const a = profile('a')
    const b = profile('b')
    const c = profile('c')
    const result: ProfileListResult = { ok: true, profiles: [a, b, c] }
    expect(decideProfileSituation(result)).toEqual({ kind: 'multiple-profiles', profiles: [a, b, c] })
  })

  it('returns "corrupt-registry" naming the underlying error message, never "no-profiles" -- this is the case that must never be conflated with a fresh install', () => {
    const result: ProfileListResult = {
      ok: false,
      error: new Error('Corrupt profile registry at /fake/profiles.json: not valid JSON (Unexpected token)'),
    }
    const situation = decideProfileSituation(result)
    expect(situation.kind).toBe('corrupt-registry')
    expect(situation).not.toEqual({ kind: 'no-profiles' })
    if (situation.kind === 'corrupt-registry') {
      expect(situation.message).toContain('Corrupt profile registry')
    }
  })

  it('a corrupt registry is distinguished from an empty one even though both could superficially "have no usable profiles"', () => {
    const empty = decideProfileSituation({ ok: true, profiles: [] })
    const corrupt = decideProfileSituation({ ok: false, error: new Error('boom') })
    expect(empty.kind).toBe('no-profiles')
    expect(corrupt.kind).toBe('corrupt-registry')
    expect(empty.kind).not.toBe(corrupt.kind)
  })
})

describe('resolveProfileSituation (reads a real registry on disk)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wimm-profile-lifecycle-spec-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is "no-profiles" when the registry file does not exist yet (first run)', () => {
    expect(resolveProfileSituation(dir)).toEqual({ kind: 'no-profiles' })
  })

  it('is "single-profile" after exactly one profile has been created', () => {
    const p = createProfile(dir, 'Alex', 'profile-1', new Date('2026-01-01T00:00:00.000Z'))
    expect(resolveProfileSituation(dir)).toEqual({ kind: 'single-profile', profile: p })
  })

  it('is "multiple-profiles" after two profiles have been created', () => {
    createProfile(dir, 'Alex', 'profile-1', new Date('2026-01-01T00:00:00.000Z'))
    createProfile(dir, 'Sam', 'profile-2', new Date('2026-01-02T00:00:00.000Z'))
    const situation = resolveProfileSituation(dir)
    expect(situation.kind).toBe('multiple-profiles')
    if (situation.kind === 'multiple-profiles') {
      expect(situation.profiles.map((p) => p.id).sort()).toEqual(['profile-1', 'profile-2'])
    }
  })

  it('is "corrupt-registry", never "no-profiles", when profiles.json exists but is not valid JSON', () => {
    writeFileSync(join(dir, 'profiles.json'), '{ this is not json')
    const situation = resolveProfileSituation(dir)
    expect(situation.kind).toBe('corrupt-registry')
    if (situation.kind === 'corrupt-registry') {
      expect(situation.message).toContain(join(dir, 'profiles.json'))
    }
  })

  it('is "corrupt-registry" when an entry is missing a required field', () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify([{ id: 'x' }]))
    const situation = resolveProfileSituation(dir)
    expect(situation.kind).toBe('corrupt-registry')
  })
})

describe('validateProfileName', () => {
  it('trims surrounding whitespace and collapses internal runs of whitespace', () => {
    expect(validateProfileName('  Family Budget  ')).toBe('Family Budget')
    expect(validateProfileName('Family    Budget')).toBe('Family Budget')
  })

  it('accepts a normal, short human name', () => {
    expect(validateProfileName('Alex')).toBe('Alex')
  })

  it('accepts non-Latin scripts and emoji -- this is user-facing, not a filesystem name', () => {
    expect(validateProfileName('Família 👨‍👩‍👧')).toBe('Família 👨‍👩‍👧')
    expect(validateProfileName('財務')).toBe('財務')
  })

  it('rejects an empty string, and a string that is only whitespace', () => {
    expect(() => validateProfileName('')).toThrow(InvalidProfileNameError)
    expect(() => validateProfileName('   ')).toThrow(InvalidProfileNameError)
  })

  it(`rejects a name longer than ${PROFILE_NAME_MAX_LENGTH} characters`, () => {
    const tooLong = 'x'.repeat(PROFILE_NAME_MAX_LENGTH + 1)
    expect(() => validateProfileName(tooLong)).toThrow(InvalidProfileNameError)
  })

  it(`accepts a name of exactly ${PROFILE_NAME_MAX_LENGTH} characters`, () => {
    const exact = 'x'.repeat(PROFILE_NAME_MAX_LENGTH)
    expect(validateProfileName(exact)).toBe(exact)
  })

  it('rejects control characters (e.g. a newline pasted from elsewhere)', () => {
    expect(() => validateProfileName('Alex\nBudget')).toThrow(InvalidProfileNameError)
    expect(() => validateProfileName('Alex\tBudget')).toThrow(InvalidProfileNameError)
  })

  it('never influences a filesystem path -- path traversal characters are ordinary name characters, not rejected, because dbFileName is derived from the caller-supplied id, never the name', () => {
    // This is deliberate, not an oversight: see profile-lifecycle.ts's doc
    // comment and profile-registry.ts's `createProfile`, which builds
    // `dbFileName` from `id` alone. A name containing "../" is just a
    // profile called "../etc/passwd" as far as the registry is concerned --
    // it can never become a path segment.
    expect(validateProfileName('../../etc/passwd')).toBe('../../etc/passwd')
  })
})
