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
import { AiCategorizationMode, SourceType } from '@wimm/shared'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import type { AddressInfo } from 'node:net'
import { join } from 'path'
// `@types/better-sqlite3` uses `export =`, same reasoning as
// open-local-database.ts: import-equals is required for the runtime value
// (not just the type) to resolve.
import Database = require('better-sqlite3')
import { AppLocalModule } from './app.local.module'
import {
  ChatGptConnectFlow,
} from './ai/local-only/chatgpt-connect-flow'
import { ChatGptConnectionStore } from './ai/local-only/chatgpt-connection.store'
import { LocalOnlyAiModule } from './ai/local-only/local-only-ai.module'
import { ImportsService } from './imports/imports.service'
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

// Upper-case and hyphenated so it cannot be a substring of ordinary text, and
// so an assertion on the Authorization header is about this exact value.
const ACCESS_TOKEN = 'SENTINEL-IMPORT-ROUTING-ACCESS-4f91ad'

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

/** Runs `work` against the profile's database over a throwaway connection,
 * so a test can seed or inspect rows without going through the booted
 * composition's own client. */
async function onProfile<T>(
  file: string,
  work: (prisma: LocalPrismaService) => Promise<T>,
): Promise<T> {
  const seeding = new LocalPrismaService(file)
  await seeding.onModuleInit()
  try {
    return await work(seeding)
  } finally {
    await seeding.onModuleDestroy()
  }
}

/** Inserts the single `User` row `ActiveProfileService` requires, through
 * Prisma itself (a throwaway `LocalPrismaService` connection), so
 * `createdAt`/`updatedAt` are populated the same way the real app would. */
async function seedUser(file: string, email: string, username: string): Promise<string> {
  return onProfile(file, async (prisma) => {
    const id = randomUUID()
    await prisma.user.create({ data: { id, email, username, passwordHash: 'irrelevant-hash' } })
    return id
  })
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

    it("hands its openBrowser option to the connect flow in LocalOnlyAiModule", async () => {
      // The one test that catches a missing `exports` entry. `global: true`
      // puts this module into every import set; `exports` is what makes one
      // of its tokens resolvable ACROSS the boundary, and Nest needs both.
      // Without the export, `ChatGptConnectFlow` was built with a null opener
      // and every connect refused -- while the whole suite stayed green,
      // because the only other test of this wiring supplies its own root
      // module which does export the token. So this one has to boot the
      // REAL `AppLocalModule`.
      const file = freshDatabaseFile('open-browser-wiring')
      const userId = await seedUser(file, 'opener@example.com', 'opener')

      const opened: string[] = []
      const moduleRef = await Test.createTestingModule({
        imports: [
          AppLocalModule.forRoot({
            databaseFile: file,
            sessionToken: TEST_SESSION_TOKEN,
            aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
            openBrowser: async (url: string) => {
              opened.push(url)
              // Ends the attempt here rather than waiting out the listener's
              // five-minute default for a callback no browser will deliver.
              throw new Error('no browser in this test environment')
            },
          }),
        ],
      }).compile()

      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) =>
          String(input).includes('.well-known/openid-configuration')
            ? new Response(
                JSON.stringify({
                  issuer: 'https://auth.openai.com',
                  authorization_endpoint: 'https://auth.openai.com/authorize',
                  token_endpoint: 'https://auth.openai.com/oauth/token',
                  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
                  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
                }),
                { status: 200 },
              )
            : new Response('{}', { status: 500 }),
        )

      try {
        // Strictly from the consuming module: a non-strict resolve would
        // search the whole container and find the root's own copy, proving
        // only that the option was published.
        const flow = moduleRef
          .select(LocalOnlyAiModule)
          .get(ChatGptConnectFlow, { strict: true })

        await expect(flow.connect(userId)).rejects.toThrow(/no browser/)

        expect(opened).toHaveLength(1)
        expect(opened[0]).toContain('auth.openai.com/authorize')
      } finally {
        fetchSpy.mockRestore()
        await moduleRef.close()
      }
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

  /**
   * THE test this whole change exists for.
   *
   * Tasks 1-12 built the ChatGPT connection and never wired it to
   * categorization, and the shape of the defect is why this test is here and
   * not somewhere cheaper. `LocalOnlyAiModule` used to build its own
   * `AiProviderRegistry`; `ImportsModule` imports `AiModule`, and Nest
   * resolves a token through the injecting module's own import list, so the
   * import path got `AiModule`'s Anthropic-only registry in every
   * composition. A spec that fetched the local registry by hand saw
   * `'chatgpt-oauth'` in it and passed over a dead feature.
   *
   * So this asserts through `ImportsService`, over the real
   * `AppLocalModule` -- the real selector, the real registry instance
   * production resolves, the real connection store and the real provider.
   * The only double is `fetch`. Mutate the registration out of
   * `LocalOnlyAiModule.onModuleInit` and this fails; nothing else in the
   * suite does.
   */
  describe('an import preview reaches the local-only AI provider', () => {
    // Two rows, no saved CSV mapping, no rules: both reach the AI pass.
    const csvBody = [
      'Data;Descricao;Valor',
      '01/04/2026;Mercado Livre;-123,45',
      '02/04/2026;Posto Shell;-50,00',
    ].join('\n')

    const csvFile = () =>
      ({
        originalname: 'extrato.csv',
        buffer: Buffer.from(csvBody, 'utf8'),
      }) as Express.Multer.File

    it("categorizes through the user's connected ChatGPT plan when that is their only credential", async () => {
      const file = freshDatabaseFile('ai-import-routing')
      const userId = await seedUser(file, 'byok@example.com', 'byok')

      const sourceId = await onProfile(file, async (prisma) => {
        // BYOK and NO `aiApiKeyEncrypted`: `AiKeyResolverService` resolves
        // nothing, so the Anthropic provider reports no credential and the
        // ChatGPT plan is the single available source -- used without asking.
        await prisma.user.update({
          where: { id: userId },
          data: { aiCategorizationMode: AiCategorizationMode.BYOK },
        })

        // Written with the same profile secret the module is composed with,
        // through the real store, so the provider has to decrypt it.
        await new ChatGptConnectionStore(
          prisma as unknown as PrismaService,
          TEST_AI_KEY_ENCRYPTION_SECRET,
        ).save(userId, 'client-1', {
          accessToken: ACCESS_TOKEN,
          refreshToken: 'spec-refresh-token',
          idToken: 'spec-id-token',
          // Comfortably outside the refresh service's expiry skew, so no
          // rotation is attempted and the stubbed fetch sees exactly one call.
          expiresAt: new Date(Date.now() + 3_600_000),
          scopes: 'openid offline_access chatgpt.tokens.use.direct',
          subject: 'sub-1',
          sharing: true,
        })

        const source = await prisma.source.create({
          data: { userId, name: 'Cartao', type: SourceType.CREDIT_CARD, closingDay: 5, dueDay: 12 },
        })
        return source.id
      })

      const moduleRef = await Test.createTestingModule({
        imports: [
          AppLocalModule.forRoot({
            databaseFile: file,
            sessionToken: TEST_SESSION_TOKEN,
            aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
            openBrowser: async () => undefined,
          }),
        ],
      }).compile()

      // `compile()` runs no lifecycle hook, and the local provider is
      // registered in `LocalOnlyAiModule.onModuleInit`. Production always
      // initializes (`app.init()` / `app.listen()`); without this the test
      // would be asserting about an application state that never ships.
      await moduleRef.init()

      const urls: string[] = []
      const authorizations: Array<string | null> = []
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input, init) => {
          urls.push(String(input))
          const request = init as RequestInit | undefined
          authorizations.push(new Headers(request?.headers).get('authorization'))
          // Answer with a candidate id taken from the prompt itself. A made-up
          // id would be dropped by `mapSuggestions`, so a suggestion arriving
          // on the row proves the real candidate list made the round trip.
          const prompt = String(JSON.parse(String(request?.body ?? '{}')).input ?? '')
          const categoryId = /^- ([^:\n]+): /m.exec(prompt)?.[1]
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                suggestions: [{ index: 0, categoryId, confidence: 0.95 }],
              }),
            }),
            { status: 200 },
          )
        })

      try {
        const preview = await moduleRef
          .get(ImportsService)
          .preview(userId, sourceId, csvFile())

        // The ChatGPT provider, and nothing else, was asked.
        expect(urls).toEqual(['https://api.openai.com/v1/responses'])
        expect(authorizations).toEqual([`Bearer ${ACCESS_TOKEN}`])

        // ...and its answer reached the preview row.
        expect(preview.rows).toHaveLength(2)
        expect(typeof preview.rows[0]!.aiSuggestedCategoryId).toBe('string')
        expect(preview.rows[0]!.aiConfidence).toBe(0.95)
      } finally {
        fetchSpy.mockRestore()
        await moduleRef.close()
      }
    })

    it('asks no provider at all for a user whose AI mode is OFF', async () => {
      const file = freshDatabaseFile('ai-import-routing-off')
      const userId = await seedUser(file, 'off@example.com', 'off')

      // Same connected plan, mode left at its OFF default: the mode gate in
      // `ImportsService` must still short-circuit ahead of selection.
      const sourceId = await onProfile(file, async (prisma) => {
        await new ChatGptConnectionStore(
          prisma as unknown as PrismaService,
          TEST_AI_KEY_ENCRYPTION_SECRET,
        ).save(userId, 'client-1', {
          accessToken: ACCESS_TOKEN,
          refreshToken: 'spec-refresh-token',
          idToken: 'spec-id-token',
          expiresAt: new Date(Date.now() + 3_600_000),
          scopes: 'openid offline_access chatgpt.tokens.use.direct',
          subject: 'sub-1',
          sharing: true,
        })
        const source = await prisma.source.create({
          data: { userId, name: 'Cartao', type: SourceType.CREDIT_CARD, closingDay: 5, dueDay: 12 },
        })
        return source.id
      })

      const moduleRef = await Test.createTestingModule({
        imports: [
          AppLocalModule.forRoot({
            databaseFile: file,
            sessionToken: TEST_SESSION_TOKEN,
            aiKeyEncryptionSecret: TEST_AI_KEY_ENCRYPTION_SECRET,
            openBrowser: async () => undefined,
          }),
        ],
      }).compile()
      await moduleRef.init()

      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => {
          throw new Error('no AI request should be made for an OFF user')
        })

      try {
        const preview = await moduleRef
          .get(ImportsService)
          .preview(userId, sourceId, csvFile())

        expect(fetchSpy).not.toHaveBeenCalled()
        expect(preview.rows).toHaveLength(2)
        expect(preview.rows[0]!.aiSuggestedCategoryId).toBeUndefined()
      } finally {
        fetchSpy.mockRestore()
        await moduleRef.close()
      }
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
