/**
 * Behavioral proof that the local composition root actually works, not just
 * that its DI graph resolves. Booting `AppLocalModule` and letting Nest
 * confirm every provider is satisfiable would prove nothing about whether
 * the one deliberate cast in `app.local.module.ts` (`PrismaService` ->
 * `LocalPrismaService`) is *sound* -- only real reads and writes, driven
 * through an actual feature service the way a controller would, can do that.
 *
 * Structure:
 *  - "a real read and a real write" boots the whole root against a fresh
 *    SQLite database built from the committed Phase 1 baseline, seeds the
 *    one `User` row `ActiveProfileService` requires, and drives
 *    `SourcesController` -> `SourcesService` -> Prisma over real HTTP: list
 *    (empty), create (persists), list again (reflects the write). Real
 *    enum values throughout (`SourceType.BANK_ACCOUNT`).
 *  - "mutation proof 1" proves the cast is load-bearing: swapping
 *    `PrismaService`'s provider for the real (Postgres-backed) class instead
 *    of the `LocalPrismaService` alias must break the module. `DATABASE_URL`
 *    is deliberately unset for this one test so the failure is deterministic
 *    and offline -- this suite must never attempt a real network connection.
 *  - "mutation proof 2" proves a write that violates a Phase 1 CHECK
 *    constraint (`Source_type_check` -- see `prisma/check-constraints.ts`)
 *    is rejected by SQLite itself through the real service, independent of
 *    the DTO's `@IsEnum` validation (deliberately bypassed here by calling
 *    the service directly with a raw invalid value).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { SourceType } from '@wimm/shared'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import type { AddressInfo } from 'node:net'
import { join } from 'path'
// `@types/better-sqlite3` uses `export =`, same reasoning as
// open-local-database.ts: import-equals is required for the runtime value
// (not just the type) to resolve.
import Database = require('better-sqlite3')
import { AppLocalModule } from './app.local.module'
import { LocalPrismaService } from './prisma/local/local-prisma.service'
import { PrismaService } from './prisma/prisma.service'
import { SESSION_TOKEN_HEADER } from './profile/session-token'
import type { CreateSourceDto } from './sources/dto/create-source.dto'
import { SourcesService } from './sources/sources.service'

const ROOT = '/tmp/wimm-app-local-module-spec'
const BASELINE = join(__dirname, '../prisma/migrations-sqlite/0000_baseline/migration.sql')

// A fixed stand-in for `generateSessionToken()`'s output. This suite is not
// testing the guard itself (see `session-token.guard.spec.ts` for that, and
// `local-route-posture.spec.ts` for the behavioral proof against a booted
// server) -- it only needs *some* value `AppLocalModule.forRoot` accepts and
// that the same suite's requests can present back, now that every route
// requires one.
const TEST_SESSION_TOKEN = 'app-local-module-spec-fixed-session-token'

/** Builds a fresh SQLite file with the real, committed Phase 1 baseline applied. */
function freshDatabaseFile(subdir: string): string {
  const dir = join(ROOT, subdir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

/** Inserts the single `User` row `ActiveProfileService` requires, through
 * Prisma itself (a throwaway `LocalPrismaService` connection), so
 * `createdAt`/`updatedAt` are populated the same way the real app would. */
async function seedUser(file: string, email: string, username: string): Promise<string> {
  const seeding = new LocalPrismaService(file)
  await seeding.onModuleInit()
  try {
    const id = randomUUID()
    await seeding.user.create({ data: { id, email, username, passwordHash: 'irrelevant-hash' } })
    return id
  } finally {
    await seeding.onModuleDestroy()
  }
}

describe('AppLocalModule (behavioral, boots the real local composition root)', () => {
  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  describe('a real read and a real write through SourcesService, via HTTP', () => {
    let app: INestApplication

    afterEach(async () => {
      if (app) await app.close()
    })

    it('lists empty, creates a real Source row, then lists it back', async () => {
      const file = freshDatabaseFile('happy-path')
      const userId = await seedUser(file, 'alice@example.com', 'alice')

      const moduleRef = await Test.createTestingModule({
        imports: [AppLocalModule.forRoot({ databaseFile: file, sessionToken: TEST_SESSION_TOKEN })],
      }).compile()

      app = moduleRef.createNestApplication({ logger: false })
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      )
      await app.init()
      const server = await app.listen(0, '127.0.0.1')
      const address = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${address.port}`

      // READ: a freshly onboarded profile has no sources yet. Every route
      // now requires `SessionTokenGuard`'s header (see app.local.module.ts),
      // so this and the requests below present the same fixed test token
      // `AppLocalModule.forRoot` was given above.
      const before = await fetch(`${baseUrl}/sources`, {
        headers: { [SESSION_TOKEN_HEADER]: TEST_SESSION_TOKEN },
      })
      expect(before.status).toBe(200)
      expect(await before.json()).toEqual([])

      // WRITE: a real INSERT, through SourcesController -> SourcesService ->
      // PrismaService (aliased to LocalPrismaService) -> SQLite.
      const created = await fetch(`${baseUrl}/sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SESSION_TOKEN_HEADER]: TEST_SESSION_TOKEN,
        },
        body: JSON.stringify({ name: 'Checking account', type: SourceType.BANK_ACCOUNT }),
      })
      expect(created.status).toBe(201)
      const createdBody = await created.json()
      expect(createdBody).toMatchObject({
        userId,
        name: 'Checking account',
        type: SourceType.BANK_ACCOUNT,
      })
      expect(typeof createdBody.id).toBe('string')

      // READ again: the write is visible through the same seam, proving
      // this is a real round trip and not two independent connections.
      const after = await fetch(`${baseUrl}/sources`, {
        headers: { [SESSION_TOKEN_HEADER]: TEST_SESSION_TOKEN },
      })
      expect(after.status).toBe(200)
      const afterBody = await after.json()
      expect(afterBody).toHaveLength(1)
      expect(afterBody[0].id).toBe(createdBody.id)
    })
  })

  describe('mutation proof 1: the PrismaService -> LocalPrismaService alias is load-bearing', () => {
    it('fails to boot when PrismaService is provided by the real (Postgres) class instead', async () => {
      const file = freshDatabaseFile('mutation-1')

      // Deliberately unset, regardless of the ambient shell or
      // `apps/api/.env` -- if DATABASE_URL happened to be set to a reachable
      // Postgres here, this would instead attempt a real network connection,
      // which this suite must never do. Restored in `finally`.
      const previousDatabaseUrl = process.env.DATABASE_URL
      delete process.env.DATABASE_URL

      try {
        const moduleBuilder = Test.createTestingModule({
          imports: [AppLocalModule.forRoot({ databaseFile: file, sessionToken: TEST_SESSION_TOKEN })],
        })
          .overrideProvider(PrismaService)
          .useClass(PrismaService)

        await expect(moduleBuilder.compile()).rejects.toThrow('DATABASE_URL is not set')
      } finally {
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl
        }
      }
    })
  })

  describe('mutation proof 2: SQLite enforces the Phase 1 CHECK constraints for real writes', () => {
    it('rejects a Source.type value outside BANK_ACCOUNT | CREDIT_CARD | CASH | MANUAL (Source_type_check)', async () => {
      const file = freshDatabaseFile('mutation-2')
      const userId = await seedUser(file, 'carol@example.com', 'carol')

      const moduleRef = await Test.createTestingModule({
        imports: [AppLocalModule.forRoot({ databaseFile: file, sessionToken: TEST_SESSION_TOKEN })],
      }).compile()

      try {
        const sourcesService = moduleRef.get(SourcesService)

        // Bypasses the controller's `@IsEnum(SourceType)` DTO validation on
        // purpose -- that is a class-validator concern, not what this test
        // proves. This shows SQLite's own CHECK constraint rejects the value
        // independent of any HTTP-layer validation, through the real
        // service the cast resolves to.
        await expect(
          sourcesService.createForUser(userId, {
            name: 'Bad source',
            type: 'GARBAGE' as unknown as SourceType,
          } as CreateSourceDto),
        ).rejects.toThrow('CHECK constraint failed: type')
      } finally {
        await moduleRef.close()
      }
    })
  })
})
