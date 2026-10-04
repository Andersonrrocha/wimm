import { createHash, randomBytes } from 'crypto'
import {
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  DYNAMIC_CLIENT_ID,
  type OidcConfig,
} from './chatgpt-oidc'

/** 32 random bytes base64url-encoded: 43 chars, inside PKCE's 43..128 range. */
const randomValue = (): string => randomBytes(32).toString('base64url')

export interface AuthorizeRequest {
  url: string
  verifier: string
  state: string
  nonce: string
}

/**
 * Builds one authorization request. The caller must retain `verifier`,
 * `state` and `nonce` and verify the latter two later -- generating them and
 * then not checking them is the classic way to ship PKCE that proves nothing.
 *
 * `agent_name_hint` is sent only when no client ID is stored yet: dynamic
 * registration issues a durable per-installation client ID, and re-sending
 * the hint on later authorizations would request a second registration.
 */
export function createAuthorizeRequest(args: {
  config: OidcConfig
  redirectUri: string
  appName: string
  existingClientId?: string
}): AuthorizeRequest {
  const verifier = randomValue()
  const state = randomValue()
  const nonce = randomValue()
  const url = new URL(args.config.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.existingClientId ?? DYNAMIC_CLIENT_ID)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('scope', CHATGPT_SCOPES)
  url.searchParams.set('resource', CHATGPT_RESOURCE)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(verifier).digest('base64url'),
  )
  if (!args.existingClientId) {
    url.searchParams.set('agent_name_hint', args.appName)
  }
  return { url: url.toString(), verifier, state, nonce }
}
