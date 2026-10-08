import { randomBytes } from 'crypto'
import { Logger } from '@nestjs/common'
import type { ChatGptConnectionStatus } from './chatgpt-connection.store'
import {
  ChatGptOAuthProvider,
  ChatGptRequestError,
} from './chatgpt-oauth-provider'
import { ChatGptRefreshRetryableError } from './chatgpt-refresh.service'

/**
 * Sentinels are random per run. A fixed short string ('at', 'tok') is a
 * substring of ordinary error text, and a leak assertion built on one passes
 * and fails for reasons that have nothing to do with a leak.
 */
const unique = (label: string) => `${label}-${randomBytes(8).toString('hex')}`
const USER = unique('user')
const TOKEN_A = unique('access-a')
const TOKEN_B = unique('access-b')

const transactions = [
  { index: 0, description: 'Mercado Livre', amount: '123.45' },
  { index: 3, description: 'Uber Trip', amount: '-9.90' },
]
const candidates = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-transport', name: 'Transport' },
]

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** A 200 whose structured output carries `suggestions`. */
const okWith = (suggestions: unknown[]) =>
  json(200, { output_text: JSON.stringify({ suggestions }) })

const goodAnswer = () =>
  okWith([
    { index: 0, categoryId: 'cat-groceries', confidence: 0.9 },
    { index: 3, categoryId: 'cat-transport', confidence: 0.8 },
  ])

const GOOD_RESULT = [
  { index: 0, categoryId: 'cat-groceries', confidence: 0.9 },
  { index: 3, categoryId: 'cat-transport', confidence: 0.8 },
]

interface Call {
  url: string
  init: RequestInit
  body: Record<string, any>
}

interface Options {
  status?: Partial<ChatGptConnectionStatus>
  /** One entry per `accessTokenFor` call: a token, `null`, or an error to throw. */
  tokens?: Array<string | null | Error>
  /** One entry per fetch: a response, or an error to reject with. */
  responses?: Array<Response | Error>
}

/**
 * Every collaborator the provider has, replaced. Nothing here reaches a
 * network: an extra, unscripted fetch is *recorded* and then throws, so a
 * provider that retries more than it should shows up as a call count and not
 * as a hang.
 */
function build(options: Options = {}) {
  const calls: Call[] = []
  const tokens = [...(options.tokens ?? [TOKEN_A])]
  const responses = [...(options.responses ?? [goodAnswer()])]

  const accessTokenFor = jest.fn(async (_userId: string) => {
    if (tokens.length === 0) throw new Error('unscripted accessTokenFor call')
    const next = tokens.shift()!
    if (next instanceof Error) throw next
    return next
  })
  const status = jest.fn(
    async (_userId: string): Promise<ChatGptConnectionStatus> => ({
      connected: true,
      sharing: true,
      accountLabel: 'someone@example.com',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      ...options.status,
    }),
  )
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? 'null')),
    })
    const next = responses.shift()
    if (next === undefined) throw new Error('unscripted fetch call')
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch

  const provider = new ChatGptOAuthProvider({
    refresh: { accessTokenFor },
    store: { status },
    fetchImpl,
  })
  return { provider, calls, accessTokenFor, status }
}

const run = (provider: ChatGptOAuthProvider) =>
  provider.categorizeBatch({ userId: USER, transactions, candidates })

const authorizationOf = (call: Call) =>
  new Headers(call.init.headers).get('authorization')

describe('ChatGptOAuthProvider', () => {
  // The provider warns on unusable output. Those lines are expected here and
  // would only bury real output; the leak test below spies on the logger
  // itself, which this does not affect.
  beforeAll(() => {
    Logger.overrideLogger(false)
  })

  it('has the id the registry knows it by', () => {
    expect(build().provider.id).toBe('chatgpt-oauth')
  })

  describe('hasCredentialFor', () => {
    it('is true for a connection the store can read', async () => {
      const { provider, status } = build({ status: { connected: true } })

      expect(await provider.hasCredentialFor(USER)).toBe(true)
      expect(status).toHaveBeenCalledWith(USER)
    })

    it('is false when there is no readable connection', async () => {
      const { provider } = build({ status: { connected: false } })

      expect(await provider.hasCredentialFor(USER)).toBe(false)
    })

    // A connected plan that cannot share is a failure at CALL time, with its
    // own message, not an absent credential. Folding `sharing` in here would
    // make the settings panel report "not connected" about an account that
    // plainly is, and would silently route the user to their other
    // credential instead of telling them what to fix in ChatGPT.
    it('is true for a connected account whose plan does not grant sharing', async () => {
      const { provider } = build({
        status: { connected: true, sharing: false },
      })

      expect(await provider.hasCredentialFor(USER)).toBe(true)
    })

    // Contractually cheap: selection calls this on every enabled preview.
    // A refresh here would spend a token rotation to answer a question, and
    // a network call would make an import preview wait on OpenAI.
    it('neither refreshes a token nor touches the network', async () => {
      const { provider, calls, accessTokenFor } = build()

      await provider.hasCredentialFor(USER)

      expect(accessTokenFor).not.toHaveBeenCalled()
      expect(calls).toHaveLength(0)
    })
  })

  describe('the request', () => {
    it('POSTs to the Responses API', async () => {
      const { provider, calls } = build()

      await run(provider)

      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe('https://api.openai.com/v1/responses')
      expect(calls[0]!.init.method).toBe('POST')
    })

    // The body holds transaction descriptions and amounts. `store: false` is
    // what tells OpenAI not to retain them, so it is asserted exactly rather
    // than as "something truthy-ish is there".
    it('sends store: false so the transaction data is not retained', async () => {
      const { provider, calls } = build()

      await run(provider)

      expect(calls[0]!.body.store).toBe(false)
    })

    it('carries the access token as a bearer credential', async () => {
      const { provider, calls } = build()

      await run(provider)

      expect(authorizationOf(calls[0]!)).toBe(`Bearer ${TOKEN_A}`)
    })

    it('asks for the user whose token it fetched, and no one else', async () => {
      const { provider, accessTokenFor, status } = build()

      await run(provider)

      expect(status).toHaveBeenCalledWith(USER)
      expect(accessTokenFor).toHaveBeenCalledWith(USER)
    })

    it('keeps the token, and the user, out of the request body', async () => {
      const { provider, calls } = build()

      await run(provider)

      const sent = JSON.stringify(calls[0]!.body)
      expect(sent).not.toContain(TOKEN_A)
      expect(sent).not.toContain(USER)
    })

    it('refuses to follow a redirect, since the body is the user\'s transactions', async () => {
      const { provider, calls } = build()

      await run(provider)

      expect(calls[0]!.init.redirect).toBe('error')
    })

    it('bounds the request with a timeout signal', async () => {
      const { provider, calls } = build()

      await run(provider)

      expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
    })

    it('puts the shared prompt in the input, without naming a tool this request does not have', async () => {
      const { provider, calls } = build()

      await run(provider)

      const input = calls[0]!.body.input as string
      expect(input).toContain('- cat-groceries: Groceries')
      expect(input).toContain('- cat-transport: Transport')
      expect(input).toContain('0. amount=123.45 description="Mercado Livre"')
      expect(input).toContain('3. amount=-9.90 description="Uber Trip"')
      expect(input).toContain('Do not invent ids.')
      expect(input).not.toContain('tool')
    })

    it('asks for a strict JSON schema rather than a tool call', async () => {
      const { provider, calls } = build()

      await run(provider)

      const { body } = calls[0]!
      expect(body.text.format).toMatchObject({
        type: 'json_schema',
        strict: true,
      })
      expect(body.tools).toBeUndefined()
      expect(body.tool_choice).toBeUndefined()
    })

    // The API rejects a strict schema in which an object lacks
    // `additionalProperties: false` or leaves a property out of `required`,
    // and a test double would never say so. Walk the schema that is actually
    // sent.
    it('sends a schema that satisfies strict mode at every object', async () => {
      const { provider, calls } = build()

      await run(provider)

      const objects: Array<Record<string, any>> = []
      const walk = (node: any) => {
        if (typeof node !== 'object' || node === null) return
        if (node.type === 'object') objects.push(node)
        for (const value of Object.values(node)) walk(value)
      }
      walk(calls[0]!.body.text.format.schema)

      expect(objects.length).toBeGreaterThanOrEqual(2)
      for (const node of objects) {
        expect(node.additionalProperties).toBe(false)
        expect([...node.required].sort()).toEqual(
          Object.keys(node.properties).sort(),
        )
      }
    })

    it('asks for the fields mapSuggestions reads', async () => {
      const { provider, calls } = build()

      await run(provider)

      const schema = calls[0]!.body.text.format.schema
      expect(Object.keys(schema.properties)).toEqual(['suggestions'])
      expect(
        Object.keys(schema.properties.suggestions.items.properties).sort(),
      ).toEqual(['categoryId', 'confidence', 'index'])
    })
  })

  describe('the answer', () => {
    it('returns the suggestions the model made', async () => {
      const { provider } = build()

      expect(await run(provider)).toEqual(GOOD_RESULT)
    })

    it('reads the text from output[].content[] when there is no top-level output_text', async () => {
      const { provider } = build({
        responses: [
          json(200, {
            output: [
              { type: 'reasoning', summary: [] },
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      suggestions: [
                        { index: 0, categoryId: 'cat-groceries', confidence: 0.9 },
                      ],
                    }),
                  },
                ],
              },
            ],
          }),
        ],
      })

      expect(await run(provider)).toEqual([
        { index: 0, categoryId: 'cat-groceries', confidence: 0.9 },
      ])
    })

    // The point of sharing `mapSuggestions`: whatever the model says, the id
    // that comes out is one the caller offered.
    it('does not believe a categoryId that is not in the candidate list', async () => {
      const { provider } = build({
        responses: [
          okWith([{ index: 0, categoryId: 'cat-invented', confidence: 0.99 }]),
        ],
      })

      expect(await run(provider)).toEqual([
        { index: 0, categoryId: null, confidence: 0.99 },
      ])
    })

    it('does not believe a candidate id the model was unsure about', async () => {
      const { provider } = build({
        responses: [
          okWith([{ index: 0, categoryId: 'cat-groceries', confidence: 0.4 }]),
        ],
      })

      expect(await run(provider)).toEqual([
        { index: 0, categoryId: null, confidence: 0.4 },
      ])
    })

    it('floors a missing confidence to 0 and discards a non-numeric index', async () => {
      const { provider } = build({
        responses: [
          okWith([
            { index: 0, categoryId: 'cat-groceries' },
            { index: 'three', categoryId: 'cat-transport', confidence: 0.9 },
          ]),
        ],
      })

      expect(await run(provider)).toEqual([
        { index: 0, categoryId: null, confidence: 0 },
      ])
    })

    it.each([
      ['a refusal in place of text', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }],
      ['an empty output', { output: [] }],
      ['no output at all', {}],
      ['a response that is not an object', null],
    ])('returns [] for %s', async (_label, body) => {
      const { provider } = build({ responses: [json(200, body)] })

      expect(await run(provider)).toEqual([])
    })

    it.each([
      ['text that is not JSON', 'definitely not json'],
      ['JSON null', 'null'],
      ['a bare JSON array', '[]'],
      ['a bare JSON string', '"cat-groceries"'],
    ])('returns [] for output_text that is %s', async (_label, text) => {
      const { provider } = build({ responses: [json(200, { output_text: text })] })

      expect(await run(provider)).toEqual([])
    })

    it('throws a static error, quoting nothing, when a 200 body cannot be parsed', async () => {
      const { provider } = build({
        responses: [new Response(`<<${TOKEN_A}`, { status: 200 })],
      })

      const settled = run(provider)

      await expect(settled).rejects.toBeInstanceOf(ChatGptRequestError)
      await expect(settled).rejects.not.toThrow(TOKEN_A)
    })
  })

  describe('when there is nothing to try', () => {
    // Each of these arranges everything else to succeed, so the only thing
    // that can produce [] is the condition under test.
    it('returns [] without any lookup when there are no transactions or no candidates', async () => {
      const { provider, calls, accessTokenFor, status } = build()

      expect(
        await provider.categorizeBatch({ userId: USER, transactions: [], candidates }),
      ).toEqual([])
      expect(
        await provider.categorizeBatch({ userId: USER, transactions, candidates: [] }),
      ).toEqual([])

      expect(status).not.toHaveBeenCalled()
      expect(accessTokenFor).not.toHaveBeenCalled()
      expect(calls).toHaveLength(0)
    })

    it('returns [] and asks for no token when sharing is off', async () => {
      const { provider, calls, accessTokenFor } = build({
        status: { sharing: false },
      })

      expect(await run(provider)).toEqual([])
      expect(accessTokenFor).not.toHaveBeenCalled()
      expect(calls).toHaveLength(0)
    })

    it('returns [] and asks for no token when there is no connection', async () => {
      const { provider, calls, accessTokenFor } = build({
        status: { connected: false },
      })

      expect(await run(provider)).toEqual([])
      expect(accessTokenFor).not.toHaveBeenCalled()
      expect(calls).toHaveLength(0)
    })

    it('returns [] when the refresh service has no token for this user', async () => {
      const { provider, calls, accessTokenFor } = build({ tokens: [null] })

      expect(await run(provider)).toEqual([])
      expect(accessTokenFor).toHaveBeenCalledTimes(1)
      expect(calls).toHaveLength(0)
    })

    it('returns [] rather than throwing when the refresh failure is retryable', async () => {
      const { provider, calls } = build({
        tokens: [new ChatGptRefreshRetryableError('static message')],
      })

      const settled = run(provider)

      await expect(settled).resolves.toEqual([])
      expect(calls).toHaveLength(0)
    })

    it('does not swallow an error it does not understand', async () => {
      const { provider, calls } = build({ tokens: [new Error('programmer error')] })

      await expect(run(provider)).rejects.toThrow('programmer error')
      expect(calls).toHaveLength(0)
    })
  })

  describe('a 401', () => {
    const unauthorized = () => json(401, { error: { message: 'expired' } })

    it('does not re-send the payload when the refresh returns the same token', async () => {
      // The clock-skew case, which every other retry test misses because
      // they script two DISTINCT tokens. `accessTokenFor` decides expiry
      // from the local clock, so when OpenAI's clock is ahead of ours it
      // hands back the very same string -- and re-posting it would transmit
      // the user's transaction descriptions and amounts a second time for a
      // provably identical 401.
      const { provider, calls, accessTokenFor } = build({
        tokens: [TOKEN_A, TOKEN_A],
        responses: [unauthorized(), goodAnswer()],
      })

      await expect(run(provider)).rejects.toThrow()

      // It asked for a fresh token...
      expect(accessTokenFor).toHaveBeenCalledTimes(2)
      // ...and having been given the same one, did NOT post again.
      expect(calls).toHaveLength(1)
    })

    it('is retried once with whatever token the refresh service now hands back', async () => {
      const { provider, calls, accessTokenFor } = build({
        tokens: [TOKEN_A, TOKEN_B],
        responses: [unauthorized(), goodAnswer()],
      })

      expect(await run(provider)).toEqual(GOOD_RESULT)

      expect(accessTokenFor).toHaveBeenCalledTimes(2)
      expect(calls).toHaveLength(2)
      expect(authorizationOf(calls[0]!)).toBe(`Bearer ${TOKEN_A}`)
      expect(authorizationOf(calls[1]!)).toBe(`Bearer ${TOKEN_B}`)
    })

    it('resends the same body on the retry, store: false included', async () => {
      const { provider, calls } = build({
        tokens: [TOKEN_A, TOKEN_B],
        responses: [unauthorized(), goodAnswer()],
      })

      await run(provider)

      expect(calls[1]!.body).toEqual(calls[0]!.body)
      expect(calls[1]!.body.store).toBe(false)
    })

    it('is retried once and no more: a second 401 is a failure', async () => {
      // A third token and a third 401 are scripted so that a provider which
      // retried again would find them and carry on. Nothing but the counts
      // below can tell it apart from a correct one.
      const { provider, calls, accessTokenFor } = build({
        tokens: [TOKEN_A, TOKEN_B, unique('access-c')],
        responses: [unauthorized(), unauthorized(), unauthorized()],
      })

      const settled = run(provider)

      await expect(settled).rejects.toBeInstanceOf(ChatGptRequestError)
      await expect(settled).rejects.toMatchObject({ status: 401, retryable: false })
      expect(calls).toHaveLength(2)
      expect(accessTokenFor).toHaveBeenCalledTimes(2)
    })

    it('ends quietly when the retry finds no token left', async () => {
      const { provider, calls } = build({
        tokens: [TOKEN_A, null],
        responses: [unauthorized()],
      })

      await expect(run(provider)).resolves.toEqual([])
      expect(calls).toHaveLength(1)
    })

    it('ends quietly when the retry\'s refresh fails retryably', async () => {
      const { provider, calls } = build({
        tokens: [TOKEN_A, new ChatGptRefreshRetryableError('static message')],
        responses: [unauthorized()],
      })

      await expect(run(provider)).resolves.toEqual([])
      expect(calls).toHaveLength(1)
    })

    it('is not retried when the API says why, because a fresh token would not change it', async () => {
      const { provider, calls, accessTokenFor } = build({
        tokens: [TOKEN_A, TOKEN_B],
        responses: [
          json(401, { error: { code: 'subscription_sharing_invalid_user' } }),
        ],
      })

      const settled = run(provider)

      await expect(settled).rejects.toMatchObject({
        code: 'subscription_sharing_invalid_user',
      })
      expect(calls).toHaveLength(1)
      expect(accessTokenFor).toHaveBeenCalledTimes(1)
    })

    it.each([
      [403, 'a 403'],
      [429, 'a 429'],
      [500, 'a 500'],
    ])('is the only status retried: %i is not', async (status) => {
      const { provider, calls, accessTokenFor } = build({
        tokens: [TOKEN_A, TOKEN_B],
        responses: [json(status, { error: { message: 'nope' } })],
      })

      await expect(run(provider)).rejects.toBeInstanceOf(ChatGptRequestError)

      expect(calls).toHaveLength(1)
      expect(accessTokenFor).toHaveBeenCalledTimes(1)
    })
  })

  describe("the API's own error codes", () => {
    // [code, retryable, something only this code's message says]
    const table: Array<[string, boolean, RegExp]> = [
      ['subscription_sharing_user_not_eligible', false, /cannot use plan sharing/],
      ['subscription_sharing_usage_limit_exceeded', false, /ChatGPT Settings/],
      ['subscription_sharing_usage_unavailable', true, /could not check plan usage/],
      ['subscription_sharing_unsupported_capability', false, /capability/],
      ['subscription_sharing_route_not_supported', false, /route/],
      ['subscription_sharing_invalid_user', false, /validate the subscription/],
      ['subscription_sharing_user_unavailable', true, /temporarily unavailable/],
    ]

    it.each(table)('%s: retryable %s, and says so', async (code, retryable, says) => {
      const { provider, calls, accessTokenFor } = build({
        responses: [json(403, { error: { code, message: 'ignored' } })],
      })

      const settled = run(provider)

      await expect(settled).rejects.toBeInstanceOf(ChatGptRequestError)
      await expect(settled).rejects.toMatchObject({ code, retryable, status: 403 })
      await expect(settled).rejects.toThrow(says)
      // Retryable means "asking later may work", not "ask again now": one
      // request per call, whichever way the code points.
      expect(calls).toHaveLength(1)
      expect(accessTokenFor).toHaveBeenCalledTimes(1)
    })

    it('gives every code a message of its own', async () => {
      const messages: string[] = []
      for (const [code] of table) {
        const { provider } = build({
          responses: [json(403, { error: { code } })],
        })
        messages.push(await run(provider).then(() => '', (e: Error) => e.message))
      }

      expect(messages.every((m) => m.length > 0)).toBe(true)
      expect(new Set(messages).size).toBe(table.length)
    })

    it('tells a user at their own limit that the limit is theirs to raise', async () => {
      const { provider } = build({
        responses: [
          json(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } }),
        ],
      })

      await expect(run(provider)).rejects.toThrow(/limits.*ChatGPT Settings/)
    })

    it('reads a code given as a bare error string as well', async () => {
      const { provider } = build({
        responses: [json(403, { error: 'subscription_sharing_user_unavailable' })],
      })

      await expect(run(provider)).rejects.toMatchObject({
        code: 'subscription_sharing_user_unavailable',
        retryable: true,
      })
    })

    it.each(['constructor', '__proto__', 'toString'])(
      'does not mistake the inherited name %s for one of its codes',
      async (code) => {
        const { provider } = build({
          responses: [json(400, { error: { code } })],
        })

        const settled = run(provider)

        await expect(settled).rejects.toThrow('ChatGPT request failed (status 400).')
        await expect(settled).rejects.toMatchObject({ retryable: false, code: null })
      },
    )
  })

  describe('failures with no code of their own', () => {
    it.each([
      [400, false],
      [404, false],
      [429, true],
      [500, true],
      [503, true],
    ])('a %i is retryable: %s', async (status, retryable) => {
      const { provider } = build({ responses: [json(status, {})] })

      const settled = run(provider)

      await expect(settled).rejects.toBeInstanceOf(ChatGptRequestError)
      await expect(settled).rejects.toMatchObject({ status, retryable, code: null })
      await expect(settled).rejects.toThrow(`ChatGPT request failed (status ${status}).`)
    })

    it('says to reconnect after a 401 that a fresh token did not cure', async () => {
      const { provider } = build({
        tokens: [TOKEN_A, TOKEN_B],
        responses: [json(401, {}), json(401, {})],
      })

      await expect(run(provider)).rejects.toThrow(/may need to be reconnected/)
    })

    it('treats an unreadable error body as having no code', async () => {
      const { provider } = build({
        responses: [new Response('<html>bad gateway</html>', { status: 502 })],
      })

      await expect(run(provider)).rejects.toMatchObject({
        status: 502,
        code: null,
        retryable: true,
      })
    })
  })

  describe('no credential leaks', () => {
    // A server that echoes the credential back, and a network stack that does
    // the same in its own error, are the two ways a token could ride into a
    // message. The messages here are chosen, not copied.
    const echoing = () =>
      json(500, {
        error: {
          message: `token ${TOKEN_A} was rejected`,
          code: `leaky-${TOKEN_A}`,
        },
      })

    it('keeps a token the server echoed out of the error message', async () => {
      const { provider } = build({ responses: [echoing()] })

      const settled = run(provider)

      await expect(settled).rejects.toBeInstanceOf(ChatGptRequestError)
      await expect(settled).rejects.not.toThrow(TOKEN_A)
      await expect(settled).rejects.not.toThrow('was rejected')
      // The code is a property callers log. A code the server made up -- here
      // one that carries the echoed token -- is not repeated on the error.
      const error = (await settled.catch((e: Error) => e)) as ChatGptRequestError
      expect(error.code).toBeNull()
      expect(JSON.stringify(error)).not.toContain(TOKEN_A)
    })

    it('keeps the access token out of the error when the network fails', async () => {
      const failure = new Error(`connect failed for Bearer ${TOKEN_A}`)
      const { provider } = build({ responses: [failure] })

      const settled = run(provider)

      await expect(settled).rejects.toBeInstanceOf(ChatGptRequestError)
      await expect(settled).rejects.toMatchObject({ status: null, retryable: true })
      await expect(settled).rejects.not.toThrow(TOKEN_A)
      // And not by way of serialisation either: `cause` holds the original,
      // so it must not be enumerable.
      const error = await settled.catch((e: Error) => e)
      expect(JSON.stringify(error)).not.toContain(TOKEN_A)
      expect(Object.keys(error as object)).not.toContain('cause')
      expect((error as ChatGptRequestError).cause).toBe(failure)
    })

    it('writes no token to any log on any path', async () => {
      const logged: unknown[][] = []
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (method) =>
          jest
            .spyOn(Logger.prototype, method)
            .mockImplementation((...args: unknown[]) => {
              logged.push(args)
            }),
      )
      try {
        const scenarios: Options[] = [
          { responses: [goodAnswer()] },
          { responses: [json(200, { output_text: `not json ${TOKEN_A}` })] },
          { responses: [json(200, {})] },
          { responses: [echoing()] },
          { responses: [new Error(`boom ${TOKEN_A}`)] },
          { tokens: [TOKEN_A, TOKEN_B], responses: [json(401, {}), json(401, {})] },
        ]
        for (const scenario of scenarios) {
          await run(build(scenario).provider).catch(() => undefined)
        }
      } finally {
        spies.forEach((spy) => spy.mockRestore())
      }

      // Not vacuous: the no-output and not-JSON paths do warn.
      expect(logged.length).toBeGreaterThan(0)
      expect(JSON.stringify(logged)).not.toContain(TOKEN_A)
      expect(JSON.stringify(logged)).not.toContain(TOKEN_B)
    })
  })
})
