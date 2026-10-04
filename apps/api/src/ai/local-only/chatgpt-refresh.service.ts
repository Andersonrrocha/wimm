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
    this.cause = cause
  }
}

/**
 * Collaborators arrive as one object so a spec can substitute each without a
 * DI container. `local-only-ai.module.ts` supplies the real ones with a
 * factory (the store takes a plain-string secret, so Nest cannot resolve it
 * by type anyway).
 */
export interface ChatGptRefreshDeps {
  store: Pick<
    ChatGptConnectionStore,
    | 'load'
    | 'loadPending'
    | 'loadClientId'
    | 'savePending'
    | 'promotePending'
    | 'clearTokens'
  >
  discover: () => Promise<OidcConfig>
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
    const live = await this.store.load(userId)
    if (live === null) return null
    if (!isExpired(live)) return live.accessToken

    // A rotation saved by an earlier attempt means the live refresh token has
    // already been consumed. Finish that one; never post the old token again.
    const pending = await this.store.loadPending(userId)
    if (pending !== null) {
      const context = await this.context(userId)
      if (context === null) return null
      return this.completeRotation(userId, context, pending)
    }

    // `offline_access` was not granted: nothing to refresh with. Fail here
    // rather than post a grant that is certain to be refused.
    if (live.refreshToken === null) return null

    const context = await this.context(userId)
    if (context === null) return null
    return this.rotate(userId, context, live, live.refreshToken)
  }

  private async context(
    userId: string,
  ): Promise<{ clientId: string; config: OidcConfig } | null> {
    const clientId = await this.store.loadClientId(userId)
    if (clientId === null) return null
    return { clientId, config: await this.discover() }
  }

  /** Posts the refresh grant and persists what comes back as a pending rotation. */
  private async rotate(
    userId: string,
    context: { clientId: string; config: OidcConfig },
    live: ChatGptCredentials,
    refreshToken: string,
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
      if (await isInvalidGrant(response)) {
        // The refresh token itself was refused: this connection is over.
        await this.store.clearTokens(userId)
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
      await this.store.savePending(userId, credentials, receivedAt)
    } catch {
      // The store refuses when there is no live connection, i.e. the user
      // disconnected while this refresh was in flight. That attempt is over:
      // nothing is saved and nothing may be revived, so this is a plain
      // `null`, not a retry.
      return null
    }
    return this.completeRotation(userId, context, {
      credentials,
      receivedAt,
    })
  }

  /** Verifies a saved rotation and, only if that succeeds, makes it live. */
  private async completeRotation(
    userId: string,
    context: { clientId: string; config: OidcConfig },
    rotation: PendingRotation,
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
      await this.store.clearTokens(userId)
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

function isExpired(credentials: ChatGptCredentials): boolean {
  return credentials.expiresAt.getTime() <= Date.now()
}

/** The body of a refused grant, read only to see whether it says `invalid_grant`. */
async function isInvalidGrant(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.json()
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as { error?: unknown }).error === 'invalid_grant'
    )
  } catch {
    return false
  }
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
