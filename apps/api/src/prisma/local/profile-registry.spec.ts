import * as fs from 'fs'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  CURRENT_REGISTRY_VERSION,
  PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE,
  Profile,
  ProfileRegistryWrittenByNewerBuildError,
  createProfile,
  listProfiles,
  profileDatabasePath,
  touchProfile,
} from './profile-registry'

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

    it('throws, naming the file, when the registry parses but is not a JSON array or a {version, profiles} object', () => {
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
  })

  describe('forward compatibility -- entries carrying fields this version does not recognize', () => {
    // These write a bare JSON array by hand -- the legacy, unversioned (i.e.
    // version 1) shape every registry written before this task has -- so
    // they double as coverage that the version-1-to-2 migration (see the
    // "registry schema versioning" describe block below) never drops an
    // unrecognized field along the way.
    it('does not throw when an entry has an extra field, and includes that field in the result', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
            syncCursor: 'from-a-newer-build',
          },
        ]),
      )

      const profiles = listProfiles(ROOT)

      expect(profiles).toHaveLength(1)
      expect((profiles[0] as unknown as Record<string, unknown>).syncCursor).toBe('from-a-newer-build')
    })

    it('preserves an unrecognized field on an entry untouched by touchProfile, byte-for-byte, across a write', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
            syncCursor: 'from-a-newer-build',
          },
          {
            id: 'bob-id',
            name: 'Bob',
            dbFileName: 'bob-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
          },
        ]),
      )

      touchProfile(ROOT, 'bob-id', new Date('2026-02-01T00:00:00.000Z'))

      const rewritten = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
      expect(rewritten.version).toBe(CURRENT_REGISTRY_VERSION)
      const alice = rewritten.profiles.find((p: Record<string, unknown>) => p.id === 'alice-id')
      expect(alice.syncCursor).toBe('from-a-newer-build')
      expect(alice).toEqual({
        id: 'alice-id',
        name: 'Alice',
        // Renamed by the version 1 -> 2 migration that ran on read, before
        // touchProfile ever saw this entry -- see the versioning describe
        // block below for the dedicated proof of that rename.
        databaseFileName: 'alice-id.db',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: null,
        syncCursor: 'from-a-newer-build',
      })
    })

    it('preserves an unrecognized field on the entry touchProfile itself updates', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
            syncCursor: 'from-a-newer-build',
          },
        ]),
      )

      touchProfile(ROOT, 'alice-id', new Date('2026-02-01T00:00:00.000Z'))

      const rewritten = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
      expect(rewritten.profiles[0].syncCursor).toBe('from-a-newer-build')
      expect(rewritten.profiles[0].lastOpenedAt).toBe('2026-02-01T00:00:00.000Z')
    })

    it('preserves an unrecognized field on an existing entry when createProfile appends a new one', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
            syncCursor: 'from-a-newer-build',
          },
        ]),
      )

      createProfile(ROOT, 'Bob', 'bob-id', new Date('2026-01-02T00:00:00.000Z'))

      const rewritten = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
      const alice = rewritten.profiles.find((p: Record<string, unknown>) => p.id === 'alice-id')
      expect(alice.syncCursor).toBe('from-a-newer-build')
    })

    it('still throws, naming the file, when an entry is missing a field this version genuinely requires', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([{ id: 'alice-id', name: 'Alice', syncCursor: 'from-a-newer-build' }]),
      )

      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)
    })
  })

  describe('registry schema versioning and forward migration', () => {
    it('defaults to version 1 when the registry is a bare JSON array with no version field at all (the in-the-wild case)', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
          },
        ]),
      )

      expect(listProfiles(ROOT)).toEqual([
        {
          id: 'alice-id',
          name: 'Alice',
          databaseFileName: 'alice-id.db',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: null,
        },
      ])
    })

    it('defaults to version 1 when the registry is an object with a "profiles" array but no "version" field', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify({
          profiles: [
            {
              id: 'alice-id',
              name: 'Alice',
              dbFileName: 'alice-id.db',
              createdAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: null,
            },
          ],
        }),
      )

      expect(listProfiles(ROOT)).toEqual([
        {
          id: 'alice-id',
          name: 'Alice',
          databaseFileName: 'alice-id.db',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: null,
        },
      ])
    })

    it('migrates a version 1 registry forward: dbFileName becomes databaseFileName, and every profile survives intact', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
          },
          {
            id: 'bob-id',
            name: 'Bob',
            dbFileName: 'bob-id.db',
            createdAt: '2026-01-02T00:00:00.000Z',
            lastOpenedAt: '2026-02-01T00:00:00.000Z',
          },
        ]),
      )

      const profiles = listProfiles(ROOT)

      expect(profiles).toEqual([
        {
          id: 'alice-id',
          name: 'Alice',
          databaseFileName: 'alice-id.db',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: null,
        },
        {
          id: 'bob-id',
          name: 'Bob',
          databaseFileName: 'bob-id.db',
          createdAt: '2026-01-02T00:00:00.000Z',
          lastOpenedAt: '2026-02-01T00:00:00.000Z',
        },
      ])
      // The old field name must be gone, not merely duplicated alongside the new one.
      expect((profiles[0] as unknown as Record<string, unknown>).dbFileName).toBeUndefined()
      expect((profiles[1] as unknown as Record<string, unknown>).dbFileName).toBeUndefined()
    })

    it('rewrites the migrated registry atomically to disk as the new versioned envelope, so the migration never has to run again', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
          },
        ]),
      )

      listProfiles(ROOT)

      const onDisk = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
      expect(onDisk.version).toBe(CURRENT_REGISTRY_VERSION)
      expect(onDisk.profiles).toEqual([
        {
          id: 'alice-id',
          name: 'Alice',
          databaseFileName: 'alice-id.db',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: null,
        },
      ])
    })

    it('does not rewrite the file at all when it is already at the current version (no migration needed)', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))
      const before = readFileSync(REGISTRY_FILE, 'utf8')

      listProfiles(ROOT)

      expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(before)
    })

    it('migrates through the same atomic temp-then-rename write path: a rename failure during migration leaves the original v1 file completely intact', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify([
          {
            id: 'alice-id',
            name: 'Alice',
            dbFileName: 'alice-id.db',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
          },
        ]),
      )
      const before = readFileSync(REGISTRY_FILE, 'utf8')

      const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('simulated rename failure during migration')
      })

      try {
        expect(() => listProfiles(ROOT)).toThrow(/simulated rename failure/)
      } finally {
        spy.mockRestore()
      }

      expect(readFileSync(REGISTRY_FILE, 'utf8')).toBe(before)
      const leftovers = readdirSync(ROOT).filter((name) => name.includes('.tmp'))
      expect(leftovers).toEqual([])
    })

    it('throws, naming the file, when the version field is present but not a positive integer', () => {
      writeFileSync(REGISTRY_FILE, JSON.stringify({ version: 0, profiles: [] }))
      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)

      writeFileSync(REGISTRY_FILE, JSON.stringify({ version: 1.5, profiles: [] }))
      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)
    })

    it('throws ProfileRegistryWrittenByNewerBuildError when the registry declares a version newer than this build understands', () => {
      writeFileSync(
        REGISTRY_FILE,
        JSON.stringify({
          version: CURRENT_REGISTRY_VERSION + 1,
          profiles: [
            {
              id: 'alice-id',
              name: 'Alice',
              // A hypothetical future field name this build has never heard
              // of -- deliberately NOT `databaseFileName`, to prove the
              // version check fires and refuses BEFORE any shape validation
              // would otherwise (wrongly) reject this as "missing
              // databaseFileName".
              storageFile: 'alice-id.db',
              createdAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: null,
            },
          ],
        }),
      )

      expect(() => listProfiles(ROOT)).toThrow(ProfileRegistryWrittenByNewerBuildError)
      expect(() => listProfiles(ROOT)).toThrow(REGISTRY_FILE)
    })

    it('the newer-version refusal is distinguishable from a corrupt registry ONLY by a stable code, never by matching a message', () => {
      // A registry from a newer build.
      writeFileSync(REGISTRY_FILE, JSON.stringify({ version: CURRENT_REGISTRY_VERSION + 1, profiles: [] }))
      let newerVersionError: unknown
      try {
        listProfiles(ROOT)
        throw new Error('expected listProfiles to throw for a newer-version registry')
      } catch (err) {
        newerVersionError = err
      }

      // A genuinely corrupt registry.
      writeFileSync(REGISTRY_FILE, 'not json at all')
      let corruptError: unknown
      try {
        listProfiles(ROOT)
        throw new Error('expected listProfiles to throw for a corrupt registry')
      } catch (err) {
        corruptError = err
      }

      expect((newerVersionError as { code?: unknown }).code).toBe(PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE)
      expect((corruptError as { code?: unknown }).code).toBeUndefined()
      // Both are plain Errors with a human-readable message -- the code is
      // what a caller must branch on, not the presence/absence of any
      // particular substring in either message.
      expect(newerVersionError).toBeInstanceOf(Error)
      expect(corruptError).toBeInstanceOf(Error)
    })
  })

  describe('createProfile', () => {
    it('creates a profile with the expected shape and persists it to the registry', () => {
      const now = new Date('2026-01-01T00:00:00.000Z')

      const profile = createProfile(ROOT, 'Alice', 'alice-id', now)

      expect(profile).toEqual<Profile>({
        id: 'alice-id',
        name: 'Alice',
        databaseFileName: 'alice-id.db',
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
    it('joins the profiles subdirectory and the profile databaseFileName', () => {
      const profile: Profile = {
        id: 'alice-id',
        name: 'Alice',
        databaseFileName: 'alice-id.db',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: null,
      }

      expect(profileDatabasePath(ROOT, profile)).toBe(join(ROOT, 'profiles', 'alice-id.db'))
    })

    it('does not create any directory or file as a side effect', () => {
      const profile: Profile = {
        id: 'alice-id',
        name: 'Alice',
        databaseFileName: 'alice-id.db',
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

    // The tests above stub `renameSync` to throw -- they prove the pattern
    // fails safely, but nothing so far exercises the REAL `renameSync` and
    // proves the pattern is what it claims to be: atomic. Everything below
    // this comment runs the genuine, unmocked write path and would fail if
    // `writeRegistry` were changed to write `REGISTRY_FILE` directly instead
    // of temp-then-rename -- see the task report's mutation proof, which
    // breaks the pattern this exact way and confirms these two tests catch
    // it (the two above, which only stub failures, do not).
    //
    // What is deliberately NOT re-tested here: that a same-filesystem
    // `rename()` is atomic in the first place. POSIX guarantees that
    // outright, and no unit test on this machine can prove or disprove it
    // for Windows -- see the module doc comment and the task report for what
    // genuinely differs there (an open handle, e.g. a virus scanner, making
    // `renameSync` over an existing path fail in a way POSIX never does) and
    // why only running this same suite on a real Windows machine in CI can
    // answer that.

    it('replaces the registry only via a real renameSync from a fresh temp file in the same directory -- never by writing the target path directly', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))

      const realWriteFileSync = fs.writeFileSync
      const realRenameSync = fs.renameSync
      const writeDestinations: string[] = []
      const renameCalls: Array<{ from: string; to: string }> = []

      const writeSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
          writeDestinations.push(String(args[0]))
          return realWriteFileSync(...args)
        })
      const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        renameCalls.push({ from: String(from), to: String(to) })
        return realRenameSync(from, to)
      })

      try {
        touchProfile(ROOT, 'alice-id', new Date('2026-02-01T00:00:00.000Z'))
      } finally {
        writeSpy.mockRestore()
        renameSpy.mockRestore()
      }

      // The new content lands in a temp file, never in REGISTRY_FILE itself.
      expect(writeDestinations).toHaveLength(1)
      expect(writeDestinations[0]).not.toBe(REGISTRY_FILE)
      expect(writeDestinations[0]).toMatch(/\.profiles\.json\..*\.tmp$/)

      // The temp file sits in the SAME directory as the target -- required
      // for the following rename to be a same-filesystem, atomic swap.
      expect(dirname(writeDestinations[0])).toBe(dirname(REGISTRY_FILE))

      // Exactly one renameSync call moves that temp file onto the real
      // target. A "write directly over the target" mutation calls
      // writeFileSync(REGISTRY_FILE, ...) directly and never calls
      // renameSync at all, so this assertion fails immediately under it.
      expect(renameCalls).toEqual([{ from: writeDestinations[0], to: REGISTRY_FILE }])
    })

    it('keeps an already-open reader isolated from an in-flight write (real renameSync, no mocking) -- the property that actually distinguishes an atomic rename from an in-place write', () => {
      createProfile(ROOT, 'Alice', 'alice-id', new Date('2026-01-01T00:00:00.000Z'))
      const before = readFileSync(REGISTRY_FILE, 'utf8')

      // A genuine second file descriptor, opened before the write and held
      // open throughout it -- not a mock. On POSIX, renaming a new file
      // over REGISTRY_FILE only swaps the directory entry: this descriptor
      // keeps referencing the old (now-unlinked) inode's data, completely
      // unaffected by whatever replaces the name. This is exactly the
      // property an atomic rename buys and an in-place write does not; see
      // the mutation proof below for why this test fails under the latter.
      //
      // It is also the shape of the genuine Windows hazard the task names:
      // another program (a virus scanner, a backup tool, a leftover handle)
      // holding this same kind of plain read handle open. POSIX does not
      // care; Windows' rename-over-an-open-target can refuse where POSIX
      // would not. That difference cannot be produced on this machine --
      // running this exact test on windows-latest in CI is what answers it.
      const fd = openSync(REGISTRY_FILE, 'r')

      try {
        touchProfile(ROOT, 'alice-id', new Date('2026-02-01T00:00:00.000Z'))

        // The old descriptor still sees the OLD, complete content -- not
        // truncated, not the new content, not a mix of both. A "write
        // directly over the target" mutation truncates and rewrites this
        // same inode in place, so this same read would observe the NEW
        // content instead and this assertion would fail.
        const buffer = Buffer.alloc(Buffer.byteLength(before, 'utf8'))
        readSync(fd, buffer, 0, buffer.length, 0)
        expect(buffer.toString('utf8')).toBe(before)
      } finally {
        closeSync(fd)
      }

      // A fresh open sees the new content.
      expect(listProfiles(ROOT).find((p) => p.id === 'alice-id')!.lastOpenedAt).toBe('2026-02-01T00:00:00.000Z')
    })
  })
})
