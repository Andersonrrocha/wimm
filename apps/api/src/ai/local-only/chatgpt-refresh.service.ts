import type {
  ChatGptConnectionStore,
  PendingRotation,
} from './chatgpt-connection.store'
import { CHATGPT_RESOURCE, type OidcConfig } from './chatgpt-oidc'
import {
  isSharingGranted,
  type ChatGptCredentials,
  type verifyIdentity,
} from './chatgpt-token-exchange'

/**
 * Bounds every network call this service makes, the identity-key fetch
 * included. Single-flight is what makes it necessary: a request that never
 * settles would otherwise leave its map entry in place, and every later
 * caller for that user would join a promise that never resolves.
 */
const REQUEST_TIMEOUT_MS = 30_000

/** Same ceiling Task 6 applies on the initial exchange. */
const MAX_EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60

/**
 * Nothing was lost: the stored credentials are untouched, or a rotation is
 * saved and will be resumed, so a later `accessTokenFor` may succeed.
 *
 * Contrast with a `null` result, which means there is no usable connection
 * and the user has to reconnect. The messages are static on purpose: this
 * service handles token material, and nothing from a response or a
 * collaborator's error text is allowed into a message. The original error
 * is kept on `cause` for whoever is debugging.
 */
export class ChatGptRefreshRetryableError extends Error {
  // `lib` stops at ES2021 here, so `ErrorOptions` is not available.
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ChatGptRefreshRetryableError'
    // Non-enumerable, as a native `cause` is. Every message this module
    // produces is static, but `cause` holds whatever a collaborator threw --
    // so it is the one place where "no credential in an error" would depend
    // on someone else's behaviour. Keeping it off the enumerable surface
    // keeps it out of `JSON.stringify`, out of a spread, and out of any log
    // line that serialises the object rather than reading `.message`.
    Object.defineProperty(this, 'cause', {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: true,
    })
  }
}

/**
 * Collaborators arrive as one object so a spec can substitute each without a
 * DI container.
 *
 * Wired into Nest by `local-only-ai.module.ts`, through a `useFactory`: this
 * takes one object rather than injectable parameters, and the store it is
 * given takes a plain-string secret that Nest cannot resolve by type either.
 * `ChatGptOAuthProvider` is its consumer.
 */
export interface ChatGptRefreshDeps {
  store: Pick<
    ChatGptConnectionStore,
    | 'load'
    | 'loadLive'
    | 'loadPending'
    | 'loadClientId'
    | 'savePending'
    | 'promotePending'
    | 'clearTokens'
  >
  /**
   * Takes the caller's `fetch` so discovery is bounded by the same timeout as
   * every other call here. Without it a discovery that never settles wedges
   * the user permanently: the first call never resolves, every later caller
   * joins the same single-flight promise, and the entry is never released
   * until the process restarts. Compatible with `discoverOidcConfig`, whose
   * signature is `(fetchImpl?: typeof fetch)`.
   */
  discover: (fetchImpl?: typeof fetch) => Promise<OidcConfig>
  fetchImpl: typeof fetch
  verifyIdentity: typeof verifyIdentity
  /** Per-request timeout; defaults to 30 seconds. */
  timeoutMs?: number
}

/**
 * Keeps one user's ChatGPT access token fresh.
 *
 * `accessTokenFor` resolves to a usable access token, to `null` when there is
 * no connection that can supply one (never connected, disconnected, no
 * refresh token, or the refresh token was rejected), or rejects with a
 * `ChatGptRefreshRetryableError` when trying again later may work.
 *
 * **Single-flight per user.** One import batch makes many categorize calls at
 * once; if each noticed the expired token and refreshed, they would race to
 * write different token pairs, and with a rotating refresh token every one
 * after the first would be spending an already-consumed token. This is the
 * desktop renderer's pattern (`isRefreshing` plus a queue drained when the
 * one refresh settles -- `apps/desktop/src/renderer/lib/api-client.ts`),
 * keyed per user, with the shared promise standing in for the queue: late
 * joiners get the same result or the same rejection, exactly as `drainQueue`
 * and `rejectQueue` deliver. The entry is removed in a `finally` so a failed
 * refresh does not poison the next call.
 *
 * **Rotation is written down before it is trusted.** A refresh consumes the
 * old refresh token at the server, so the new pair exists only in this
 * process until it is stored. It is therefore saved as a *pending* rotation
 * first (`savePending`), then its `id_token` is verified, and only then
 * promoted to the live credential. If verification cannot complete -- the
 * signing-key service is down -- the pending rotation stays on disk and the
 * next call, including one after a restart, resumes from it instead of
 * posting a grant with a refresh token that no longer works.
 */
export class ChatGptRefreshService {
  private readonly inFlight = new Map<string, Promise<string | null>>()
  private readonly store: ChatGptRefreshDeps['store']
  private readonly discover: ChatGptRefreshDeps['discover']
  private readonly fetchImpl: typeof fetch
  private readonly verify: ChatGptRefreshDeps['verifyIdentity']

  constructor(deps: ChatGptRefreshDeps) {
    this.store = deps.store
    this.discover = deps.discover
    this.verify = deps.verifyIdentity
    const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS
    this.fetchImpl = (input, init) =>
      deps.fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  }

  accessTokenFor(userId: string): Promise<string | null> {
    const running = this.inFlight.get(userId)
    if (running !== undefined) return running

    const flight = this.resolve(userId).finally(() => {
      this.inFlight.delete(userId)
    })
    this.inFlight.set(userId, flight)
    return flight
  }

  private async resolve(userId: string): Promise<string | null> {
    // `loadLive` rather than `load`, for the generation marker: every write
    // below is conditional on the live credential still being THIS one. A
    // flight that started before a disconnect-and-reconnect would otherwise
    // write its stale rotation over the fresh sign-in, or wipe it on a
    // terminal error -- both reproduced against the real store in review.
    const live = await this.store.loadLive(userId)
    if (live === null) return null
    const { credentials, generation } = live
    if (!isExpired(credentials)) return credentials.accessToken

    // A rotation saved by an earlier attempt means the live refresh token has
    // already been consumed. Finish that one; never post the old token again.
    const pending = await this.store.loadPending(userId)
    if (pending !== null) {
      const context = await this.context(userId)
      if (context === null) return null
      return this.completeRotation(userId, context, pending, generation)
    }

    // `offline_access` was not granted: nothing to refresh with. Fail here
    // rather than post a grant that is certain to be refused.
    if (credentials.refreshToken === null) return null

    const context = await this.context(userId)
    if (context === null) return null
    return this.rotate(
      userId,
      context,
      credentials,
      credentials.refreshToken,
      generation,
    )
  }

  private async context(
    userId: string,
  ): Promise<{ clientId: string; config: OidcConfig } | null> {
    const clientId = await this.store.loadClientId(userId)
    if (clientId === null) return null
    return { clientId, config: await this.discover(this.fetchImpl) }
  }

  /** Posts the refresh grant and persists what comes back as a pending rotation. */
  private async rotate(
    userId: string,
    context: { clientId: string; config: OidcConfig },
    live: ChatGptCredentials,
    refreshToken: string,
    generation: string,
  ): Promise<string | null> {
    let response: Response
    try {
      response = await this.fetchImpl(context.config.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        // `fetch` follows a 307/308 and re-sends the body, which here carries
        // the refresh token. Refuse instead of following (as Task 6 does).
        redirect: 'error',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: context.clientId,
          refresh_token: refreshToken,
          resource: CHATGPT_RESOURCE,
        }).toString(),
      })
    } catch (cause) {
      throw new ChatGptRefreshRetryableError(
        'ChatGPT token refresh could not reach the token endpoint.',
        cause,
      )
    }
    // Taken the moment the response arrives: the identity token is verified
    // as of this instant, however long a signing-key outage delays the check.
    const receivedAt = new Date()

    if (!response.ok) {
      if (await isTerminalGrantFailure(response)) {
        // The refresh token itself was refused: this connection is over.
        // Conditional on the generation, so a flight that started before a
        // reconnect cannot wipe the fresh sign-in.
        await this.store.clearTokens(userId, generation)
        return null
      }
      // Anything else (a 5xx, a rate limit) says nothing about the grant, so
      // the connection is left exactly as it was.
      throw new ChatGptRefreshRetryableError(
        `ChatGPT token refresh failed (status ${response.status}).`,
      )
    }

    const credentials = readRotation(await readJson(response), live, receivedAt)

    try {
      await this.store.savePending(userId, credentials, receivedAt, generation)
    } catch (cause) {
      // The store refuses when there is no live connection, i.e. the user
      // disconnected while this refresh was in flight. That attempt is over:
      // nothing is saved and nothing may be revived, so it is a plain `null`.
      //
      // But a database error is not a disconnect, and answering `null` to it
      // tells the caller "reconnect" about a connection that is still there.
      // Distinguish the two by re-reading: gone means disconnected.
      const stillLive = await this.store.load(userId).catch(() => null)
      if (stillLive === null) return null
      throw new ChatGptRefreshRetryableError(
        'ChatGPT rotated credentials could not be saved; the next call starts again from the stored connection.',
        cause,
      )
    }
    return this.completeRotation(
      userId,
      context,
      { credentials, receivedAt },
      generation,
    )
  }

  /** Verifies a saved rotation and, only if that succeeds, makes it live. */
  private async completeRotation(
    userId: string,
    context: { clientId: string; config: OidcConfig },
    rotation: PendingRotation,
    /** The live generation this flight read; every write stays conditional on it. */
    generation: string,
  ): Promise<string | null> {
    let identity: { subject: string }
    try {
      identity = await this.verify({
        idToken: rotation.credentials.idToken,
        clientId: context.clientId,
        issuer: context.config.issuer,
        jwksUri: context.config.jwks_uri,
        // A refresh has no authorize request, so there is no nonce to match.
        // `null` states that deliberately; Task 6 refuses `undefined` and ''.
        nonce: null,
        // As of when the token arrived, not now. A signing-key outage can
        // outlast the identity token without invalidating the refresh token;
        // against the current clock a resumed rotation would fail for good,
        // on a refresh token that has already been consumed.
        verifyAt: rotation.receivedAt,
        fetchImpl: this.fetchImpl,
      })
    } catch (cause) {
      // The rotation stays pending, so the next call resumes it.
      throw new ChatGptRefreshRetryableError(
        'ChatGPT identity verification did not complete; the rotated credentials stay saved and the next call resumes from them.',
        cause,
      )
    }

    // The pending credentials carry the stored subject (it is not known
    // before verification). A refresh must stay the same account, so a
    // different verified subject means these tokens cannot be trusted.
    if (identity.subject !== rotation.credentials.subject) {
      // Conditional on the generation: a flight that started before a
      // reconnect must not clear that reconnection's credentials.
      await this.store.clearTokens(userId, generation)
      return null
    }

    if (await this.store.promotePending(userId)) {
      return rotation.credentials.accessToken
    }
    return this.afterLostPromotion(userId)
  }

  /**
   * `promotePending` returned false: its compare-and-swap lost, so what is
   * live is NOT this rotation. Assuming success would hand out a token that
   * is not stored, and the next refresh would replay the consumed refresh
   * token -- which a server that detects reuse may answer by revoking the
   * whole grant. Look at what actually is stored instead.
   */
  private async afterLostPromotion(userId: string): Promise<string | null> {
    const live = await this.store.load(userId)
    // Disconnected while the identity was being verified.
    if (live === null) return null
    // Reconnected in the meantime; that sign-in's credentials are current.
    if (!isExpired(live)) return live.accessToken
    // A newer rotation replaced this one. It is saved, and the next call
    // resumes it.
    throw new ChatGptRefreshRetryableError(
      'ChatGPT credential rotation was superseded before it could be promoted; the next call resumes from what is saved.',
    )
  }
}

/**
 * Treat a token as expired slightly before it is, so one that would die
 * mid-request is refreshed first.
 *
 * Without this, a token with two seconds left passes the check, the
 * categorize request starts, and the token expires in flight -- a 401 and a
 * wasted round trip. Task 9 must still retry a 401 by calling
 * `accessTokenFor` again, because this cannot cover clock skew between this
 * machine and OpenAI; the skew covers request latency, the retry covers
 * disagreement about the time.
 */
const EXPIRY_SKEW_MS = 60_000

function isExpired(credentials: ChatGptCredentials): boolean {
  return credentials.expiresAt.getTime() - EXPIRY_SKEW_MS <= Date.now()
}

/**
 * The codes that mean this refresh token is dead and only a new sign-in will
 * help. Taken from OpenAI's reference implementation, which applies exactly
 * this set to `grant_type=refresh_token` responses -- and explicitly NOT to
 * the authorization-code exchange or to API admission failures, including a
 * plain 401.
 *
 * Matching only `invalid_grant`, as an earlier version did, leaves the other
 * five classified as retryable: the connection would never clear, never
 * report "reconnect", and every later call would post the same dead token
 * forever with no automatic way out.
 */
const TERMINAL_GRANT_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
])

/** Whether a refused grant says the refresh token itself is finished. */
async function isTerminalGrantFailure(response: Response): Promise<boolean> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // An unreadable body is not evidence that the token is dead.
    return false
  }
  if (typeof body !== 'object' || body === null) return false
  const error = (body as { error?: unknown }).error
  // Two shapes: `error` as a bare code, and `error: { code }`. Exact matches
  // only -- a description that merely contains a code must not count.
  if (typeof error === 'string') return TERMINAL_GRANT_ERRORS.has(error)
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' && TERMINAL_GRANT_ERRORS.has(code)
  }
  return false
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  // `json()` on a malformed body quotes its first characters, and this body
  // carries the tokens. Wrap it, and reject a JSON `null`.
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new Error('ChatGPT token refresh response could not be parsed.')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('ChatGPT token refresh response was not an object.')
  }
  return parsed as Record<string, unknown>
}

/**
 * Builds the rotated credentials from a refresh response, filling in what a
 * refresh response may legitimately leave out.
 *
 * - `scope`: RFC 6749 section 5.1 makes it optional when unchanged, so an
 *   omission means "what is stored", not "no scopes". Reading it as a
 *   downgrade would turn `sharing` off for a user who lost nothing. This is
 *   the same fallback Task 6 applies on the initial exchange.
 * - `refresh_token`: section 6 says the server MAY issue a new one; when it
 *   does not, the old one stays valid. Storing `null` would make the
 *   connection unrefreshable after its first refresh.
 *
 * `subject` is the stored one, provisionally; `completeRotation` checks it
 * against the verified identity before anything is promoted.
 */
function readRotation(
  data: Record<string, unknown>,
  live: ChatGptCredentials,
  receivedAt: Date,
): ChatGptCredentials {
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('ChatGPT token refresh returned no access token.')
  }
  if (typeof data.id_token !== 'string' || !data.id_token) {
    throw new Error('ChatGPT token refresh returned no identity token.')
  }
  const scopes =
    typeof data.scope === 'string' && data.scope ? data.scope : live.scopes
  const expiresInSeconds =
    typeof data.expires_in === 'number' &&
    Number.isFinite(data.expires_in) &&
    data.expires_in > 0
      ? Math.min(data.expires_in, MAX_EXPIRES_IN_SECONDS)
      : 0
  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : live.refreshToken,
    idToken: data.id_token,
    expiresAt: new Date(receivedAt.getTime() + expiresInSeconds * 1000),
    scopes,
    subject: live.subject,
    sharing: isSharingGranted(scopes),
  }
}
