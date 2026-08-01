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

// A fixed stand-in for `resolveProfileAiKeyEncryptionSecret()`'s output --
// same reasoning as `TEST_SESSION_TOKEN` above: this suite is not testing
// secret resolution or migration itself (see `profile-secret.spec.ts` for
// that), only that `AppLocalModule.forRoot` accepts *some* usable value and
// wires it through to `AiKeyCrypto` via `ConfigService`.
const TEST_AI_KEY_ENCRYPTION_SECRET = 'app-local-module-spec-fixed-ai-key-encryption-secret'

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
        imports: [
          AppLocalModule.forRoot({
            databaseFile: file,
            sessionToken: TEST_SESSION_TOKEN,
            aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
          }),
        ],
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
          imports: [
            AppLocalModule.forRoot({
              databaseFile: file,
              sessionToken: TEST_SESSION_TOKEN,
              aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
            }),
          ],
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
        imports: [
          AppLocalModule.forRoot({
            databaseFile: file,
            sessionToken: TEST_SESSION_TOKEN,
            aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
          }),
        ],
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

  describe('sessionToken validation: refuses to compose without a usable token', () => {
    // `AppLocalModuleOptions.sessionToken` is typed `string`, so these cast
    // around the type checker on purpose -- the whole point is proving what
    // happens with the exact runtime values a JS caller (or anything that
    // skips the type checker) could actually pass, not what TypeScript
    // would otherwise reject at compile time. `databaseFile` points at a
    // path that is never touched: `forRoot` is synchronous and validates
    // the token as its first statement, before building the `DynamicModule`
    // that would eventually reference this path -- these tests exist to
    // prove exactly that ordering, so a nonexistent file is deliberate, not
    // an oversight.
    const irrelevantDatabaseFile = join(ROOT, 'sessionToken-validation', 'never-touched.db')

    it('throws synchronously (does not even reach Test.createTestingModule) on an empty token', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: '',
          aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
        }),
      ).toThrow(/non-empty, non-whitespace string/)
    })

    it('throws on a whitespace-only token', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: '   ',
          aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
        }),
      ).toThrow(/non-empty, non-whitespace string/)
    })

    it('throws on undefined rather than letting it reach the guard as a request-time 500', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: undefined as unknown as string,
          aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
        }),
      ).toThrow(/non-empty, non-whitespace string/)
    })

    it('throws on a non-string value, naming its type but never echoing it', () => {
      let thrown: Error | undefined
      try {
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: 987654321 as unknown as string,
          aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
        })
      } catch (error) {
        thrown = error as Error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(thrown?.message).toContain('non-empty, non-whitespace string')
      expect(thrown?.message).not.toContain('987654321')
    })

    it('still composes normally with a valid token (no regression)', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: TEST_SESSION_TOKEN,
          aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
        }),
      ).not.toThrow()
    })
  })

  describe('aiKeyEncryptionSecret validation: refuses to compose without a usable secret', () => {
    // Mirrors the `sessionToken validation` block above exactly --
    // `assertUsableAiKeyEncryptionSecret` follows `assertUsableSessionToken`'s
    // precedent on purpose (see `profile-secret.ts`). Same reasoning for
    // casting around the type checker and for `irrelevantDatabaseFile` never
    // being touched: `forRoot` validates both the token and the secret as
    // its first two statements, before anything that would reference this
    // path exists.
    const irrelevantDatabaseFile = join(ROOT, 'aiKeyEncryptionSecret-validation', 'never-touched.db')

    it('throws synchronously on an empty secret', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: TEST_SESSION_TOKEN,
          aiKeyEncryptionSecret: '',
        }),
      ).toThrow(/AI key encryption secret/)
    })

    it('throws on a whitespace-only secret', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: TEST_SESSION_TOKEN,
          aiKeyEncryptionSecret: '   ',
        }),
      ).toThrow(/AI key encryption secret/)
    })

    it('throws on undefined rather than letting it reach AiKeyCrypto\'s constructor as a raw DI error', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: TEST_SESSION_TOKEN,
          aiKeyEncryptionSecret: undefined as unknown as string,
        }),
      ).toThrow(/AI key encryption secret/)
    })

    it('throws on a non-string value, naming its type but never echoing it', () => {
      let thrown: Error | undefined
      try {
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: TEST_SESSION_TOKEN,
          aiKeyEncryptionSecret: 123456789 as unknown as string,
        })
      } catch (error) {
        thrown = error as Error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(thrown?.message).toContain('AI key encryption secret')
      expect(thrown?.message).not.toContain('123456789')
    })

    it('still composes normally with a valid secret (no regression)', () => {
      expect(() =>
        AppLocalModule.forRoot({
          databaseFile: irrelevantDatabaseFile,
          sessionToken: TEST_SESSION_TOKEN,
          aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
        }),
      ).not.toThrow()
    })
  })
})
