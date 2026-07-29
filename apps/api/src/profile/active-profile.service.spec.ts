import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
// `@types/better-sqlite3` uses `export =`, same reasoning as
// open-local-database.ts: import-equals is required for the runtime value
// (not just the type) to resolve.
import Database = require('better-sqlite3')
import { LocalPrismaService } from '../prisma/local/local-prisma.service'
import { ActiveProfileService } from './active-profile.service'

const ROOT = '/tmp/wimm-active-profile-service-spec'
const BASELINE = join(__dirname, '../../prisma/migrations-sqlite/0000_baseline/migration.sql')

/** Builds a fresh SQLite file with the real, committed Phase 1 baseline applied. */
function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

/** Inserts a `User` row through Prisma itself (a throwaway `LocalPrismaService`
 * connection, connected and disconnected within this call) so `createdAt`/
 * `updatedAt` -- which Prisma manages client-side, not as SQL column
 * defaults -- are populated the same way the real application would. */
async function seedUser(
  file: string,
  overrides: Partial<{ id: string; email: string; username: string }> = {},
): Promise<{ id: string; email: string; username: string }> {
  const seeding = new LocalPrismaService(file)
  await seeding.onModuleInit()
  try {
    const id = overrides.id ?? randomUUID()
    const email = overrides.email ?? `${id}@example.com`
    const username = overrides.username ?? `user-${id}`
    await seeding.user.create({
      data: { id, email, username, passwordHash: 'irrelevant-hash' },
    })
    return { id, email, username }
  } finally {
    await seeding.onModuleDestroy()
  }
}

describe('ActiveProfileService', () => {
  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  describe('resolving the active profile user', () => {
    it('caches the single User row as a JwtPayload-shaped object during onModuleInit', async () => {
      const file = freshDatabaseFile()
      const seeded = await seedUser(file, { email: 'alice@example.com', username: 'alice' })
      const localPrisma = new LocalPrismaService(file)
      await localPrisma.onModuleInit()
      const service = new ActiveProfileService(localPrisma)

      await service.onModuleInit()

      try {
        expect(service.getUser()).toEqual({
          sub: seeded.id,
          email: 'alice@example.com',
          username: 'alice',
        })
      } finally {
        await localPrisma.onModuleDestroy()
      }
    })
  })

  describe('zero users -- a freshly created, not-yet-onboarded profile', () => {
    it('throws a distinctive error naming the empty state, not a generic failure', async () => {
      const file = freshDatabaseFile()
      const localPrisma = new LocalPrismaService(file)
      await localPrisma.onModuleInit()
      const service = new ActiveProfileService(localPrisma)

      try {
        await expect(service.onModuleInit()).rejects.toThrow(/no User row/i)
      } finally {
        await localPrisma.onModuleDestroy()
      }
    })

    it('leaves getUser() throwing (never falls back to a placeholder identity)', async () => {
      const file = freshDatabaseFile()
      const localPrisma = new LocalPrismaService(file)
      await localPrisma.onModuleInit()
      const service = new ActiveProfileService(localPrisma)

      try {
        await expect(service.onModuleInit()).rejects.toThrow()
        expect(() => service.getUser()).toThrow(/before the active profile/i)
      } finally {
        await localPrisma.onModuleDestroy()
      }
    })
  })

  describe('more than one user -- corruption or cross-profile leakage', () => {
    it('throws a distinctive error naming the actual count, not a generic failure', async () => {
      const file = freshDatabaseFile()
      await seedUser(file)
      await seedUser(file)
      await seedUser(file)
      const localPrisma = new LocalPrismaService(file)
      await localPrisma.onModuleInit()
      const service = new ActiveProfileService(localPrisma)

      try {
        await expect(service.onModuleInit()).rejects.toThrow(/contains 3 User rows/)
      } finally {
        await localPrisma.onModuleDestroy()
      }
    })
  })

  describe('getUser() called before resolution', () => {
    it('throws rather than returning undefined or a stale value', () => {
      const service = new ActiveProfileService({} as LocalPrismaService)

      expect(() => service.getUser()).toThrow(/before the active profile's user was resolved/i)
    })
  })
})
