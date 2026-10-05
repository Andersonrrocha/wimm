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
import { AI_PROVIDERS, AiProviderRegistry } from '../ai-provider.registry'
import { CHATGPT_OPEN_BROWSER } from './chatgpt-connect-flow'
import type { AiProvider } from '../ai-provider.interface'
import { AnthropicCategorizerService } from '../anthropic-categorizer.service'
import { ChatGptConnectFlow } from './chatgpt-connect-flow'
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

/**
 * A valid OIDC discovery document, so the connect flow gets as far as opening
 * a browser. Only the issuer is pinned in production; everything else is
 * discovered, and `discoverOidcConfig` rejects a document whose own issuer
 * does not match.
 */
const discovery = () =>
  new Response(
    JSON.stringify({
      issuer: 'https://auth.openai.com',
      authorization_endpoint: 'https://auth.openai.com/authorize',
      token_endpoint: 'https://auth.openai.com/oauth/token',
      jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
      revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
    }),
    { status: 200 },
  )

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
  /**
   * The composition's opener. The test below proves THIS one reaches the flow.
   *
   * It records and then throws, for two reasons: the flow would otherwise sit
   * on the listener's five-minute default waiting for a callback no browser
   * is going to deliver, and a throwing opener is itself a path worth
   * covering -- `shell.openExternal` rejects when there is no registered
   * handler, which on a bare Linux box is the normal case.
   */
  const opened: string[] = []
  const openBrowser = async (url: string): Promise<void> => {
    opened.push(url)
    throw new Error('no browser in this test environment')
  }

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

    // Stands in for `AppLocalModule`, which is what publishes these in the
    // real composition. Note `exports` as well as `@Global()`: global puts a
    // module into every import set, `exports` is what makes one of its tokens
    // resolvable across the boundary, and Nest needs both. Omitting the
    // export of `CHATGPT_OPEN_BROWSER` is exactly the defect review found in
    // `app.local.module.ts` -- with the injection optional it was invisible,
    // and every connect refused for want of an opener while the whole suite
    // stayed green.
    @Global()
    @Module({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: CHATGPT_OPEN_BROWSER, useValue: openBrowser },
      ],
      exports: [PrismaService, CHATGPT_OPEN_BROWSER],
    })
    class TestRootModule {}

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ AI_KEY_ENCRYPTION_SECRET: secret })],
        }),
        TestRootModule,
        LocalOnlyAiModule,
      ],
    }).compile()

    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('.well-known/openid-configuration')
          ? discovery()
          : answer(),
      )
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

    it('carries every hosted provider, not just the one named here', () => {
      // The two lists share `buildAiProviders`, so a hosted provider added
      // THERE reaches both. Nothing stops one being registered directly in
      // `AiModule`'s own `providers` array, though, and the local list would
      // then silently drop it -- and the test above only ever checks
      // `'anthropic'` by name. This holds whatever is added, to either.
      const idsIn = (module: Parameters<typeof moduleRef.select>[0]) =>
        (
          moduleRef.select(module).get<AiProvider[]>(AI_PROVIDERS, {
            strict: true,
          }) ?? []
        )
          .map((provider) => provider.id)
          .sort()

      const hosted = idsIn(AiModule)
      const local = idsIn(LocalOnlyAiModule)

      expect(hosted.length).toBeGreaterThan(0)
      expect(local).toEqual([...hosted, 'chatgpt-oauth'].sort())
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

  describe('the connect flow', () => {
    it("receives the composition root's own browser opener", async () => {
      // THE test the Critical needed. Its predecessor asserted that a flow
      // with no opener refuses -- true, but it was passing for the wrong
      // reason: the token was published without being exported, the
      // injection was optional, so the flow silently got `null` and refused
      // in every composition including the real one. Resolving the token
      // directly would not have caught it either: `get` is non-strict by
      // default and finds the provider inside the root's own injector,
      // proving only that it was published.
      //
      // So assert on the FLOW, strictly resolved from this module, actually
      // calling through to the opener the root supplied.
      const flow = inLocal(ChatGptConnectFlow)
      opened.length = 0

      // It gets far enough to open a browser, which is all this proves. The
      // opener then throws, so the attempt ends there rather than waiting
      // out the listener.
      await expect(flow.connect(userId)).rejects.toThrow(/no browser/)

      expect(opened).toHaveLength(1)
      expect(opened[0]).toContain('auth.openai.com')
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
