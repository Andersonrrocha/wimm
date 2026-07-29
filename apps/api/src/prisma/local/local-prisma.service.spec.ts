import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
// `@types/better-sqlite3` uses `export =`, same reasoning as open-local-database.ts:
// import-equals is required for the runtime value (not just the type) to resolve.
import Database = require('better-sqlite3')
import { LocalPrismaService } from './local-prisma.service'

const ROOT = '/tmp/wimm-local-prisma-service-spec'
const BASELINE = join(__dirname, '../../../prisma/migrations-sqlite/0000_baseline/migration.sql')

/**
 * `better-sqlite3` already defaults `foreign_keys` to `1` -- both the root
 * workspace build and the copy `@prisma/adapter-better-sqlite3` bundles. That
 * means a test which only asserts the *final* pragma value (or only that a
 * cascade fires) proves nothing about this service: it would pass identically
 * whether `onModuleInit` sets or verifies anything at all, because the
 * default already agrees. Every test in the "pragma verification" block below
 * is written to fail if the explicit set-and-verify code is removed or
 * weakened, specifically so it cannot be a tautology of the driver default --
 * see local-prisma.service.ts's module doc comment.
 */
describe('LocalPrismaService', () => {
  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  /** Builds a fresh SQLite file with the real, committed Phase 1 baseline applied. */
  function freshDatabaseFile(): string {
    mkdirSync(ROOT, { recursive: true })
    const file = join(ROOT, `${randomUUID()}.db`)
    const db = new Database(file)
    db.exec(readFileSync(BASELINE, 'utf8'))
    db.close()
    return file
  }

  describe('pragma verification', () => {
    it('sets foreign_keys = ON explicitly through $queryRawUnsafe, not relying on the driver default', async () => {
      const file = freshDatabaseFile()
      const service = new LocalPrismaService(file)
      const spy = jest.spyOn(service, '$queryRawUnsafe')

      try {
        await service.onModuleInit()
        // Asserts the explicit statement was actually issued on this
        // connection -- not merely that the final value happens to be 1,
        // which the driver would already give for free.
        expect(spy).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
      } finally {
        spy.mockRestore()
        await service.onModuleDestroy()
      }
    })

    it('refuses to hand back a usable service when the read-back disagrees with ON, naming the file and the value', async () => {
      const file = freshDatabaseFile()
      const service = new LocalPrismaService(file)

      // Simulates exactly the risk the module doc comment names: a driver
      // upgrade silently disabling enforcement. Only the verification read
      // is intercepted -- $connect, the SET pragma, and everything else hit
      // the real connection -- so this proves the *verification* itself is
      // load-bearing, not just that some mock makes the test pass.
      const original = service.$queryRawUnsafe.bind(service)
      const spy = jest
        .spyOn(service, '$queryRawUnsafe')
        .mockImplementation(((query: string, ...values: unknown[]) => {
          if (query === 'PRAGMA foreign_keys') return Promise.resolve([{ foreign_keys: 0 }])
          return original(query, ...values)
        }) as typeof service.$queryRawUnsafe)

      let thrown: Error | undefined
      try {
        await service.onModuleInit()
      } catch (err) {
        thrown = err as Error
      } finally {
        spy.mockRestore()
      }

      expect(thrown).toBeDefined()
      expect(thrown!.message).toContain(file)
      expect(thrown!.message).toMatch(/foreign key enforcement could not be verified as ON/i)
      expect(thrown!.message).toMatch(/read back 0/)

      // The refusal must not leave a dangling connected-but-untrusted
      // handle: a fresh service against the same file must still be able to
      // connect and run a real query.
      const recheck = new LocalPrismaService(file)
      await recheck.onModuleInit()
      expect(await recheck.user.count()).toBe(0)
      await recheck.onModuleDestroy()
    })

    it('refuses to hand back a usable service when the read-back is a value other than 0 or 1', async () => {
      const file = freshDatabaseFile()
      const service = new LocalPrismaService(file)

      const original = service.$queryRawUnsafe.bind(service)
      const spy = jest
        .spyOn(service, '$queryRawUnsafe')
        .mockImplementation(((query: string, ...values: unknown[]) => {
          if (query === 'PRAGMA foreign_keys') return Promise.resolve([])
          return original(query, ...values)
        }) as typeof service.$queryRawUnsafe)

      let thrown: Error | undefined
      try {
        await service.onModuleInit()
      } catch (err) {
        thrown = err as Error
      } finally {
        spy.mockRestore()
      }

      expect(thrown).toBeDefined()
      expect(thrown!.message).toMatch(/foreign key enforcement could not be verified as ON/i)
      expect(thrown!.message).toMatch(/read back undefined/)
    })
  })

  describe('cascade enforcement, through Prisma itself', () => {
    it('cascades User -> Source and User -> Transaction when the parent user is deleted', async () => {
      const file = freshDatabaseFile()
      const service = new LocalPrismaService(file)
      await service.onModuleInit()

      try {
        const user = await service.user.create({
          data: { email: 'parent@example.com', username: 'parent', passwordHash: 'hash' },
        })
        const source = await service.source.create({
          data: { userId: user.id, name: 'Wallet', type: 'MANUAL' },
        })
        await service.transaction.create({
          data: {
            userId: user.id,
            sourceId: source.id,
            kind: 'EXPENSE',
            amountCents: 1000,
            description: 'Coffee',
            occurredAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        })

        expect(await service.source.count()).toBe(1)
        expect(await service.transaction.count()).toBe(1)

        await service.user.delete({ where: { id: user.id } })

        expect(await service.source.count()).toBe(0)
        expect(await service.transaction.count()).toBe(0)
      } finally {
        await service.onModuleDestroy()
      }
    })
  })
})
