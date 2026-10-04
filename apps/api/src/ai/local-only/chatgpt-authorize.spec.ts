import { createHash } from 'crypto'
import { createAuthorizeRequest } from './chatgpt-authorize'
import { CHATGPT_RESOURCE, CHATGPT_SCOPES, DYNAMIC_CLIENT_ID } from './chatgpt-oidc'

const config = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}
const base = { config, redirectUri: 'http://127.0.0.1:51234/auth/callback', appName: 'WIMM' }

describe('createAuthorizeRequest', () => {
  it('derives code_challenge as base64url(sha256(verifier))', () => {
    const request = createAuthorizeRequest(base)
    const params = new URL(request.url).searchParams
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBe(
      createHash('sha256').update(request.verifier).digest('base64url'),
    )
  })

  it('sends the dynamic client id and an agent_name_hint on first registration', () => {
    const params = new URL(createAuthorizeRequest(base).url).searchParams
    expect(params.get('client_id')).toBe(DYNAMIC_CLIENT_ID)
    expect(params.get('agent_name_hint')).toBe('WIMM')
  })

  it('reuses a stored client id and omits agent_name_hint thereafter', () => {
    const params = new URL(
      createAuthorizeRequest({ ...base, existingClientId: 'abc123' }).url,
    ).searchParams
    expect(params.get('client_id')).toBe('abc123')
    expect(params.has('agent_name_hint')).toBe(false)
  })

  it('sends the exact scopes and resource', () => {
    const params = new URL(createAuthorizeRequest(base).url).searchParams
    expect(params.get('scope')).toBe(CHATGPT_SCOPES)
    expect(params.get('resource')).toBe(CHATGPT_RESOURCE)
  })

  it('generates a distinct verifier, state and nonce on every call', () => {
    const a = createAuthorizeRequest(base)
    const b = createAuthorizeRequest(base)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.state).not.toBe(b.state)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
  })
})
