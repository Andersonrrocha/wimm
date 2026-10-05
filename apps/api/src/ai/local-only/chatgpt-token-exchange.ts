import { createPublicKey } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import {
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  type OidcConfig,
} from './chatgpt-oidc'
import {
  readExpiresInSeconds,
  readJsonObject,
} from './chatgpt-token-response'

export const SHARING_SCOPE = 'chatgpt.tokens.use.direct'

/**
 * Whether the granted scopes actually permit plan usage.
 *
 * `sharing` is **derived, not claimed.** There is no `sharing` claim in the
 * `id_token`; an earlier draft of this plan said to read one and invented a
 * claim URI for it. Do not look for it.
 */
export function isSharingGranted(scopes: string): boolean {
  return scopes.split(/\s+/).filter(Boolean).includes(SHARING_SCOPE)
}

/**
 * What a verified `id_token` is allowed to tell the rest of the app.
 *
 * `accountLabel` comes from here, and only from here, on purpose. We request
 * `openid profile email`, so the token carries an `email` claim -- but
 * reading it with a second, unverified `decode` would be trusting the token
 * twice over, once for identity and once for display. Everything already
 * verified about this token (signature, issuer, audience, `azp`, nonce,
 * expiry) covers the claim as well, so the label leaves with the subject.
 */
export interface VerifiedIdentity {
  subject: string
  /**
   * The `email` claim when the verified payload carries a non-empty string,
   * otherwise `null`. Never a placeholder: a connection whose token names no
   * account has no account name to show, and the UI says so.
   */
  accountLabel: string | null
}

export interface ChatGptCredentials {
  accessToken: string
  /**
   * `null` when `offline_access` was not granted, meaning this connection
   * cannot be refreshed and will need a fresh sign-in when it expires.
   * Deliberately not `''`: an empty string would flow into a refresh grant
   * as a real-looking value and fail at the server instead of here.
   */
  refreshToken: string | null
  idToken: string
  expiresAt: Date
  scopes: string
  subject: string
  sharing: boolean
}

/**
 * SPKI PEM signing keys, by `jwks_uri` then by `kid`.
 *
 * PEM rather than `KeyObject` because `JwtVerifyOptions.publicKey` is typed
 * `string | Buffer` (verified against @nestjs/jwt 11.0.2).
 */
const keyCache = new Map<string, Map<string, string>>()

async function fetchSigningKey(
  jwksUri: string,
  kid: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const cached = keyCache.get(jwksUri)?.get(kid)
  if (cached !== undefined) return cached

  const response = await fetchImpl(jwksUri)
  if (!response.ok) {
    throw new Error(
      `ChatGPT signing keys are unavailable (status ${response.status}).`,
    )
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // `json()` on a non-JSON body quotes its first characters. This body is
    // not secret, but the wrapper keeps every message in this module static.
    throw new Error('ChatGPT signing keys could not be parsed.')
  }
  const keys =
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { keys?: unknown }).keys)
      ? ((body as { keys: unknown[] }).keys as Array<Record<string, unknown>>)
      : []
  // `Array.isArray` says nothing about the elements: a `null` entry would
  // make the predicate below throw a raw TypeError.
  const jwk = keys.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      candidate.kid === kid,
  )
  if (jwk === undefined) {
    throw new Error('ChatGPT signing key for this token was not found.')
  }

  // An unsupported `kty` (an `oct` entry, say) makes `createPublicKey` throw
  // a raw TypeError naming the kty. Wrap it so the message stays ours.
  let pem: string
  try {
    pem = createPublicKey({ key: jwk as never, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' })
      .toString()
  } catch {
    throw new Error('ChatGPT signing key is not a usable public key.')
  }

  const perUri = keyCache.get(jwksUri) ?? new Map<string, string>()
  perUri.set(kid, pem)
  keyCache.set(jwksUri, perUri)
  return pem
}

/**
 * Forget one key so a rotation is re-fetched on the next attempt.
 *
 * Without this, a key rotated mid-session would fail every verification
 * until the process restarted, which for a desktop app means until the user
 * quits WIMM.
 */
function forgetSigningKey(jwksUri: string, kid: string): void {
  keyCache.get(jwksUri)?.delete(kid)
}

export async function verifyIdentity(args: {
  idToken: string
  clientId: string
  issuer: string
  jwksUri: string
  /**
   * The nonce generated for the authorize request, or **`null` to state that
   * there is no nonce to compare** -- which is true of a refresh, because no
   * new authorize request happened. `null` is the only way to say that: an
   * `undefined` or empty string is refused, so "forgot to pass it" can never
   * be mistaken for "deliberately absent". The reference implementation
   * makes the same distinction, passing `undefined` on refresh and a real
   * nonce on the initial exchange.
   */
  nonce: string | null
  /**
   * Verify as of this moment rather than now. Set it to when the token was
   * RECEIVED when resuming a saved rotation: a signing-key outage can
   * outlast the identity token without invalidating the refresh token, and
   * verifying such a token against the current clock would fail permanently
   * on a refresh token that has already been consumed.
   */
  verifyAt?: Date
  fetchImpl?: typeof fetch
}): Promise<VerifiedIdentity> {
  // `jsonwebtoken` guards its own checks with truthiness -- `if
  // (options.audience)`, `if (options.issuer)` -- so an empty string does not
  // relax the check, it SKIPS it entirely. And a `nonce` of `undefined`
  // compared against an absent claim is `undefined !== undefined`, which is
  // false, so it passes. All three therefore fail OPEN. TypeScript forbids
  // them at today's single call site, but this function is exported and Task
  // 8 calls it directly, so the guard belongs here rather than in the
  // caller.
  if (!args.clientId || !args.issuer) {
    throw new Error(
      'ChatGPT identity verification refuses to run without a client id and an issuer.',
    )
  }
  // `null` is a decision; anything else falsy is a mistake.
  if (args.nonce !== null && (typeof args.nonce !== 'string' || !args.nonce)) {
    throw new Error(
      'ChatGPT identity verification requires a nonce, or an explicit null when refreshing.',
    )
  }

  const jwt = new JwtService()
  // `decode` throws a raw SyntaxError when the payload is not JSON, and that
  // message quotes the first characters of the payload -- a fragment of the
  // token. Wrap it so nothing from the token can reach a message.
  let decoded: { header?: { kid?: unknown } } | null
  try {
    decoded = jwt.decode<{ header?: { kid?: unknown } } | null>(args.idToken, {
      complete: true,
    })
  } catch {
    throw new Error('ChatGPT identity token could not be decoded.')
  }
  const kid = decoded?.header?.kid
  if (typeof kid !== 'string' || !kid) {
    throw new Error('ChatGPT identity token has no usable key id.')
  }

  const publicKey = await fetchSigningKey(
    args.jwksUri,
    kid,
    args.fetchImpl ?? fetch,
  )

  let payload: {
    sub?: unknown
    nonce?: unknown
    exp?: unknown
    aud?: unknown
    azp?: unknown
    email?: unknown
  }
  try {
    payload = await jwt.verifyAsync(args.idToken, {
      publicKey,
      algorithms: ['RS256'],
      issuer: args.issuer,
      audience: args.clientId,
      // `clockTimestamp` is in seconds (jsonwebtoken's convention).
      ...(args.verifyAt === undefined
        ? {}
        : { clockTimestamp: Math.floor(args.verifyAt.getTime() / 1000) }),
    })
  } catch (error) {
    // A rotated key looks exactly like a bad signature from here, so drop
    // the cached one and let the next attempt re-fetch.
    forgetSigningKey(args.jwksUri, kid)
    throw new Error(
      `ChatGPT identity could not be verified: ${(error as Error).message}`,
    )
  }

  // Generated in Task 4 and checked here. Generating a nonce and not
  // comparing it is the same class of mistake as unchecked PKCE.
  if (args.nonce !== null && payload.nonce !== args.nonce) {
    throw new Error('ChatGPT identity nonce did not match the request.')
  }
  // OIDC Core: whenever `azp` is present it must be this client, and when
  // `aud` carries more than one value `azp` is REQUIRED and must be this
  // client. Checking `audience` alone accepts a token minted for several
  // clients at once, of which we are merely one.
  if (payload.azp !== undefined && payload.azp !== args.clientId) {
    throw new Error('ChatGPT identity was authorized for another client.')
  }
  if (
    Array.isArray(payload.aud) &&
    payload.aud.length > 1 &&
    payload.azp !== args.clientId
  ) {
    throw new Error(
      'ChatGPT identity has multiple audiences without naming this client as the authorized party.',
    )
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('ChatGPT identity token has no subject.')
  }
  // OIDC Core makes `exp` REQUIRED, but `jsonwebtoken` only enforces it when
  // the claim is present -- so a validly signed token with no `exp` is
  // otherwise accepted and never expires.
  if (typeof payload.exp !== 'number') {
    throw new Error('ChatGPT identity token has no expiry.')
  }
  // Trimmed, and whitespace-only folded into `null`: a label exists to be
  // shown, and `' '` is indistinguishable from no label on screen while
  // being truthy in code.
  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  return { subject: payload.sub, accountLabel: email === '' ? null : email }
}

/**
 * What one authorization-code exchange produces: the credentials to store,
 * plus the account label from the identity verified inside it.
 *
 * The label rides along rather than becoming a `ChatGptCredentials` field
 * because it is not a credential and is not encrypted with them -- it is a
 * plain column the status endpoint reads. An intersection rather than a
 * wrapper object so every existing caller of `exchangeCode` keeps reading
 * `result.accessToken`; the connect flow splits the label off with a rest
 * destructure before handing the credentials to the store.
 */
export type ChatGptExchange = ChatGptCredentials & {
  accountLabel: string | null
}

export async function exchangeCode(args: {
  config: OidcConfig
  clientId: string
  code: string
  verifier: string
  redirectUri: string
  nonce: string
  fetchImpl?: typeof fetch
}): Promise<ChatGptExchange> {
  const fetchImpl = args.fetchImpl ?? fetch
  const response = await fetchImpl(args.config.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    // `fetch` follows a 307/308 and RE-SENDS the body, which here is the
    // authorization code and the PKCE verifier. The endpoint is pinned by
    // discovery and https-checked, but a redirect would still forward both
    // to wherever it points. Refuse instead of following.
    redirect: 'error',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: args.clientId,
      code: args.code,
      code_verifier: args.verifier,
      redirect_uri: args.redirectUri,
      resource: CHATGPT_RESOURCE,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(
      `ChatGPT token exchange failed (status ${response.status}).`,
    )
  }
  const data = await readJsonObject(response, 'ChatGPT token response')

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('ChatGPT token exchange returned no access token.')
  }
  if (typeof data.id_token !== 'string' || !data.id_token) {
    throw new Error('ChatGPT token exchange returned no identity token.')
  }
  // RFC 6749 section 5.1 makes `scope` OPTIONAL in a token response when it
  // is identical to what was requested. Reading an omission as "no scopes"
  // is exactly backwards and breaks the happy path twice over: `sharing`
  // would be false, telling the user their plan lacks a capability it just
  // granted, and the `offline_access` requirement below would be skipped so
  // a missing refresh token would pass unnoticed. An omission means "what
  // you asked for". Task 8 already applies the same fallback on refresh;
  // this keeps the two consistent.
  const scopes =
    typeof data.scope === 'string' && data.scope ? data.scope : CHATGPT_SCOPES
  const needsRefresh = scopes.split(/\s+/).includes('offline_access')
  if (
    needsRefresh &&
    (typeof data.refresh_token !== 'string' || !data.refresh_token)
  ) {
    throw new Error(
      'ChatGPT token exchange granted offline_access but returned no refresh token.',
    )
  }
  const expiresInSeconds = readExpiresInSeconds(data.expires_in)

  const identity = await verifyIdentity({
    idToken: data.id_token,
    clientId: args.clientId,
    issuer: args.config.issuer,
    jwksUri: args.config.jwks_uri,
    nonce: args.nonce,
    fetchImpl,
  })

  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : null,
    idToken: data.id_token,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    scopes,
    subject: identity.subject,
    sharing: isSharingGranted(scopes),
    accountLabel: identity.accountLabel,
  }
}
