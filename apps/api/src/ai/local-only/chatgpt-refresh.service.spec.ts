import {
  ChatGptRefreshRetryableError,
  ChatGptRefreshService,
} from './chatgpt-refresh.service'
import type { ChatGptCredentials } from './chatgpt-token-exchange'
import type { OidcConfig } from './chatgpt-oidc'

const config: OidcConfig = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}

const SCOPES = 'openid offline_access chatgpt.tokens.use.direct'
const USER = 'user-1'

interface Slot {
  current: ChatGptCredentials | null
  pending: { credentials: ChatGptCredentials; receivedAt: Date } | null
  clientId: string | null
  /** Changes on every `save`, mirroring the real store's per-write ciphertext. */
  generation: string
}

/**
 * In-memory stand-in for `ChatGptConnectionStore`, one slot per user. The
 * real store is proven against a real database in its own spec; what this
 * spec has to prove is *call discipline* -- how many network refreshes
 * happen, in what order, and what survives a failure.
 *
 * It models the two behaviours the service depends on rather than accepting
 * anything: `savePending` refuses without a live connection, and
 * `promotePending` is a real compare-and-swap whose read and write can be
 * separated by `onPromoteRead`, which is where a competing writer lands in
 * a test that needs one.
 */
class StoreDouble {
  private readonly slots = new Map<string, Slot>()
  private generations = 1
  cleared = 0
  /** Calls in the order they happened, so ordering is asserted, not assumed. */
  readonly events: string[] = []
  readonly savedReceivedAt: Date[] = []
  /** Runs between `promotePending`'s read and its write. */
  onPromoteRead: (() => Promise<void>) | null = null

  slot(userId: string): Slot {
    let slot = this.slots.get(userId)
    if (slot === undefined) {
      // Keyed by user AND counted, so no literal a mutation might hardcode
      // can coincide with it. A plain 'gen-1' start made a mutation that
      // hardcoded 'gen-1' indistinguishable from reading the real value.
      slot = {
        current: null,
        pending: null,
        clientId: 'client-1',
        generation: `gen-${userId}-${(this.generations += 1)}`,
      }
      this.slots.set(userId, slot)
    }
    return slot
  }

  // Shorthand for the default user, which almost every test uses.
  get current() { return this.slot(USER).current }
  set current(value: ChatGptCredentials | null) { this.slot(USER).current = value }
  get pending() { return this.slot(USER).pending }
  set pending(value: Slot['pending']) { this.slot(USER).pending = value }
  get clientId() { return this.slot(USER).clientId }
  set clientId(value: string | null) { this.slot(USER).clientId = value }

  async load(userId: string) { return this.slot(userId).current }
  /**
   * Mirrors the real store: a generation marker that changes on every write.
   * The real one is the ciphertext, unique per save because the IV is random;
   * here a counter is enough, and keeping it realistic is what lets the
   * generation-conditional writes below be exercised at all.
   */
  async loadLive(userId: string) {
    const slot = this.slot(userId)
    if (slot.current === null) return null
    return { credentials: slot.current, generation: slot.generation }
  }
  async loadPending(userId: string) { return this.slot(userId).pending }
  async loadClientId(userId: string) { return this.slot(userId).clientId }
  async save(userId: string, clientId: string, credentials: ChatGptCredentials) {
    const slot = this.slot(userId)
    slot.current = credentials
    slot.clientId = clientId
    slot.pending = null
    // A fresh sign-in is a new generation, which is what makes a stale
    // flight's conditional write miss.
    slot.generation = `gen-${userId}-${(this.generations += 1)}`
  }
  async savePending(
    userId: string,
    credentials: ChatGptCredentials,
    receivedAt: Date,
    expectedGeneration: string,
  ) {
    this.events.push('savePending')
    const slot = this.slot(userId)
    // The real store refuses unless the live credential is still the one the
    // caller read -- not merely that some live credential exists.
    if (slot.current === null || slot.generation !== expectedGeneration) {
      throw new Error('No live ChatGPT connection to rotate.')
    }
    slot.pending = { credentials, receivedAt }
    this.savedReceivedAt.push(receivedAt)
  }
  async promotePending(userId: string): Promise<boolean> {
    this.events.push('promotePending')
    const slot = this.slot(userId)
    const seen = slot.pending
    if (seen === null) return false
    await this.onPromoteRead?.()
    // Compare-and-swap: only the value that was read may be promoted.
    if (slot.pending !== seen) return false
    slot.current = seen.credentials
    slot.pending = null
    return true
  }
  async clearTokens(userId: string, expectedGeneration?: string) {
    const slot = this.slot(userId)
    // Conditional when a generation is given, unconditional otherwise -- the
    // real store's contract, so a stale flight cannot wipe a reconnection.
    if (expectedGeneration !== undefined && slot.generation !== expectedGeneration) {
      return
    }
    slot.current = null
    slot.pending = null
    this.cleared += 1
  }
}

const expired = (): ChatGptCredentials => ({
  accessToken: 'old-access',
  refreshToken: 'old-refresh' as string | null,
  idToken: 'old-id',
  // Already past: forces a refresh on the next access.
  expiresAt: new Date(Date.now() - 1_000),
  scopes: SCOPES,
  subject: 'sub-1',
  sharing: true,
})

const fresh = (accessToken: string): ChatGptCredentials => ({
  ...expired(),
  accessToken,
  expiresAt: new Date(Date.now() + 3_600_000),
})

/** A successful refresh response body. */
const rotated = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  id_token: 'new-id',
  expires_in: 3600,
  scope: SCOPES,
  ...overrides,
})

/** `body` without `key` at all -- as opposed to a key holding `undefined`. */
const without = (body: Record<string, unknown>, key: string) => {
  const { [key]: _omitted, ...rest } = body
  return rest
}

interface Reply {
  ok: boolean
  status?: number
  body?: unknown
  /** Makes `json()` throw a SyntaxError carrying this text, as a bad body does. */
  unparseable?: string
}

/** Counts token-endpoint POSTs so single-flight is measured, not assumed. */
function tokenEndpointSpy(respond: (body: URLSearchParams) => Reply | Promise<Reply>) {
  const calls: URLSearchParams[] = []
  const inits: RequestInit[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url !== config.token_endpoint) {
      throw new Error(`unexpected fetch to ${url}`)
    }
    calls.push(new URLSearchParams(String(init?.body)))
    inits.push(init ?? {})
    const reply = await respond(calls[calls.length - 1]!)
    return {
      ok: reply.ok,
      status: reply.status ?? (reply.ok ? 200 : 400),
      json: async () => {
        if (reply.unparseable !== undefined) throw new SyntaxError(reply.unparseable)
        return reply.body
      },
    }
  }) as unknown as typeof fetch
  return { calls, inits, fetchImpl }
}

// Matches the real `verifyIdentity`'s shape closely enough that a call with
// the wrong arguments fails to type-check here too.
type VerifyIdentity = (args: {
  idToken: string
  clientId: string
  issuer: string
  jwksUri: string
  nonce: string | null
  verifyAt?: Date
  fetchImpl?: typeof fetch
}) => Promise<{ subject: string }>

/**
 * Accepts a refresh the way the real function does: `null` is the only
 * nonce it allows. A service that passed anything else would not just fail
 * a dedicated test, it would fail every happy path -- as it does for real.
 */
const verifyAccepting: VerifyIdentity = async (args) => {
  if (args.nonce !== null) throw new Error('a refresh must pass a null nonce')
  return { subject: 'sub-1' }
}

const build = (
  store: StoreDouble,
  fetchImpl: typeof fetch,
  verifyIdentity: VerifyIdentity = verifyAccepting,
  extra: {
    timeoutMs?: number
    discover?: (fetchImpl?: typeof fetch) => Promise<OidcConfig>
  } = {},
) =>
  new ChatGptRefreshService({
    store: store as never,
    discover: extra.discover ?? (async () => config),
    fetchImpl,
    verifyIdentity,
    timeoutMs: extra.timeoutMs,
  })

/** Awaits a promise and returns what it rejected with, or `null` if it did not. */
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  )

describe('ChatGptRefreshService', () => {
  describe('single-flight', () => {
    it('refreshes once for many concurrent callers', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const service = build(store, fetchImpl)

      const tokens = await Promise.all(
        Array.from({ length: 10 }, () => service.accessTokenFor(USER)),
      )

      expect(calls).toHaveLength(1)
      expect(new Set(tokens)).toEqual(new Set(['new-access']))
    })

    it('lets a caller that arrives mid-flight join the refresh already running', async () => {
      // `Promise.all` above starts every caller in the same tick. A real
      // batch does not: the late ones arrive while the POST is outstanding.
      const store = new StoreDouble()
      store.current = expired()
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      let postStarted!: () => void
      const started = new Promise<void>((resolve) => { postStarted = resolve })
      const { calls, fetchImpl } = tokenEndpointSpy(async () => {
        postStarted()
        await gate
        return { ok: true, body: rotated() }
      })
      const service = build(store, fetchImpl)

      const first = service.accessTokenFor(USER)
      await started
      const late = service.accessTokenFor(USER)
      release()

      await expect(Promise.all([first, late])).resolves.toEqual(['new-access', 'new-access'])
      expect(calls).toHaveLength(1)
    })

    it('does not share a refresh between different users', async () => {
      const store = new StoreDouble()
      store.slot('user-a').current = { ...expired(), refreshToken: 'refresh-a' }
      store.slot('user-b').current = { ...expired(), refreshToken: 'refresh-b' }
      const { calls, fetchImpl } = tokenEndpointSpy((body) => ({
        ok: true,
        body: rotated({ access_token: `access-for-${body.get('refresh_token')}` }),
      }))
      const service = build(store, fetchImpl)

      const [a, b] = await Promise.all([
        service.accessTokenFor('user-a'),
        service.accessTokenFor('user-b'),
      ])

      expect(calls).toHaveLength(2)
      expect(a).toBe('access-for-refresh-a')
      expect(b).toBe('access-for-refresh-b')
    })

    it('never leaves a settled refresh in the map, success or failure', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      let failVerification = true
      const service = build(store, fetchImpl, async (args) => {
        if (failVerification) throw new Error('identity verification unavailable')
        return verifyAccepting(args)
      })

      // A failed flight is reported to its callers and then forgotten...
      expect(await rejection(service.accessTokenFor(USER))).toBeInstanceOf(
        ChatGptRefreshRetryableError,
      )
      failVerification = false
      // ...so the next call runs afresh instead of replaying the rejection.
      await expect(service.accessTokenFor(USER)).resolves.toBe('new-access')
      expect(calls).toHaveLength(1)
    })

    it('does not wedge later callers when the token endpoint never answers', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const calls: number[] = []
      const hangingThenOk = (async (_input: string | URL, init?: RequestInit) => {
        calls.push(calls.length)
        if (calls.length === 1) {
          // Never settles on its own; only the service's own timeout ends it.
          return new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          })
        }
        return { ok: true, status: 200, json: async () => rotated() }
      }) as unknown as typeof fetch
      const service = build(store, hangingThenOk, verifyAccepting, { timeoutMs: 25 })

      expect(await rejection(service.accessTokenFor(USER))).toBeInstanceOf(
        ChatGptRefreshRetryableError,
      )
      await expect(service.accessTokenFor(USER)).resolves.toBe('new-access')
    })
  })

  describe('the refresh request', () => {
    it('sends the documented refresh grant fields', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { calls, inits, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      await build(store, fetchImpl).accessTokenFor(USER)

      expect(Object.fromEntries(calls[0]!)).toMatchObject({
        grant_type: 'refresh_token',
        client_id: 'client-1',
        refresh_token: 'old-refresh',
        resource: 'https://api.openai.com/v1',
      })
      expect(inits[0]).toMatchObject({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        // A followed 307/308 would re-send the refresh token elsewhere.
        redirect: 'error',
      })
    })

    it('does not refresh a token that is still valid', async () => {
      const store = new StoreDouble()
      store.current = fresh('still-good')
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: {} }))

      await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBe('still-good')
      expect(calls).toHaveLength(0)
    })

    it('refreshes a token that is about to expire, rather than handing out one that dies in flight', async () => {
      // 30 seconds left: valid by the clock, but a categorize request started
      // with it would very likely 401 mid-flight. The skew refreshes first.
      const store = new StoreDouble()
      store.current = {
        ...expired(),
        accessToken: 'nearly-dead',
        expiresAt: new Date(Date.now() + 30_000),
      }
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({
        ok: true,
        body: rotated(),
      }))

      await expect(
        build(store, fetchImpl).accessTokenFor(USER),
      ).resolves.toBe('new-access')
      expect(calls).toHaveLength(1)
    })

    it('leaves a token alone when it expires well beyond the skew window', async () => {
      // The skew must not be so wide that it refreshes constantly.
      const store = new StoreDouble()
      store.current = {
        ...expired(),
        accessToken: 'plenty-of-time',
        expiresAt: new Date(Date.now() + 5 * 60_000),
      }
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: {} }))

      await expect(
        build(store, fetchImpl).accessTokenFor(USER),
      ).resolves.toBe('plenty-of-time')
      expect(calls).toHaveLength(0)
    })

    it('returns null without attempting a grant when the stored refresh token is null', async () => {
      // Task 6 yields `refreshToken: null` when `offline_access` was not
      // granted. Posting a grant with no token would be a guaranteed round
      // trip to a 400; fail locally instead, without even discovering.
      const store = new StoreDouble()
      store.current = { ...expired(), refreshToken: null }
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: {} }))
      let discoveries = 0
      const service = build(store, fetchImpl, verifyAccepting, {
        discover: async () => { discoveries += 1; return config },
      })

      await expect(service.accessTokenFor(USER)).resolves.toBeNull()
      expect(calls).toHaveLength(0)
      expect(discoveries).toBe(0)
    })

    // Taken from OpenAI's reference implementation, which applies exactly
    // this set to refresh grants. Matching only `invalid_grant` leaves the
    // other five classified as retryable, so the connection would never
    // clear and every later call would post the same dead token forever.
    it.each([
      'invalid_grant',
      'invalid_refresh_token',
      'token_expired',
      'refresh_token_expired',
      'refresh_token_invalidated',
      'refresh_token_reused',
    ])('clears the connection when the grant is refused with %s', async (code) => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: false,
        body: { error: code },
      }))

      await expect(
        build(store, fetchImpl).accessTokenFor(USER),
      ).resolves.toBeNull()
      expect(store.cleared).toBe(1)
      expect(store.current).toBeNull()
    })

    it('reads a terminal code from a nested error object too', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: false,
        body: { error: { code: 'refresh_token_expired' } },
      }))

      await expect(
        build(store, fetchImpl).accessTokenFor(USER),
      ).resolves.toBeNull()
      expect(store.cleared).toBe(1)
    })

    it.each([
      ['a description that merely contains a code', { error: 'server_error', error_description: 'invalid_grant' }],
      ['an unrelated code', { error: 'temporarily_unavailable' }],
      ['a bare string body', 'invalid_grant'],
      // These two are what distinguish an exact match from a substring
      // match: each CONTAINS a terminal code without being one.
      ['a code that merely contains a terminal one', { error: 'not_invalid_grant' }],
      ['a terminal code with a suffix', { error: 'refresh_token_expired_maybe' }],
      ['a nested code that merely contains a terminal one', { error: { code: 'xx_invalid_grant_yy' } }],
    ])('does not clear the connection for %s', async (_why, body) => {
      // Clearing on a transient failure would disconnect users during an
      // OpenAI outage, which is the wrong failure to choose.
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: false, body }))

      await expect(
        build(store, fetchImpl).accessTokenFor(USER),
      ).rejects.toThrow()
      expect(store.cleared).toBe(0)
      expect(store.current).not.toBeNull()
    })

    it('bounds discovery with the same timeout as every other call', async () => {
      // Discovery used to be called with no arguments, so the service's
      // bounded fetch never reached it. A discovery that never settled then
      // wedged the user permanently: the first call never resolved, every
      // later caller joined the same single-flight promise, and the entry
      // was never released until the process restarted.
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const seen: Array<typeof fetch | undefined> = []
      const service = build(store, fetchImpl, verifyAccepting, {
        discover: async (passed) => {
          seen.push(passed)
          return config
        },
      })

      await service.accessTokenFor(USER)

      expect(seen).toHaveLength(1)
      expect(seen[0]).toBeDefined()
      // And it is a bounded wrapper, not the global fetch.
      expect(seen[0]).not.toBe(globalThis.fetch)
    })

    it('passes the bounded fetch to verifyIdentity as well', async () => {
      // The service documents that the timeout covers the JWKS fetch too,
      // which only holds if the bounded fetch is handed down.
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const seen: Array<typeof fetch | undefined> = []
      const service = build(store, fetchImpl, async (args) => {
        seen.push(args.fetchImpl)
        return { subject: 'sub-1' }
      })

      await service.accessTokenFor(USER)

      expect(seen).toHaveLength(1)
      expect(seen[0]).toBeDefined()
      expect(seen[0]).not.toBe(globalThis.fetch)
    })

    it('releases only its own in-flight entry, never every other user\'s', async () => {
      // `inFlight.clear()` instead of `.delete(userId)` passed the whole
      // suite, because every other test uses a single user and the two are
      // then indistinguishable. Telling them apart needs a THIRD caller:
      // user 1 finishing must not evict user 2's entry, or a later caller
      // for user 2 would start a second grant instead of joining the first.
      //
      // The shared `StoreDouble` cannot express this -- it has one slot and
      // ignores `userId`, so user 2 would see user 1's promoted credential
      // and skip refreshing. A first version of this test measured only that.
      const perUser = new Map<string, ChatGptCredentials | null>([
        ['user-1', expired()],
        ['user-2', expired()],
      ])
      const store = {
        async load(userId: string) {
          return perUser.get(userId) ?? null
        },
        async loadLive(userId: string) {
          const credentials = perUser.get(userId) ?? null
          return credentials === null
            ? null
            : { credentials, generation: `gen-${userId}` }
        },
        async loadPending() {
          return null
        },
        async loadClientId() {
          return 'client-1'
        },
        async save() {},
        async savePending() {},
        async promotePending() {
          return true
        },
        async clearTokens(userId: string) {
          perUser.set(userId, null)
        },
      }

      const gates: Array<() => void> = []
      const fetchImpl = (async (input: string | URL) => {
        if (String(input) !== config.token_endpoint) throw new Error('unexpected')
        await new Promise<void>((resolve) => gates.push(resolve))
        return { ok: true, status: 200, json: async () => rotated() }
      }) as unknown as typeof fetch

      /** Opens gate `index` once the grant has actually reached the endpoint. */
      const open = async (index: number) => {
        for (let tick = 0; tick < 500 && gates.length <= index; tick += 1) {
          await new Promise((resolve) => setImmediate(resolve))
        }
        const release = gates[index]
        if (release === undefined) throw new Error(`grant ${index} never arrived`)
        release()
      }

      const service = build(store as never, fetchImpl)

      const first = service.accessTokenFor('user-1')
      const second = service.accessTokenFor('user-2')

      // Let user 1's grant finish. Under `.clear()` this evicts user 2 too.
      await open(0)
      await first

      // A later caller for user 2, whose grant is still outstanding.
      const third = service.accessTokenFor('user-2')
      await open(1)
      await Promise.all([second, third])

      // Two grants in total, one per user. A third would mean user 2's entry
      // was evicted when user 1 finished, so the later caller did not join.
      expect(gates).toHaveLength(2)
    })

    it('does not say "reconnect" when the store fails for a reason other than a disconnect', async () => {
      // A database error is not a disconnect. Answering `null` to it tells
      // the caller to reconnect about a connection that is still there.
      const store = new StoreDouble()
      store.current = expired()
      store.savePending = async () => {
        throw new Error('database is unavailable')
      }
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))

      await expect(
        build(store, fetchImpl).accessTokenFor(USER),
      ).rejects.toBeInstanceOf(ChatGptRefreshRetryableError)
      // The connection is untouched, so a later call can try again.
      expect(store.current).not.toBeNull()
      expect(store.cleared).toBe(0)
    })

    it('still answers null when the store refuses because the user disconnected', async () => {
      const store = new StoreDouble()
      store.current = expired()
      store.savePending = async () => {
        // What the real store throws once `clearTokens` has run...
        store.current = null
        throw new Error('No live ChatGPT connection to rotate.')
      }
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))

      await expect(
        build(store, fetchImpl).accessTokenFor(USER),
      ).resolves.toBeNull()
    })

    it('keeps the cause off the error\'s enumerable surface', async () => {
      // Every message here is static, but `cause` holds whatever a
      // collaborator threw -- the one place where "no credential in an
      // error" would rest on someone else's behaviour.
      const SECRET = 'SENTINEL-COLLABORATOR-SECRET-4b19'
      const error = new ChatGptRefreshRetryableError('static message', {
        leaked: SECRET,
      })

      expect(JSON.stringify(error)).not.toContain(SECRET)
      expect(JSON.stringify({ ...error })).not.toContain(SECRET)
      expect(Object.keys(error)).not.toContain('cause')
      // ...and it is still reachable for a deliberate read.
      expect(error.cause).toEqual({ leaked: SECRET })
    })

    it('does not promote a stale rotation over a sign-in that happened mid-flight', async () => {
      // The reproduction from Task 8's review, now at the service level: a
      // refresh in flight across a disconnect AND a full reconnect used to
      // write its stale rotation and promote it over the fresh sign-in.
      const store = new StoreDouble()
      store.current = expired()
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const fetchImpl = (async (input: string | URL) => {
        if (String(input) !== config.token_endpoint) throw new Error('unexpected')
        // Hold the grant open while the user disconnects and signs in again.
        await gate
        return { ok: true, status: 200, json: async () => rotated() }
      }) as unknown as typeof fetch

      const flight = build(store, fetchImpl).accessTokenFor(USER)
      await new Promise((resolve) => setImmediate(resolve))

      await store.clearTokens(USER)
      await store.save(USER, 'client-1', {
        ...expired(),
        accessToken: 'fresh-access',
      })
      release?.()

      // Retryable, not `null`. `null` would mean "reconnect", and there IS a
      // connection -- the one that just signed in. A retry reads it and
      // proceeds correctly, which is exactly what "retryable" promises.
      const failure = await rejection(flight)
      expect(failure).toBeInstanceOf(ChatGptRefreshRetryableError)

      // And the point of the test: nothing stale was revived.
      expect(store.current?.accessToken).toBe('fresh-access')
      expect(store.pending).toBeNull()
    })

    it('does not clear a sign-in that happened mid-flight when the grant is refused', async () => {
      // The other half: the same stale flight receiving a terminal grant
      // error used to call `clearTokens` and wipe the new sign-in.
      const store = new StoreDouble()
      store.current = expired()
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const fetchImpl = (async (input: string | URL) => {
        if (String(input) !== config.token_endpoint) throw new Error('unexpected')
        await gate
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'refresh_token_expired' }),
        }
      }) as unknown as typeof fetch

      const flight = build(store, fetchImpl).accessTokenFor(USER)
      await new Promise((resolve) => setImmediate(resolve))

      await store.clearTokens(USER)
      await store.save(USER, 'client-1', {
        ...expired(),
        accessToken: 'fresh-access',
      })
      const clearsBefore = store.cleared
      release?.()

      await expect(flight).resolves.toBeNull()
      // The reconnection survives: the stale flight's clear did not match.
      expect(store.current?.accessToken).toBe('fresh-access')
      expect(store.cleared).toBe(clearsBefore)
    })

    it('returns null when there is no connection at all', async () => {
      const store = new StoreDouble()
      store.current = null
      store.clientId = null
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: {} }))

      await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBeNull()
      expect(calls).toHaveLength(0)
    })
  })

  describe('what a refresh response may leave out', () => {
    it('keeps the stored scopes when the response omits scope', async () => {
      const store = new StoreDouble()
      store.current = expired()
      // No `scope` key at all -- OAuth may omit it when nothing changed.
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: true,
        body: without(rotated(), 'scope'),
      }))
      await build(store, fetchImpl).accessTokenFor(USER)

      expect(store.current?.scopes).toBe(SCOPES)
      expect(store.current?.sharing).toBe(true)
    })

    it('still honours a scope the response does state', async () => {
      // The fallback is for an omission only; a real change must land.
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: true,
        body: rotated({ scope: 'openid offline_access' }),
      }))
      await build(store, fetchImpl).accessTokenFor(USER)

      expect(store.current?.scopes).toBe('openid offline_access')
      expect(store.current?.sharing).toBe(false)
    })

    it('keeps the stored refresh token when the response issues no new one', async () => {
      // RFC 6749 section 6: the old refresh token stays valid unless a new
      // one is issued. Storing null here would end the connection's life
      // after its first refresh.
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: true,
        body: without(rotated(), 'refresh_token'),
      }))
      await build(store, fetchImpl).accessTokenFor(USER)

      expect(store.current?.refreshToken).toBe('old-refresh')
      expect(store.current?.accessToken).toBe('new-access')
    })

    it.each([
      ['access_token', /no access token/],
      ['id_token', /no identity token/],
    ])('rejects a response with no %s and changes nothing', async (key, message) => {
      const store = new StoreDouble()
      const before = expired()
      store.current = before
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: true,
        body: without(rotated(), key),
      }))

      const failure = await rejection(build(store, fetchImpl).accessTokenFor(USER))
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toMatch(message)
      expect(store.current).toBe(before)
      expect(store.pending).toBeNull()
      expect(store.cleared).toBe(0)
    })
  })

  describe('the pending rotation', () => {
    it('saves the rotation, then verifies it, then promotes it -- in that order', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const service = build(store, fetchImpl, async (args) => {
        store.events.push('verifyIdentity')
        return verifyAccepting(args)
      })

      await service.accessTokenFor(USER)

      expect(store.events).toEqual(['savePending', 'verifyIdentity', 'promotePending'])
    })

    it('leaves the rotation pending and the old row intact when verification fails', async () => {
      const store = new StoreDouble()
      const before = expired()
      store.current = before
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const service = build(store, fetchImpl, async () => {
        throw new Error('identity verification unavailable')
      })

      const failure = await rejection(service.accessTokenFor(USER))

      expect(failure).toBeInstanceOf(ChatGptRefreshRetryableError)
      expect((failure as Error).message).toMatch(/verification/i)
      expect(store.pending?.credentials.accessToken).toBe('new-access')
      expect(store.current).toBe(before)
      expect(store.cleared).toBe(0)
      expect(calls).toHaveLength(1)
    })

    it('resumes from the pending rotation without consuming the refresh token twice', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      let verifyShouldFail = true
      const service = build(store, fetchImpl, async (args) => {
        if (verifyShouldFail) throw new Error('identity verification unavailable')
        return verifyAccepting(args)
      })

      expect(await rejection(service.accessTokenFor(USER))).toBeInstanceOf(Error)
      verifyShouldFail = false

      await expect(service.accessTokenFor(USER)).resolves.toBe('new-access')

      // The second call verified the saved pending state; it did NOT post a
      // second refresh grant with an already-consumed refresh token.
      expect(calls).toHaveLength(1)
      expect(store.pending).toBeNull()
      expect(store.current?.accessToken).toBe('new-access')
    })

    it('resumes a rotation left by an earlier process without any network refresh', async () => {
      // A restart: nothing in memory, only what the store holds.
      const store = new StoreDouble()
      store.current = expired()
      store.pending = {
        credentials: { ...expired(), accessToken: 'saved-access', refreshToken: 'saved-refresh' },
        receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      }
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))

      await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBe('saved-access')
      expect(calls).toHaveLength(0)
      expect(store.current?.refreshToken).toBe('saved-refresh')
    })
  })

  describe('identity verification arguments', () => {
    it('verifies the rotation with a null nonce and a receipt time', async () => {
      // A double accepts anything, so without this the two arguments that
      // make refresh work at all would be unpinned.
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const seen: Array<{ nonce: string | null; verifyAt?: Date }> = []
      const service = build(store, fetchImpl, async (args) => {
        seen.push({ nonce: args.nonce, verifyAt: args.verifyAt })
        return { subject: 'sub-1' }
      })

      await service.accessTokenFor(USER)

      expect(seen).toHaveLength(1)
      // `null`, not undefined and not '': Task 6 refuses both.
      expect(seen[0]!.nonce).toBeNull()
      expect(seen[0]!.verifyAt).toBeInstanceOf(Date)
    })

    it('verifies a fresh rotation as of the moment it was received', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const verifiedAt: Date[] = []
      const service = build(store, fetchImpl, async (args) => {
        verifiedAt.push(args.verifyAt!)
        return verifyAccepting(args)
      })

      const before = Date.now()
      await service.accessTokenFor(USER)
      const after = Date.now()

      // The very instant that was saved beside the rotation...
      expect(verifiedAt[0]!.getTime()).toBe(store.savedReceivedAt[0]!.getTime())
      // ...and a real one, taken while this call ran.
      expect(verifiedAt[0]!.getTime()).toBeGreaterThanOrEqual(before)
      expect(verifiedAt[0]!.getTime()).toBeLessThanOrEqual(after)
    })

    it('verifies a resumed rotation as of when it was received, not now', async () => {
      // A signing-key outage can outlast the identity token without
      // invalidating the refresh token. Against today's clock this token is
      // long expired; against the moment it arrived it is fine.
      const receivedAt = new Date('2026-01-01T00:00:00.000Z')
      const store = new StoreDouble()
      store.current = expired()
      store.pending = {
        credentials: { ...expired(), accessToken: 'saved-access' },
        receivedAt,
      }
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const verifiedAt: Date[] = []
      const service = build(store, fetchImpl, async (args) => {
        verifiedAt.push(args.verifyAt!)
        return verifyAccepting(args)
      })

      await service.accessTokenFor(USER)

      expect(verifiedAt).toHaveLength(1)
      expect(verifiedAt[0]!.getTime()).toBe(receivedAt.getTime())
    })

    it('verifies against this client and issuer, with the discovered key set', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const seen: Array<Parameters<VerifyIdentity>[0]> = []
      const service = build(store, fetchImpl, async (args) => {
        seen.push(args)
        return verifyAccepting(args)
      })

      await service.accessTokenFor(USER)

      expect(seen[0]).toMatchObject({
        idToken: 'new-id',
        clientId: 'client-1',
        issuer: config.issuer,
        jwksUri: config.jwks_uri,
      })
    })
  })

  describe('a rejected or changed identity', () => {
    it('clears the connection and returns null when the refresh token is rejected', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: false,
        body: { error: 'invalid_grant' },
      }))

      await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBeNull()
      expect(store.cleared).toBe(1)
      expect(store.current).toBeNull()
    })

    it('clears the connection and returns null when the identity is a different account', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const service = build(store, fetchImpl, async () => ({ subject: 'someone-else' }))

      await expect(service.accessTokenFor(USER)).resolves.toBeNull()
      expect(store.cleared).toBe(1)
      expect(store.current).toBeNull()
      expect(store.pending).toBeNull()
      expect(store.events).not.toContain('promotePending')
    })

    it.each([
      ['a server error', { ok: false, status: 503, body: {} }],
      ['another OAuth error', { ok: false, status: 400, body: { error: 'invalid_request' } }],
      ['an unreadable error body', { ok: false, status: 502, unparseable: 'not json' }],
    ] satisfies Array<[string, Reply]>)(
      'keeps the connection when the endpoint answers with %s',
      async (_label, reply) => {
        const store = new StoreDouble()
        const before = expired()
        store.current = before
        const { fetchImpl } = tokenEndpointSpy(() => reply)

        const failure = await rejection(build(store, fetchImpl).accessTokenFor(USER))

        expect(failure).toBeInstanceOf(ChatGptRefreshRetryableError)
        expect((failure as Error).message).toContain(`status ${reply.status}`)
        expect(store.cleared).toBe(0)
        expect(store.current).toBe(before)
        expect(store.pending).toBeNull()
      },
    )

    it('keeps the connection when the endpoint cannot be reached', async () => {
      const store = new StoreDouble()
      const before = expired()
      store.current = before
      const unreachable = (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch

      const failure = await rejection(build(store, unreachable).accessTokenFor(USER))

      expect(failure).toBeInstanceOf(ChatGptRefreshRetryableError)
      expect(store.cleared).toBe(0)
      expect(store.current).toBe(before)
    })
  })

  describe('a promotion that did not land', () => {
    // `promotePending` is false when its compare-and-swap lost, which leaves
    // the OLD credentials live. Each case below forces the competing write
    // to land *between* the pending save and the promotion; in a sequential
    // suite nothing else would, and a service that ignored the boolean would
    // pass every other test here.

    it('returns null when the user disconnected while the identity was being verified', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const service = build(store, fetchImpl, async (args) => {
        await store.clearTokens(USER)
        return verifyAccepting(args)
      })

      await expect(service.accessTokenFor(USER)).resolves.toBeNull()
      // Nothing was revived by the rotation that was in progress.
      expect(store.current).toBeNull()
      expect(store.pending).toBeNull()
    })

    it('returns the credentials of a sign-in that landed while it was verifying', async () => {
      const store = new StoreDouble()
      store.current = expired()
      const { fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const service = build(store, fetchImpl, async (args) => {
        await store.save(USER, 'client-1', fresh('reconnected-access'))
        return verifyAccepting(args)
      })

      await expect(service.accessTokenFor(USER)).resolves.toBe('reconnected-access')
      expect(store.current?.accessToken).toBe('reconnected-access')
    })

    it('reports a superseded rotation instead of handing out a token that is not stored', async () => {
      const store = new StoreDouble()
      const before = expired()
      store.current = before
      const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: rotated() }))
      const competing = { ...expired(), accessToken: 'competing-access', refreshToken: 'competing-refresh' }
      let competeOnce = true
      store.onPromoteRead = async () => {
        if (!competeOnce) return
        competeOnce = false
        // The competing write is a legitimate newer rotation from the SAME
        // live credential, so it carries the current generation.
        const live = await store.loadLive(USER)
        await store.savePending(USER, competing, new Date(), live!.generation)
      }
      const service = build(store, fetchImpl)

      const failure = await rejection(service.accessTokenFor(USER))

      expect(failure).toBeInstanceOf(ChatGptRefreshRetryableError)
      expect((failure as Error).message).toMatch(/superseded/)
      // The old credentials are still the live ones, and the newer rotation
      // is the one that is saved.
      expect(store.current).toBe(before)
      expect(store.pending?.credentials.accessToken).toBe('competing-access')

      // The next call resumes that rotation; it does not replay a token.
      await expect(service.accessTokenFor(USER)).resolves.toBe('competing-access')
      expect(calls).toHaveLength(1)
    })
  })

  describe('a disconnect during the refresh', () => {
    it('ends the attempt with null and does not resurrect the connection', async () => {
      const store = new StoreDouble()
      store.current = expired()
      let verifications = 0
      // The user clicks Disconnect while the POST is outstanding.
      const { fetchImpl } = tokenEndpointSpy(async () => {
        await store.clearTokens(USER)
        return { ok: true, body: rotated() }
      })
      const service = build(store, fetchImpl, async (args) => {
        verifications += 1
        return verifyAccepting(args)
      })

      // `savePending` throws here; that is the attempt being over, not a
      // failure to retry.
      await expect(service.accessTokenFor(USER)).resolves.toBeNull()

      expect(store.current).toBeNull()
      expect(store.pending).toBeNull()
      expect(verifications).toBe(0)
    })
  })

  describe('what never reaches an error message', () => {
    // Sentinels that cannot occur by accident: upper-case, hyphenated, long.
    const SECRET_ACCESS = 'SENTINEL-ACCESS-TOKEN-7d41e9'
    const SECRET_ID = 'SENTINEL-ID-TOKEN-b2c80f'
    const SECRET_REFRESH = 'SENTINEL-REFRESH-TOKEN-91a3d6'

    it('keeps token material out of a verification failure', async () => {
      const store = new StoreDouble()
      store.current = { ...expired(), refreshToken: SECRET_REFRESH }
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: true,
        body: rotated({ access_token: SECRET_ACCESS, id_token: SECRET_ID }),
      }))
      const service = build(store, fetchImpl, async () => {
        throw new Error(`could not verify ${SECRET_ID}`)
      })

      const failure = (await rejection(service.accessTokenFor(USER))) as Error

      expect(failure).toBeInstanceOf(ChatGptRefreshRetryableError)
      for (const secret of [SECRET_ACCESS, SECRET_ID, SECRET_REFRESH]) {
        expect(failure.message).not.toContain(secret)
      }
    })

    it('keeps token material out of an unparseable response', async () => {
      const store = new StoreDouble()
      store.current = { ...expired(), refreshToken: SECRET_REFRESH }
      // `json()` on a bad body quotes its first characters.
      const { fetchImpl } = tokenEndpointSpy(() => ({
        ok: true,
        unparseable: `Unexpected token in {"access_token":"${SECRET_ACCESS}"`,
      }))

      const failure = (await rejection(build(store, fetchImpl).accessTokenFor(USER))) as Error

      expect(failure).toBeInstanceOf(Error)
      expect(failure.message).toMatch(/could not be parsed/)
      for (const secret of [SECRET_ACCESS, SECRET_ID, SECRET_REFRESH]) {
        expect(failure.message).not.toContain(secret)
      }
    })
  })
})
