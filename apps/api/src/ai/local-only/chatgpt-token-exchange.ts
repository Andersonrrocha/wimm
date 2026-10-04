import { createPublicKey } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import { CHATGPT_RESOURCE, type OidcConfig } from './chatgpt-oidc'

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
  refreshToken: string
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
  const body: unknown = await response.json()
  const keys =
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { keys?: unknown }).keys)
      ? ((body as { keys: unknown[] }).keys as Array<Record<string, unknown>>)
      : []
  const jwk = keys.find((candidate) => candidate.kid === kid)
  if (jwk === undefined) {
    throw new Error('ChatGPT signing key for this token was not found.')
  }

  const pem = createPublicKey({ key: jwk as never, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' })
    .toString()

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
  const jwt = new JwtService()
  const decoded = jwt.decode<{ header?: { kid?: unknown } } | null>(
    args.idToken,
    { complete: true },
  )
  const kid = decoded?.header?.kid
  if (typeof kid !== 'string' || !kid) {
    throw new Error('ChatGPT identity token has no usable key id.')
  }

  const publicKey = await fetchSigningKey(
    args.jwksUri,
    kid,
    args.fetchImpl ?? fetch,
  )

  let payload: { sub?: unknown; nonce?: unknown }
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
  const data = (await response.json()) as Record<string, unknown>

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('ChatGPT token exchange returned no access token.')
  }
  if (typeof data.id_token !== 'string' || !data.id_token) {
    throw new Error('ChatGPT token exchange returned no identity token.')
  }
  const scopes = typeof data.scope === 'string' ? data.scope : ''
  const needsRefresh = scopes.split(/\s+/).includes('offline_access')
  if (
    needsRefresh &&
    (typeof data.refresh_token !== 'string' || !data.refresh_token)
  ) {
    throw new Error(
      'ChatGPT token exchange granted offline_access but returned no refresh token.',
    )
  }
  const expiresInSeconds =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
      ? data.expires_in
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
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : '',
    idToken: data.id_token,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    scopes,
    subject: identity.subject,
    sharing: isSharingGranted(scopes),
  }
}
