import { CHATGPT_ISSUER, discoverOidcConfig } from './chatgpt-oidc'

const wellFormed = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}

const fetchReturning = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

describe('discoverOidcConfig', () => {
  it('returns the discovered endpoints', async () => {
    const config = await discoverOidcConfig(fetchReturning(wellFormed))
    expect(config.token_endpoint).toBe(wellFormed.token_endpoint)
    expect(config.jwks_uri).toBe(wellFormed.jwks_uri)
  })

  it('rejects a document whose own issuer is not the expected one', async () => {
    const impostor = { ...wellFormed, issuer: 'https://auth.evil.example' }
    await expect(discoverOidcConfig(fetchReturning(impostor))).rejects.toThrow(
      /issuer/i,
    )
  })

  it('rejects a document missing any required endpoint', async () => {
    const { jwks_uri: _omitted, ...incomplete } = wellFormed
    await expect(discoverOidcConfig(fetchReturning(incomplete))).rejects.toThrow(
      /jwks_uri/,
    )
  })

  it('rejects a non-OK response', async () => {
    await expect(
      discoverOidcConfig(fetchReturning(wellFormed, false)),
    ).rejects.toThrow()
  })

  it('pins the issuer constant', () => {
    expect(CHATGPT_ISSUER).toBe('https://auth.openai.com')
  })
})
