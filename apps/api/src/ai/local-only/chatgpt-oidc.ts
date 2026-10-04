/**
 * Protocol constants and OIDC discovery for ChatGPT plan usage.
 *
 * Only the issuer is fixed; every endpoint is discovered, and the discovery
 * document is rejected unless its own `issuer` matches. That check is what
 * stops a redirected or substituted discovery response from pointing the
 * token exchange at an attacker-controlled endpoint.
 */
export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1'
export const CHATGPT_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export const CHATGPT_CALLBACK_PATH = '/auth/callback'
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'

const REQUIRED_ENDPOINTS = [
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
  'revocation_endpoint',
] as const

export interface OidcConfig {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  revocation_endpoint: string
}

export async function discoverOidcConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<OidcConfig> {
  const response = await fetchImpl(
    `${CHATGPT_ISSUER}/.well-known/openid-configuration`,
  )
  if (!response.ok) {
    throw new Error(
      `ChatGPT OIDC discovery failed with status ${response.status}.`,
    )
  }
  const data: unknown = await response.json()
  if (typeof data !== 'object' || data === null) {
    throw new Error('ChatGPT OIDC discovery returned a non-object document.')
  }
  const document = data as Record<string, unknown>
  if (document.issuer !== CHATGPT_ISSUER) {
    throw new Error(
      `ChatGPT OIDC discovery issuer mismatch: expected ${CHATGPT_ISSUER}.`,
    )
  }
  for (const key of REQUIRED_ENDPOINTS) {
    if (typeof document[key] !== 'string' || !document[key]) {
      throw new Error(`ChatGPT OIDC discovery is missing ${key}.`)
    }
  }
  return document as unknown as OidcConfig
}
