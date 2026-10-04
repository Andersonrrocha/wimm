import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
// `@types/better-sqlite3` uses `export =`; import-equals is required for the
// runtime value to resolve, same as the connection store's spec.
import Database = require('better-sqlite3')
import { LocalPrismaService } from '../../prisma/local/local-prisma.service'
import { generateAiKeyEncryptionSecret } from '../../prisma/local/profile-secret'
import { PrismaService } from '../../prisma/prisma.service'
import { AiModule } from '../ai.module'
import { AiProviderRegistry } from '../ai-provider.registry'
import { AnthropicCategorizerService } from '../anthropic-categorizer.service'
import { ChatGptConnectionStore } from './chatgpt-connection.store'
import { ChatGptOAuthProvider } from './chatgpt-oauth-provider'
import type { ChatGptCredentials } from './chatgpt-token-exchange'
import { LocalOnlyAiModule } from './local-only-ai.module'

const ROOT = '/tmp/wimm-local-only-ai-module-spec'
const BASELINE = join(
  __dirname,
  '../../../prisma/migrations-sqlite/0000_baseline/migration.sql',
)

function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

// Upper-case, hyphenated and long: cannot be a substring of ordinary text.
const ACCESS = 'SENTINEL-WIRED-ACCESS-3d8e51'

const credentials = (
  overrides: Partial<ChatGptCredentials> = {},
): ChatGptCredentials => ({
  accessToken: ACCESS,
  refreshToken: 'SENTINEL-WIRED-REFRESH-90ab2c',
  idToken: 'SENTINEL-WIRED-ID-71f3d6',
  expiresAt: new Date(Date.now() + 3_600_000),
  scopes: 'openid offline_access chatgpt.tokens.use.direct',
  subject: 'sub-1',
  sharing: true,
  ...overrides,
})

const transactions = [{ index: 0, description: 'Mercado Livre', amount: '1.00' }]
const candidates = [{ id: 'cat-groceries', name: 'Groceries' }]

const answer = () =>
  new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        suggestions: [{ index: 0, categoryId: 'cat-groceries', confidence: 0.9 }],
      }),
    }),
    { status: 200 },
  )

/**
 * Boots `LocalOnlyAiModule` the way `AppLocalModule` does -- a global
 * `ConfigService` carrying the profile secret under `AI_KEY_ENCRYPTION_SECRET`,
 * and a global `PrismaService` -- over a real SQLite database. The DI graph
 * resolving proves little on its own; what these specs prove is that what the
 * factories were handed is what comes out the other end.
 */
describe('LocalOnlyAiModule (wired)', () => {
  // The profile's secret, as `AppLocalModule.forRoot` receives it. Generated,
  // not hardcoded, so nothing in the module can accidentally be satisfied by
  // a literal that happens to match.
  const secret = generateAiKeyEncryptionSecret()
  let prisma: LocalPrismaService
  let moduleRef: TestingModule
  let userId: string
  let fetchSpy: jest.SpyInstance

  /**
   * `strict: true` is load-bearing. `get` is non-strict by default, which
   * searches every module and returns the first match -- and
   * `AiProviderRegistry` exists twice here, once per module, so a non-strict
   * lookup answers with `AiModule`'s and a test of this module's would be
   * silently asserting about the other one.
   */
  const inLocal = <T>(token: new (...args: any[]) => T): T =>
    moduleRef.select(LocalOnlyAiModule).get(token, { strict: true })
  const inAi = <T>(token: new (...args: any[]) => T): T =>
    moduleRef.select(AiModule).get(token, { strict: true })

  /** A store built by hand over the same database, with a secret of the test's choosing. */
  const storeWith = (withSecret: string) =>
    new ChatGptConnectionStore(prisma as unknown as PrismaService, withSecret)

  beforeEach(async () => {
    prisma = new LocalPrismaService(freshDatabaseFile())
    await prisma.onModuleInit()
    userId = randomUUID()
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        username: userId,
        passwordHash: 'irrelevant-hash',
      },
    })

    @Global()
    @Module({
      providers: [{ provide: PrismaService, useValue: prisma }],
      exports: [PrismaService],
    })
    class TestPrismaModule {}

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ AI_KEY_ENCRYPTION_SECRET: secret })],
        }),
        TestPrismaModule,
        LocalOnlyAiModule,
      ],
    }).compile()

    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => answer())
  })

  afterEach(async () => {
    fetchSpy.mockRestore()
    await moduleRef.close()
    await prisma.onModuleDestroy()
  })

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  describe('the provider list', () => {
    it("registers the real ChatGPT provider under 'chatgpt-oauth'", () => {
      const provider = inLocal(ChatGptOAuthProvider)

      expect(provider).toBeInstanceOf(ChatGptOAuthProvider)
      expect(provider.id).toBe('chatgpt-oauth')
      expect(inLocal(AiProviderRegistry).get('chatgpt-oauth')).toBe(provider)
    })

    it('keeps the hosted providers in the list beside it', () => {
      const registry = inLocal(AiProviderRegistry)

      expect(registry.get('anthropic')).toBeInstanceOf(AnthropicCategorizerService)
      expect(registry.get('anthropic')).toBe(inAi(AnthropicCategorizerService))
    })

    // The hosted list is `AiModule`'s own, and `AiModule` is reachable from
    // the hosted root. If the ChatGPT provider ever showed up there, the
    // licensing boundary would be breached through DI instead of through an
    // import, and the composition guard would not see it.
    it("leaves AiModule's own registry without it", () => {
      const hosted = inAi(AiProviderRegistry)

      expect(hosted.get('anthropic')).toBeDefined()
      expect(hosted.has('chatgpt-oauth')).toBe(false)
    })
  })

  describe('the connection store', () => {
    it("is keyed by the profile's secret from ConfigService, not by anything else", async () => {
      // Written by a store this test built with the profile's secret, read by
      // the one the module built. Only a module that took the secret from
      // `AI_KEY_ENCRYPTION_SECRET` can read it back.
      await storeWith(secret).save(userId, 'client-1', credentials())

      const status = await inLocal(ChatGptConnectionStore).status(userId)

      expect(status.connected).toBe(true)
      expect(status.sharing).toBe(true)
    })

    it('cannot read a connection written under a different secret', async () => {
      await storeWith(generateAiKeyEncryptionSecret()).save(
        userId,
        'client-1',
        credentials(),
      )

      const status = await inLocal(ChatGptConnectionStore).status(userId)

      expect(status.connected).toBe(false)
    })
  })

  describe('the provider, end to end through the real collaborators', () => {
    const run = () =>
      inLocal(ChatGptOAuthProvider).categorizeBatch({
        userId,
        transactions,
        candidates,
      })

    it('categorizes with the access token the store holds', async () => {
      await storeWith(secret).save(userId, 'client-1', credentials())

      const results = await run()

      expect(results).toEqual([
        { index: 0, categoryId: 'cat-groceries', confidence: 0.9 },
      ])
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe('https://api.openai.com/v1/responses')
      expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(
        `Bearer ${ACCESS}`,
      )
      expect(JSON.parse(String((init as RequestInit).body)).store).toBe(false)
    })

    it('returns [] and calls nothing when there is no connection', async () => {
      expect(await run()).toEqual([])
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('returns [] and calls nothing when the plan does not grant sharing', async () => {
      await storeWith(secret).save(
        userId,
        'client-1',
        credentials({ sharing: false }),
      )

      expect(await run()).toEqual([])
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('returns [] and calls nothing for a profile whose tokens it cannot decrypt', async () => {
      await storeWith(generateAiKeyEncryptionSecret()).save(
        userId,
        'client-1',
        credentials(),
      )

      expect(await run()).toEqual([])
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
