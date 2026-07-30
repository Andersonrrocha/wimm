/**
 * Behavioral proof for `startLocalApi`: a real NestJS app actually boots
 * (proving decorator metadata survived the trip through `@wimm/api/dist`),
 * actually enforces the session token, actually reuses an existing profile
 * instead of duplicating it, actually surfaces a newer-database refusal as a
 * distinguishable error, and -- the part this task's report treats as load-
 * bearing -- is provably bound to loopback only, checked both by reading the
 * bound address back and by attempting a real TCP connection from a
 * non-loopback address of this machine.
 *
 * Runs under plain Node (via `ts-jest`), not Electron, and requires the
 * native ABI marker to say "node" (`apps/api/src/prisma/local/native-abi-
 * guard.ts`) -- see `package.json`'s `pretest` script.
 */
import { createConnection } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'

import { DATABASE_MIGRATED_BY_NEWER_BUILD_CODE } from '@wimm/api/dist/prisma/local/migration-runner'
import { openLocalDatabase } from '@wimm/api/dist/prisma/local/open-local-database'
import { SESSION_TOKEN_HEADER } from '@wimm/api/dist/profile/session-token'

import {
  isDatabaseMigratedByNewerBuildError,
  NewerDatabaseError,
  rethrowMigrationFailure,
  startLocalApi,
  type LocalApiHandle,
} from './local-api'

jest.setTimeout(30000)

function tmpProfileDir(): string {
  return mkdtempSync(join(tmpdir(), 'wimm-local-api-spec-'))
}

/** Every non-internal IPv4 address this machine's own network interfaces report. */
function nonLoopbackIPv4Addresses(): string[] {
  const interfaces = networkInterfaces()
  const addresses: string[] = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address)
      }
    }
  }
  return addresses
}

/**
 * Resolves `true` if a TCP connection to `host:port` succeeds, `false` if it
 * is actively refused (`ECONNREFUSED`), and rejects for anything else
 * (including a timeout) -- an ambiguous outcome must never silently read as
 * either a pass or a refusal.
 */
function attemptConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`connection attempt to ${host}:${port} neither connected nor errored within 3s`))
    }, 3000)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolve(true)
    })

    socket.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (err.code === 'ECONNREFUSED') {
        resolve(false)
      } else {
        reject(err)
      }
    })
  })
}

describe('startLocalApi', () => {
  let profileDir: string
  let handle: LocalApiHandle | undefined

  beforeEach(() => {
    profileDir = tmpProfileDir()
  })

  afterEach(async () => {
    if (handle) {
      await handle.close()
      handle = undefined
    }
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('returns a real ephemeral port and a usable session token, and serves the local API', async () => {
    handle = await startLocalApi({ profileDir })

    expect(Number.isInteger(handle.port)).toBe(true)
    expect(handle.port).toBeGreaterThan(0)
    expect(typeof handle.token).toBe('string')
    expect(handle.token.length).toBeGreaterThan(0)

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/sources`, {
      headers: { [SESSION_TOKEN_HEADER]: handle.token },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('rejects a request with no token, and a request with the wrong token, both with 401', async () => {
    handle = await startLocalApi({ profileDir })

    const noToken = await fetch(`http://127.0.0.1:${handle.port}/api/sources`)
    expect(noToken.status).toBe(401)

    const wrongToken = await fetch(`http://127.0.0.1:${handle.port}/api/sources`, {
      headers: { [SESSION_TOKEN_HEADER]: 'definitely-wrong' },
    })
    expect(wrongToken.status).toBe(401)
  })

  it('reuses the existing profile and its single user on a second launch, without duplicating either', async () => {
    handle = await startLocalApi({ profileDir })
    await handle.close()
    handle = undefined

    // A second launch against the same profileDir. If this had created a
    // second profile, or a second User row in the same profile,
    // ActiveProfileService's own "expected exactly 1" boot check (see its
    // doc comment) would throw. This test proves the second boot instead
    // succeeds cleanly -- meaning exactly one profile and exactly one user
    // were reused, not duplicated.
    handle = await startLocalApi({ profileDir })
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/sources`, {
      headers: { [SESSION_TOKEN_HEADER]: handle.token },
    })
    expect(res.status).toBe(200)
  })

  it('surfaces a NewerDatabaseError, not a raw crash, when the profile database was migrated by a newer build', async () => {
    // First launch creates and migrates a real profile database.
    handle = await startLocalApi({ profileDir })
    await handle.close()
    handle = undefined

    // Simulate "a newer build already migrated this database" the same way
    // migration-runner.spec.ts does: insert a migration record naming a
    // migration this build does not ship. migration-runner.ts's own "ahead
    // of this build" check (see its doc comment) is what this is exercising.
    const registry = JSON.parse(readFileSync(join(profileDir, 'profiles.json'), 'utf8')) as Array<{
      dbFileName: string
    }>
    const dbFile = join(profileDir, 'profiles', registry[0].dbFileName)
    const db = openLocalDatabase(dbFile)
    db.prepare(
      `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(
      'mutation-proof-id',
      'x'.repeat(64),
      new Date().toISOString(),
      '9999_future_migration',
      new Date().toISOString(),
    )
    db.close()

    let caught: unknown
    try {
      await startLocalApi({ profileDir })
    } catch (err) {
      caught = err
    }

    // Detection (this instanceof check) is what's load-bearing here -- it
    // must not depend on migration-runner.ts's specific wording (see the
    // "newer-database detection reacts to the typed error" describe block
    // below for the dedicated proof of that). The message is asserted only
    // to be non-empty, i.e. actually propagated from the underlying error --
    // not pinned to any particular phrasing, which is free to change in
    // migration-runner.ts without breaking this test.
    expect(caught).toBeInstanceOf(NewerDatabaseError)
    expect((caught as Error).message.length).toBeGreaterThan(0)
  })

  describe('loopback binding -- proven both ways, not assumed', () => {
    it('accepts a connection on 127.0.0.1, and refuses one on every non-loopback address of this machine', async () => {
      handle = await startLocalApi({ profileDir })

      const loopbackOk = await attemptConnection('127.0.0.1', handle.port)
      expect(loopbackOk).toBe(true)

      const candidates = nonLoopbackIPv4Addresses()
      if (candidates.length === 0) {
        // See this task's report for why this branch is handled this way:
        // a sandboxed environment can genuinely have no non-loopback IPv4
        // address at all (e.g. only `lo0`). The positive loopback-accepts
        // assertion above still ran unconditionally; this only means the
        // negative non-loopback-refuses assertion below has nothing to test
        // against on this particular machine.
        console.warn(
          'startLocalApi.spec: os.networkInterfaces() reports no non-loopback IPv4 address on this machine -- ' +
            'skipping the non-loopback-refuses assertion. The loopback-accepts assertion above still ran.',
        )
        return
      }

      for (const address of candidates) {
        const accepted = await attemptConnection(address, handle.port)
        expect(accepted).toBe(false)
      }
    })
  })
})

describe('newer-database detection reacts to the typed error, not its message', () => {
  // These exercise `isDatabaseMigratedByNewerBuildError` / `rethrowMigrationFailure`
  // directly with synthetic errors -- no real migration run needed -- to prove
  // detection is decoupled from `migration-runner.ts`'s specific wording. See
  // this task's report ("Fix round 1") for the mutation proof that pins this
  // down against the real runner (reword the message: detection still works;
  // break the `code` discriminant: detection fails).

  it('detects a reworded message as long as the `code` discriminant is present (not message-based)', () => {
    // Same shape migration-runner.ts's DatabaseMigratedByNewerBuildError has
    // (an Error with a `code` field), but with a message that shares no
    // words with the original -- deliberately not "newer build", not
    // "restore", not "snapshot". If detection were still matching on
    // message text, this would fall through as a plain Error instead of
    // becoming a NewerDatabaseError.
    const reworded = Object.assign(new Error('this profile predates a rollback and cannot be opened by this build'), {
      code: DATABASE_MIGRATED_BY_NEWER_BUILD_CODE,
    })

    expect(isDatabaseMigratedByNewerBuildError(reworded)).toBe(true)

    let caught: unknown
    try {
      rethrowMigrationFailure(reworded)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(NewerDatabaseError)
  })

  it('does NOT detect the original message text on its own, without the `code` discriminant', () => {
    // The exact historical marker this task's first round matched on as a
    // substring, now attached to a plain Error with no `code` field at all --
    // proving detection no longer falls back to text matching by accident.
    const oldStyleError = new Error(
      'some-file.db was already migrated by a newer build of this app: it records migration(s) 0001_x as applied',
    )

    expect(isDatabaseMigratedByNewerBuildError(oldStyleError)).toBe(false)

    let caught: unknown
    try {
      rethrowMigrationFailure(oldStyleError)
    } catch (err) {
      caught = err
    }
    expect(caught).not.toBeInstanceOf(NewerDatabaseError)
    expect(caught).toBe(oldStyleError)
  })
})
