import * as fs from 'fs'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Profile, createProfile, listProfiles, profileDatabasePath, touchProfile } from './profile-registry'

const ROOT = '/tmp/wimm-profile-registry-spec'
const REGISTRY_FILE = join(ROOT, 'profiles.json')

describe('profile registry (listProfiles / createProfile / touchProfile / profileDatabasePath)', () => {
  beforeEach(() => {
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  describe('missing vs corrupt registry -- must never be conflated', () => {
    it('returns an empty array when the registry file does not exist yet (first run)', () => {
      expect(existsSync(REGISTRY_FILE)).toBe(false)

      expect(listProfiles(ROOT)).toEqual([])
    })

    it('throws, naming the file, when the registry exists but is not valid JSON', () => {
      writeFileSync(REGISTRY_FILE, 'this is not { valid json')

      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)
    })

    it('throws, naming the file, when the registry parses but is not a JSON array', () => {
      writeFileSync(REGISTRY_FILE, JSON.stringify({ not: 'an array' }))

      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)
    })

    it('throws, naming the file, when an entry in the registry does not have the shape of a profile', () => {
      writeFileSync(REGISTRY_FILE, JSON.stringify([{ id: 'a' }]))

      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)
    })

    it('proves the two failure modes are distinguished: missing yields [], corrupt throws -- for the same directory', () => {
      // Before any registry file exists: "no profiles yet".
      expect(listProfiles(ROOT)).toEqual([])

      // The moment a registry file exists but cannot be read: this is no
      // longer "no profiles" -- it is "profiles exist, index unreadable" --
      // and must throw instead of quietly reporting [] again.
      writeFileSync(REGISTRY_FILE, '{{{ not json at all')

      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)
      expect(() => listProfiles(ROOT)).toThrow(/[Cc]orrupt/)
    })

    it('does not surface a plain JSON.parse SyntaxError as the whole error -- the message names the file', () => {
      writeFileSync(REGISTRY_FILE, 'not json')

      try {
        listProfiles(ROOT)
        throw new Error('expected listProfiles to throw')
      } catch (err) {
        expect((err as Error).message).toContain(REGISTRY_FILE)
      }
    })
  })

  describe('createProfile', () => {
    it('creates a profile with the expected shape and persists it to the registry', () => {
      const now = new Date('2026-01-01T00:00:00.000Z')

      const profile = createProfile(ROOT, 'Alice', 'alice-id', now)

      expect(profile).toEqual<Profile>({
        id: 'alice-id',
        name: 'Alice',
        dbFileName: 'alice-id.db',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: null,
      })
      expect(listProfiles(ROOT)).toEqual([profile])
    })

    it('appends to existing profiles rather than replacing them', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))
      createProfile(ROOT, 'Bob', 'bob-id', new Date('2026-01-02T00:00:00.000Z'))

      const profiles = listProfiles(ROOT)
      expect(profiles.map((p) => p.id)).toEqual(['alice-id', 'bob-id'])
    })

    it('throws and does not modify the registry when the id already exists', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))
      const before = readFileSync(REGISTRY_FILE, 'utf8')

      expect(() => createProfile(ROOT, 'Alice Again', 'alice-id', new Date('2026-01-02T00:00:00.000Z'))).toThrow(
        /alice-id/,
      )

      expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(before)
      expect(listProfiles(ROOT)).toHaveLength(1)
    })

    it('throws, naming the file, rather than creating a profile on top of a corrupt registry', () => {
      writeFileSync(REGISTRY_FILE, 'not json')

      expect(() => createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))).toThrow(
        REGISTRY_FILE,
      )
    })
  })

  describe('touchProfile', () => {
    it("updates only the matching profile's lastOpenedAt, leaving others untouched", () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))
      createProfile(ROOT, 'Bob', 'bob-id', new Date('2026-01-01T00:00:00.000Z'))

      touchProfile(ROOT, 'bob-id', new Date('2026-02-01T00:00:00.000Z'))

      const profiles = listProfiles(ROOT)
      const alice = profiles.find((p) => p.id === 'alice-id')!
      const bob = profiles.find((p) => p.id === 'bob-id')!
      expect(alice.lastOpenedAt).toBeNull()
      expect(bob.lastOpenedAt).toBe('2026-02-01T00:00:00.000Z')
    })

    it('throws when the id does not exist in the registry', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))

      expect(() => touchProfile(ROOT, 'does-not-exist', new Date('2026-02-01T00:00:00.000Z'))).toThrow(
        /does-not-exist/,
      )
    })
  })

  describe('profileDatabasePath', () => {
    it('joins the profiles subdirectory and the profile dbFileName', () => {
      const profile: Profile = {
        id: 'alice-id',
        name: 'Alice',
        dbFileName: 'alice-id.db',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: null,
      }

      expect(profileDatabasePath(ROOT, profile)).toBe(join(ROOT, 'profiles', 'alice-id.db'))
    })

    it('does not create any directory or file as a side effect', () => {
      const profile: Profile = {
        id: 'alice-id',
        name: 'Alice',
        dbFileName: 'alice-id.db',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: null,
      }

      profileDatabasePath(ROOT, profile)

      expect(existsSync(join(ROOT, 'profiles'))).toBe(false)
    })
  })

  describe('atomic writes', () => {
    // These tests specifically do NOT just "write then read back" -- that
    // would pass identically for a plain, non-atomic `writeFileSync`. They
    // instead force the write to fail partway through and assert the
    // property atomicity actually buys: the previously existing
    // `profiles.json` is left completely intact (not merged, not
    // truncated), and no temp file is left behind.

    it('leaves the existing registry byte-identical when the rename step fails partway through a write', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))
      const before = readFileSync(REGISTRY_FILE, 'utf8')

      const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('simulated rename failure (e.g. crash mid-write)')
      })

      try {
        expect(() => createProfile(ROOT, 'Bob', 'bob-id', new Date('2026-01-02T00:00:00.000Z'))).toThrow(
          /simulated rename failure/,
        )
      } finally {
        spy.mockRestore()
      }

      // The registry must still be exactly what it was before the failed
      // write -- not truncated, not partially overwritten -- and must
      // still parse and list correctly.
      expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(before)
      expect(listProfiles(ROOT)).toHaveLength(1)
      expect(listProfiles(ROOT)[0].id).toBe('alice-id')
    })

    it('leaves no temp file behind after a failed write', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))

      const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('simulated rename failure')
      })

      try {
        expect(() => touchProfile(ROOT, 'alice-id', new Date('2026-01-03T00:00:00.000Z'))).toThrow()
      } finally {
        spy.mockRestore()
      }

      const leftovers = readdirSync(ROOT).filter((name) => name.includes('.tmp'))
      expect(leftovers).toEqual([])
    })

    it('leaves the existing registry intact when the temp file write itself fails', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))
      const before = readFileSync(REGISTRY_FILE, 'utf8')

      const realWriteFileSync = fs.writeFileSync
      const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
        const [dest] = args
        if (String(dest).endsWith('.tmp')) {
          throw new Error('simulated disk full while writing temp file')
        }
        return realWriteFileSync(...args)
      })

      try {
        expect(() => createProfile(ROOT, 'Bob', 'bob-id', new Date('2026-01-02T00:00:00.000Z'))).toThrow(
          /simulated disk full/,
        )
      } finally {
        spy.mockRestore()
      }

      expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(before)
      expect(listProfiles(ROOT)).toHaveLength(1)

      const leftovers = readdirSync(ROOT).filter((name) => name.includes('.tmp'))
      expect(leftovers).toEqual([])
    })

    it('produces a registry file that still parses correctly after a normal (non-interrupted) write', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))

      const raw = readFileSync(REGISTRY_FILE, 'utf8')
      expect(() => JSON.parse(raw)).not.toThrow()
    })
  })
})
