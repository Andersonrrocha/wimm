/**
 * `ChatGptConnectFlow`, over a real SQLite database with a real
 * `ChatGptConnectionStore` and the real `createAuthorizeRequest`.
 *
 * Only what reaches the outside world is doubled: OIDC discovery, the
 * loopback listener, the token exchange, and the browser. Everything the
 * flow actually decides -- the order of the sequence, which client ID it
 * sends, what it persists, and the AI consent mode -- is therefore asserted
 * against real behaviour rather than against a mock's memory.
 *
 * **The browser/arm race is forced, not hoped for.** `openBrowser` delivers
 * the callback synchronously, the way a browser that is already signed in
 * does, and refuses if nothing has armed `awaitCallback` yet. "Open, then
 * arm" fails here with that message instead of passing because the suite
 * happened to be sequential.
 */
import { ForbiddenException, RequestTimeoutException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AiCategorizationMode } from '@wimm/shared'
// `@types/better-sqlite3` uses `export =`; import-equals is required for the
// runtime value to resolve, same as the connection store's spec.
import Database = require('better-sqlite3')
import { LocalPrismaService } from '../../prisma/local/local-prisma.service'
import { generateAiKeyEncryptionSecret } from '../../prisma/local/profile-secret'
import { PrismaService } from '../../prisma/prisma.service'
import {
  createAuthorizeRequest,
  type AuthorizeRequest,
} from './chatgpt-authorize'
import {
  ChatGptSignInDeniedError,
  ChatGptSignInTimedOutError,
  type CallbackListener,
  type CallbackResult,
} from './chatgpt-callback-listener'
import {
  CHATGPT_SIGN_IN_TIMED_OUT_CODE,
  ChatGptConnectFlow,
} from './chatgpt-connect-flow'
import { ChatGptConnectionStore } from './chatgpt-connection.store'
import { DYNAMIC_CLIENT_ID, type OidcConfig } from './chatgpt-oidc'
import type { ChatGptExchange } from './chatgpt-token-exchange'

const ROOT = '/tmp/wimm-chatgpt-connect-flow-spec'
const BASELINE = join(
  __dirname,
  '../../../prisma/migrations-sqlite/0000_baseline/migration.sql',
)

/**
 * Sentinels that cannot occur by accident: upper-case, hyphenated and long.
 * `'at'` and `'rt'` are substrings of ordinary error text ("ChatGPT",
 * "match", "start") and would flag correct code.
 */
const SENTINEL = {
  accessToken: 'SENTINEL-FLOW-ACCESS-TOKEN-4c81ab',
  refreshToken: 'SENTINEL-FLOW-REFRESH-TOKEN-7d20fe',
  idToken: 'SENTINEL-FLOW-ID-TOKEN-b913c5',
  code: 'SENTINEL-FLOW-AUTH-CODE-e6a742',
}

/** Distinct from the callback's, so which one is used anywhere is visible. */
const STORED_CLIENT_ID = 'stored-client-7'
const CALLBACK_CLIENT_ID = 'callback-client-99'
const REDIRECT_URI = 'http://127.0.0.1:65123/auth/callback'
const LABEL = 'ada@example.com'

const config: OidcConfig = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}

function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

const exchanged = (
  overrides: Partial<ChatGptExchange> = {},
): ChatGptExchange => ({
  accessToken: SENTINEL.accessToken,
  refreshToken: SENTINEL.refreshToken,
  idToken: SENTINEL.idToken,
  expiresAt: new Date(Date.now() + 3_600_000),
  scopes: 'openid profile email offline_access chatgpt.tokens.use.direct',
  subject: 'sub-1',
  sharing: true,
  accountLabel: LABEL,
  ...overrides,
})

interface Harness {
  flow: ChatGptConnectFlow
  /** Every outward step, in the order the flow took it. */
  events: string[]
  /** What the listener was armed with, once it has been. */
  armedState: () => string | null
  /** The authorize request the real builder produced. */
  request: () => AuthorizeRequest
  /** What the exchange was called with. */
  exchangeArgs: () => Record<string, unknown> | null
  listenerArgs: () => unknown
  openedUrl: () => string | null
  /** The `fetchImpl` the flow handed to discovery, once it has. */
  discoverFetch: () => typeof fetch | undefined
}

describe('ChatGptConnectFlow', () => {
  let prisma: LocalPrismaService
  let store: ChatGptConnectionStore
  let userId: string
  const secret = generateAiKeyEncryptionSecret()

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
    // The two generated Prisma clients are branded per provider, so
    // `LocalPrismaService` is not assignable to `PrismaService` even though
    // `AppLocalModule` aliases one to the other at runtime -- the same seam,
    // and the same cast, as the store's own spec.
    store = new ChatGptConnectionStore(
      prisma as unknown as PrismaService,
      secret,
    )
  })

  afterEach(async () => {
    await prisma.onModuleDestroy()
  })

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  const mode = async (): Promise<string> =>
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { aiCategorizationMode: true },
      })
    ).aiCategorizationMode

  const label = async (): Promise<string | null> =>
    (
      await prisma.chatGptConnection.findUniqueOrThrow({
        where: { userId },
        select: { accountLabel: true },
      })
    ).accountLabel

  /**
   * Builds the flow with doubles that record. `onBrowserOpen` decides what
   * the browser's redirect does: by default it delivers a valid callback
   * **while `openBrowser` is still running**, which is what forces the
   * arm-before-open ordering to matter.
   */
  function harness(
    options: {
      exchange?: () => Promise<ChatGptExchange>
      onBrowserOpen?: (
        deliver: (result: CallbackResult) => void,
        refuse: (error: unknown) => void,
      ) => void
      openBrowser?: null
      discover?: (fetchImpl?: typeof fetch) => Promise<OidcConfig>
      timeoutMs?: number
      fetchImpl?: typeof fetch
      requestTimeoutMs?: number
    } = {},
  ): Harness {
    const events: string[] = []
    let armedState: string | null = null
    let request: AuthorizeRequest | null = null
    let exchangeArgs: Record<string, unknown> | null = null
    let listenerArgs: unknown
    let openedUrl: string | null = null
    let deliver: ((result: CallbackResult) => void) | null = null
    let refuse: ((error: unknown) => void) | null = null
    let discoverFetch: typeof fetch | undefined

    const listener: CallbackListener = {
      redirectUri: REDIRECT_URI,
      awaitCallback(expectedState: string) {
        events.push('awaitCallback')
        armedState = expectedState
        const pending = new Promise<CallbackResult>((resolve, reject) => {
          deliver = resolve
          refuse = reject
        })
        // The real listener attaches its own silent handler for a caller
        // that never awaits this (`result.catch(() => undefined)`); without
        // the same here, a failure between arming and awaiting becomes an
        // unhandled rejection that kills an unrelated test.
        pending.catch(() => undefined)
        return pending
      },
      close() {
        events.push('close')
      },
    }

    const flow = new ChatGptConnectFlow({
      store,
      prisma: prisma as unknown as PrismaService,
      discover:
        options.discover ??
        ((fetchImpl) => {
          events.push('discover')
          discoverFetch = fetchImpl
          return Promise.resolve(config)
        }),
      startListener: async (args) => {
        events.push('startListener')
        listenerArgs = args
        return listener
      },
      createRequest: (args) => {
        events.push('createRequest')
        // The REAL builder: what the URL carries is then a fact about the
        // production code path, not about this double.
        request = createAuthorizeRequest(args)
        return request
      },
      exchange: async (args) => {
        events.push('exchange')
        exchangeArgs = args as unknown as Record<string, unknown>
        return options.exchange === undefined
          ? exchanged()
          : await options.exchange()
      },
      openBrowser:
        options.openBrowser === null
          ? null
          : async (url) => {
              events.push('openBrowser')
              openedUrl = url
              if (deliver === null || refuse === null) {
                throw new Error(
                  'the browser was opened before awaitCallback was armed',
                )
              }
              const onOpen =
                options.onBrowserOpen ??
                ((ok) =>
                  ok({
                    code: SENTINEL.code,
                    clientId: CALLBACK_CLIENT_ID,
                  }))
              onOpen(deliver, refuse)
            },
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      requestTimeoutMs: options.requestTimeoutMs,
    })

    return {
      flow,
      events,
      discoverFetch: () => discoverFetch,
      armedState: () => armedState,
      request: () => {
        if (request === null) throw new Error('no authorize request was built')
        return request
      },
      exchangeArgs: () => exchangeArgs,
      listenerArgs: () => listenerArgs,
      openedUrl: () => openedUrl,
    }
  }

  /** Awaits a promise and returns what it rejected with, or `null`. */
  const rejection = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => null,
      (error: unknown) => error,
    )

  const paramsOf = (url: string): URLSearchParams =>
    new URL(url).searchParams

  describe('the sequence', () => {
    it('binds, builds, arms, opens, exchanges -- and closes last', async () => {
      const h = harness()

      await h.flow.connect(userId)

      // Every ordering constraint in one assertion: the listener is bound
      // before the request is built (the request needs its redirect URI),
      // the wait is armed before the browser is opened, and the port is
      // released at the end.
      expect(h.events).toEqual([
        'discover',
        'startListener',
        'createRequest',
        'awaitCallback',
        'openBrowser',
        'exchange',
        'close',
      ])
    })

    it('builds the authorize request against the bound listener’s redirect URI', async () => {
      const h = harness()

      await h.flow.connect(userId)

      expect(paramsOf(h.openedUrl() as string).get('redirect_uri')).toBe(
        REDIRECT_URI,
      )
      expect(h.exchangeArgs()).toMatchObject({ redirectUri: REDIRECT_URI })
    })

    it('arms the listener with the state it put in the URL', async () => {
      const h = harness()

      await h.flow.connect(userId)

      const state = paramsOf(h.openedUrl() as string).get('state')
      expect(state).toBeTruthy()
      expect(h.armedState()).toBe(state)
    })

    it('redeems the verifier whose challenge it published, and the nonce it sent', async () => {
      const h = harness()

      await h.flow.connect(userId)

      const params = paramsOf(h.openedUrl() as string)
      const verifier = h.exchangeArgs()?.verifier as string
      expect(verifier).toBeTruthy()
      // Proves the verifier belongs to the request the browser was sent to,
      // rather than merely being some string.
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
        params.get('code_challenge'),
      )
      expect(h.exchangeArgs()?.nonce).toBe(params.get('nonce'))
      expect(h.exchangeArgs()?.code).toBe(SENTINEL.code)
    })

    it('never puts the verifier in the URL the browser is given', async () => {
      const h = harness()

      await h.flow.connect(userId)

      expect(h.openedUrl()).not.toContain(h.request().verifier)
    })

    it('passes a configured timeout to the listener', async () => {
      const h = harness({ timeoutMs: 1234 })

      await h.flow.connect(userId)

      expect(h.listenerArgs()).toEqual({ timeoutMs: 1234 })
    })
  })

  describe('the durable client id', () => {
    it('reuses a stored one, and sends no agent_name_hint', async () => {
      await store.save(userId, STORED_CLIENT_ID, exchanged())
      const h = harness()

      await h.flow.connect(userId)

      const params = paramsOf(h.openedUrl() as string)
      expect(params.get('client_id')).toBe(STORED_CLIENT_ID)
      // Re-sending the hint would request a SECOND dynamic registration, and
      // a new client ID invalidates every identity stored under the old one.
      expect(params.has('agent_name_hint')).toBe(false)
    })

    it('registers afresh when there is none yet', async () => {
      const h = harness()

      await h.flow.connect(userId)

      const params = paramsOf(h.openedUrl() as string)
      expect(params.get('client_id')).toBe(DYNAMIC_CLIENT_ID)
      expect(params.get('agent_name_hint')).toBe('WIMM')
    })

    it('stores the client id the callback returned, not the one it sent', async () => {
      await store.save(userId, STORED_CLIENT_ID, exchanged())
      const h = harness()

      await h.flow.connect(userId)

      expect(h.exchangeArgs()?.clientId).toBe(CALLBACK_CLIENT_ID)
      await expect(store.loadClientId(userId)).resolves.toBe(
        CALLBACK_CLIENT_ID,
      )
    })
  })

  describe('what it persists', () => {
    it('stores the exchanged credentials under the profile’s secret', async () => {
      await harness().flow.connect(userId)

      const loaded = await store.load(userId)
      expect(loaded?.accessToken).toBe(SENTINEL.accessToken)
      expect(loaded?.refreshToken).toBe(SENTINEL.refreshToken)
      expect(loaded?.sharing).toBe(true)
    })

    it('writes the account label the verified identity carried', async () => {
      await harness().flow.connect(userId)

      await expect(label()).resolves.toBe(LABEL)
    })

    it('writes null rather than keeping a label from an earlier sign-in', async () => {
      await store.save(userId, STORED_CLIENT_ID, exchanged(), 'someone-else@example.com')
      const h = harness({
        exchange: async () => exchanged({ accountLabel: null }),
      })

      await h.flow.connect(userId)

      // The status must name the account that is actually connected. A label
      // left over from a different sign-in would be worse than none.
      await expect(label()).resolves.toBeNull()
    })

    it('returns the store’s own status, with no field a token could ride in', async () => {
      const status = await harness().flow.connect(userId)

      expect(Object.keys(status).sort()).toEqual([
        'accountLabel',
        'connected',
        'expiresAt',
        'sharing',
      ])
      expect(status).toMatchObject({
        connected: true,
        sharing: true,
        accountLabel: LABEL,
      })
      const serialized = JSON.stringify(status)
      for (const value of Object.values(SENTINEL)) {
        expect(serialized).not.toContain(value)
      }
    })
  })

  describe('the AI consent gate', () => {
    it('turns OFF into BYOK on a successful connect', async () => {
      // Without this, a user who connects ChatGPT and never visits the AI
      // settings is silently skipped by `ImportsService`, which gates on
      // this mode and defaults it to OFF.
      expect(await mode()).toBe(AiCategorizationMode.OFF)

      await harness().flow.connect(userId)

      expect(await mode()).toBe(AiCategorizationMode.BYOK)
    })

    it('leaves a mode the user already chose alone', async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { aiCategorizationMode: AiCategorizationMode.SERVER },
      })

      await harness().flow.connect(userId)

      expect(await mode()).toBe(AiCategorizationMode.SERVER)
    })

    it('leaves a deliberately chosen SERVER mode alone on disconnect', async () => {
      // `grantConsent` touches only a mode of `OFF`; `releaseConsent` used
      // not to, so disconnecting forced `OFF` over a mode the user had
      // chosen. `SERVER` is settable through `PATCH /users/me` and has a null
      // `aiApiKeyEncrypted` by design, so the other guard never fired.
      await prisma.user.update({
        where: { id: userId },
        data: { aiCategorizationMode: AiCategorizationMode.SERVER },
      })

      await harness().flow.disconnect(userId)

      expect(await mode()).toBe(AiCategorizationMode.SERVER)
    })

    it('changes nothing on disconnect when no connection ever existed', async () => {
      // The endpoint should be a no-op here, not a way to reach into another
      // setting. Any authenticated local caller could previously flip the
      // mode this way.
      await prisma.user.update({
        where: { id: userId },
        data: { aiCategorizationMode: AiCategorizationMode.SERVER },
      })

      await harness().flow.disconnect(userId)

      expect(await mode()).toBe(AiCategorizationMode.SERVER)
      await expect(
        prisma.chatGptConnection.findUnique({ where: { userId } }),
      ).resolves.toBeNull()
    })

    it('grants nothing when the sign-in fails', async () => {
      const h = harness({
        exchange: async () => {
          throw new Error('the token endpoint refused the grant')
        },
      })

      expect(await rejection(h.flow.connect(userId))).toBeInstanceOf(Error)

      expect(await mode()).toBe(AiCategorizationMode.OFF)
      await expect(store.status(userId)).resolves.toMatchObject({
        connected: false,
      })
    })

    it('returns the mode to OFF on disconnect', async () => {
      await harness().flow.connect(userId)
      expect(await mode()).toBe(AiCategorizationMode.BYOK)

      await harness().flow.disconnect(userId)

      expect(await mode()).toBe(AiCategorizationMode.OFF)
    })

    it('keeps the mode on disconnect while an Anthropic key remains', async () => {
      // A user may hold a BYOK Anthropic key AND a ChatGPT connection.
      // Dropping one must not switch AI off while the other credential is
      // still there.
      await harness().flow.connect(userId)
      await prisma.user.update({
        where: { id: userId },
        data: { aiApiKeyEncrypted: 'an-encrypted-anthropic-key' },
      })

      await harness().flow.disconnect(userId)

      expect(await mode()).toBe(AiCategorizationMode.BYOK)
    })
  })

  describe('disconnect', () => {
    it('drops every secret and reports disconnected', async () => {
      await harness().flow.connect(userId)

      const status = await harness().flow.disconnect(userId)

      expect(status).toMatchObject({ connected: false, sharing: false })
      await expect(store.load(userId)).resolves.toBeNull()
    })

    it('keeps the client id and the account label', async () => {
      await harness().flow.connect(userId)

      const status = await harness().flow.disconnect(userId)

      expect(status.accountLabel).toBe(LABEL)
      await expect(store.loadClientId(userId)).resolves.toBe(
        CALLBACK_CLIENT_ID,
      )
    })
  })

  // Minor 4. Discovery runs before the listener exists and the exchange runs
  // after the callback has stopped it, so the listener's five-minute budget
  // covers neither. Without this the one path a user sits and watches was the
  // one path bounded only by undici's defaults.
  describe('the network calls it makes', () => {
    it('bounds discovery and the exchange with an abort signal', async () => {
      const seen: Array<AbortSignal | null | undefined> = []
      const fetchImpl = (async (_input, init) => {
        seen.push(init?.signal)
        throw new Error('no request is actually sent in this spec')
      }) as typeof fetch

      const h = harness({ fetchImpl })
      await h.flow.connect(userId)

      const handed = h.discoverFetch()
      expect(handed).toBeDefined()
      // The flow must not hand its collaborators the bare function: both
      // `discoverOidcConfig` and `exchangeCode` apply their own default when
      // `fetchImpl` is absent, so an unwrapped (or undefined) one is exactly
      // how this path escaped every budget.
      expect(handed).not.toBe(fetchImpl)
      expect(h.exchangeArgs()).toMatchObject({ fetchImpl: handed })

      await expect(
        (handed as typeof fetch)('https://auth.openai.com/.well-known/openid-configuration'),
      ).rejects.toThrow(/no request is actually sent/)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toBeInstanceOf(AbortSignal)
    })

    // The wrap must still bound the process's own `fetch` when no double is
    // supplied -- `local-only-ai.module.ts` passes one, but the dep is
    // optional and "absent" must not mean "unbounded".
    it('bounds the default fetch too', async () => {
      const h = harness()
      await h.flow.connect(userId)

      expect(h.discoverFetch()).toBeDefined()
      expect(h.exchangeArgs()).toMatchObject({ fetchImpl: h.discoverFetch() })
    })

    it('aborts once the budget is spent', async () => {
      let captured: AbortSignal | null | undefined
      const fetchImpl = (async (_input, init) => {
        captured = init?.signal
        return new Promise<Response>(() => undefined)
      }) as typeof fetch

      const h = harness({ fetchImpl, requestTimeoutMs: 1 })
      await h.flow.connect(userId)

      void (h.discoverFetch() as typeof fetch)('https://auth.openai.com/')
      expect(captured).toBeInstanceOf(AbortSignal)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect((captured as AbortSignal).aborted).toBe(true)
    })
  })

  describe('when it fails', () => {
    it('frees the port when the exchange fails', async () => {
      const h = harness({
        exchange: async () => {
          throw new Error('the token endpoint refused the grant')
        },
      })

      expect(await rejection(h.flow.connect(userId))).toBeInstanceOf(Error)

      expect(h.events).toContain('close')
    })

    it('frees the port when the callback never validates', async () => {
      const h = harness({
        onBrowserOpen: (_ok, refuse) =>
          refuse(new Error('the callback carried no usable code')),
      })

      expect(await rejection(h.flow.connect(userId))).toBeInstanceOf(Error)

      expect(h.events).toContain('close')
    })

    it('tells a declined consent apart from a failure', async () => {
      const h = harness({
        onBrowserOpen: (_ok, refuse) => refuse(new ChatGptSignInDeniedError()),
      })

      const error = await rejection(h.flow.connect(userId))

      expect(error).toBeInstanceOf(ForbiddenException)
      expect((error as Error).message).toMatch(/declined/i)
      expect(h.events).toContain('close')
      await expect(store.status(userId)).resolves.toMatchObject({
        connected: false,
      })
    })

    // The most reachable failure in the feature, and the only one a user
    // causes by doing nothing: click Connect, close the tab, wait. As a plain
    // `Error` it became Nest's default 500 with no body `code`, and the
    // settings panel's generic failure message then told the user ChatGPT had
    // refused the request -- a claim about a party that was never heard from.
    it('answers a timed-out sign-in with a 408 carrying its own code', async () => {
      const h = harness({
        onBrowserOpen: (_ok, refuse) => refuse(new ChatGptSignInTimedOutError()),
      })

      const error = await rejection(h.flow.connect(userId))

      expect(error).toBeInstanceOf(RequestTimeoutException)
      expect((error as RequestTimeoutException).getStatus()).toBe(408)
      // The body, not the message: `readChatGptFailure` in the renderer reads
      // `error.response.data.code` and nothing else can tell it this apart
      // from every other 500.
      expect((error as RequestTimeoutException).getResponse()).toMatchObject({
        code: CHATGPT_SIGN_IN_TIMED_OUT_CODE,
      })
      expect(h.events).toContain('close')
      await expect(store.status(userId)).resolves.toMatchObject({
        connected: false,
      })
    })

    // A timeout is not a decline and a decline is not a timeout: the two
    // statuses and the two codes must not be reachable from one cause.
    it('does not call a timed-out sign-in a decline', async () => {
      const h = harness({
        onBrowserOpen: (_ok, refuse) => refuse(new ChatGptSignInTimedOutError()),
      })

      const error = await rejection(h.flow.connect(userId))

      expect(error).not.toBeInstanceOf(ForbiddenException)
      expect((error as Error).message).not.toMatch(/declin/i)
    })

    // Every other cause keeps its 500 with no code, so the panel's generic
    // failure message stays the fallback it is meant to be rather than
    // becoming the only message.
    it('leaves every other cause as a plain failure with no code', async () => {
      for (const options of [
        {
          exchange: async () => {
            throw new Error('the token endpoint refused the grant')
          },
        },
        {
          onBrowserOpen: (
            _ok: (result: CallbackResult) => void,
            refuse: (error: unknown) => void,
          ) => refuse(new Error('the callback carried no usable code')),
        },
        {
          discover: () => Promise.reject(new Error('discovery failed')),
        },
      ] satisfies Array<Parameters<typeof harness>[0]>) {
        const error = await rejection(harness(options).flow.connect(userId))

        expect(error).not.toBeInstanceOf(RequestTimeoutException)
        expect(error).not.toBeInstanceOf(ForbiddenException)
      }
    })

    it('does not call an ordinary failure a decline', async () => {
      const h = harness({
        onBrowserOpen: (_ok, refuse) =>
          refuse(
            new Error(
              'ChatGPT sign-in callback timed out waiting for the browser redirect.',
            ),
          ),
      })

      const error = await rejection(h.flow.connect(userId))

      expect(error).not.toBeInstanceOf(ForbiddenException)
      expect((error as Error).message).toMatch(/timed out/)
      expect((error as Error).message).not.toMatch(/declin/i)
    })

    it('refuses before touching the network when it has no way to open a browser', async () => {
      const h = harness({ openBrowser: null })

      const error = await rejection(h.flow.connect(userId))

      expect((error as Error).message).toMatch(/browser/i)
      // Nothing was discovered and no port was bound: there is no point
      // spending either to find out nobody can finish the sign-in.
      expect(h.events).toEqual([])
    })

    it('keeps every credential out of its failure messages', async () => {
      // The flow holds the code and the verifier at the moment these fail,
      // so a message built from the arguments would carry them.
      const failures: Array<[string, Parameters<typeof harness>[0]]> = [
        [
          'the exchange fails',
          {
            exchange: async () => {
              throw new Error('the token endpoint refused the grant')
            },
          },
        ],
        [
          'the callback fails',
          {
            onBrowserOpen: (_ok, refuse) =>
              refuse(new Error('the callback carried no usable code')),
          },
        ],
        ['consent is declined', {
          onBrowserOpen: (_ok, refuse) => refuse(new ChatGptSignInDeniedError()),
        }],
      ]

      for (const [, options] of failures) {
        const h = harness(options)
        const error = await rejection(h.flow.connect(userId))
        expect(error).toBeInstanceOf(Error)
        const message = (error as Error).message
        for (const value of Object.values(SENTINEL)) {
          expect(message).not.toContain(value)
        }
        expect(message).not.toContain(h.request().verifier)
        expect(message).not.toContain(h.request().state)
      }
    })
  })
})
