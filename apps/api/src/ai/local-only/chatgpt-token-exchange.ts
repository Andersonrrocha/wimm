import { createPublicKey } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import {
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  type OidcConfig,
} from './chatgpt-oidc'

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
  nonce: string
  fetchImpl?: typeof fetch
}): Promise<{ subject: string }> {
  // `jsonwebtoken` guards its own checks with truthiness -- `if
  // (options.audience)`, `if (options.issuer)` -- so an empty string does not
  // relax the check, it SKIPS it entirely. And a `nonce` of `undefined`
  // compared against an absent claim is `undefined !== undefined`, which is
  // false, so it passes. All three therefore fail OPEN. TypeScript forbids
  // them at today's single call site, but this function is exported and Task
  // 8 calls it directly, so the guard belongs here rather than in the
  // caller.
  if (!args.clientId || !args.issuer || !args.nonce) {
    throw new Error(
      'ChatGPT identity verification refuses to run without a client id, an issuer and a nonce.',
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

  let payload: { sub?: unknown; nonce?: unknown; exp?: unknown }
  try {
    payload = await jwt.verifyAsync(args.idToken, {
      publicKey,
      algorithms: ['RS256'],
      issuer: args.issuer,
      audience: args.clientId,
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
  if (payload.nonce !== args.nonce) {
    throw new Error('ChatGPT identity nonce did not match the request.')
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
  return { subject: payload.sub }
}

export async function exchangeCode(args: {
  config: OidcConfig
  clientId: string
  code: string
  verifier: string
  redirectUri: string
  nonce: string
  fetchImpl?: typeof fetch
}): Promise<ChatGptCredentials> {
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
  // `json()` on a malformed body quotes its first characters, and this body
  // carries the tokens -- a parse error could put a fragment of one into the
  // message. Wrap it, and reject a JSON `null`, which would otherwise make
  // every field read below throw a raw TypeError.
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new Error('ChatGPT token response could not be parsed.')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('ChatGPT token response was not an object.')
  }
  const data = parsed as Record<string, unknown>

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
  // `Number.isFinite` alone is not enough: 1e13 produces a Date of
  // "Invalid Date", and every later `expiresAt <= now` comparison is false
  // for NaN, so the credential reads as never expiring. Clamp to a year,
  // which is far beyond any real access-token lifetime.
  const MAX_EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60
  const expiresInSeconds =
    typeof data.expires_in === 'number' &&
    Number.isFinite(data.expires_in) &&
    data.expires_in > 0
      ? Math.min(data.expires_in, MAX_EXPIRES_IN_SECONDS)
      : 0

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
  }
}
