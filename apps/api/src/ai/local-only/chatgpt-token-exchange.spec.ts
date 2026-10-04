import { generateKeyPairSync, type KeyObject } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import {
  exchangeCode,
  isSharingGranted,
  verifyIdentity,
} from './chatgpt-token-exchange'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }
const config = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}

const signIdToken = (claims: Record<string, unknown>) =>
  new JwtService().sign(
    { iss: config.issuer, aud: 'client-1', sub: 'user-sub', ...claims },
    { privateKey, algorithm: 'RS256', keyid: 'k1', expiresIn: '5m' },
  )

const fetchStub = (tokenBody: unknown) =>
  (async (input: string | URL) => {
    const url = String(input)
    if (url === config.jwks_uri) return { ok: true, json: async () => ({ keys: [jwk] }) }
    return { ok: true, json: async () => tokenBody }
  }) as unknown as typeof fetch

describe('exchangeCode', () => {
  const ok = (idToken: string) => ({
    access_token: 'at', refresh_token: 'rt', id_token: idToken,
    expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct',
  })

  it('sends the documented grant fields', async () => {
    const sent: Array<Record<string, string>> = []
    const spyFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === config.jwks_uri) return { ok: true, json: async () => ({ keys: [jwk] }) }
      sent.push(Object.fromEntries(new URLSearchParams(String(init?.body))))
      return { ok: true, json: async () => ok(signIdToken({ nonce: 'n-1' })) }
    }) as unknown as typeof fetch

    await exchangeCode({
      config, clientId: 'client-1', code: 'c', verifier: 'v',
      redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1', fetchImpl: spyFetch,
    })
    expect(sent[0]).toMatchObject({
      grant_type: 'authorization_code', client_id: 'client-1',
      code: 'c', code_verifier: 'v', resource: 'https://api.openai.com/v1',
    })
  })

  it('rejects an id_token whose nonce does not match', async () => {
    await expect(
      exchangeCode({
        config, clientId: 'client-1', code: 'c', verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
        fetchImpl: fetchStub(ok(signIdToken({ nonce: 'DIFFERENT' }))),
      }),
    ).rejects.toThrow(/nonce/i)
  })

  it('rejects an id_token issued for another audience', async () => {
    await expect(
      exchangeCode({
        config, clientId: 'client-1', code: 'c', verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
        fetchImpl: fetchStub(ok(signIdToken({ nonce: 'n-1', aud: 'someone-else' }))),
      }),
    ).rejects.toThrow()
  })

  it('requires a refresh token when offline_access was granted', async () => {
    const noRefresh = { ...ok(signIdToken({ nonce: 'n-1' })), refresh_token: undefined }
    await expect(
      exchangeCode({
        config, clientId: 'client-1', code: 'c', verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
        fetchImpl: fetchStub(noRefresh),
      }),
    ).rejects.toThrow(/refresh/i)
  })
})

describe('verifyIdentity', () => {
  it('returns the verified subject', async () => {
    const identity = await verifyIdentity({
      idToken: signIdToken({ nonce: 'n-1' }),
      clientId: 'client-1', issuer: config.issuer, jwksUri: config.jwks_uri,
      nonce: 'n-1', fetchImpl: fetchStub({}),
    })
    expect(identity.subject).toBe('user-sub')
  })
})

describe('sharing', () => {
  it('is derived from the granted scopes, not from the id_token', () => {
    expect(isSharingGranted('openid offline_access chatgpt.tokens.use.direct')).toBe(true)
    expect(isSharingGranted('openid profile email offline_access')).toBe(false)
  })
})

/**
 * Every failure branch of `exchangeCode`, driven with sentinel secrets that
 * are present in the arguments and in the response. Sentinels are long and
 * unmistakable on purpose: a short secret such as `at` is a substring of
 * ordinary words ("ChatGPT", "match") and would flag a perfectly safe
 * message, or hide a real leak among false positives.
 */
describe('error messages carry no credential', () => {
  const SENTINEL = {
    accessToken: 'SENTINEL-ACCESS-TOKEN-7f3a91',
    refreshToken: 'SENTINEL-REFRESH-TOKEN-b20c44',
    code: 'SENTINEL-AUTH-CODE-4d2e08',
    verifier: 'SENTINEL-PKCE-VERIFIER-c58a17',
  }
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 })

  const sign = (
    claims: Record<string, unknown>,
    options: { key?: KeyObject; keyid?: string | null } = {},
  ) =>
    new JwtService().sign(
      { iss: config.issuer, aud: 'client-1', sub: 'user-sub', nonce: 'n-1', ...claims },
      {
        privateKey: options.key ?? privateKey,
        algorithm: 'RS256',
        expiresIn: '5m',
        ...(options.keyid === null ? {} : { keyid: options.keyid ?? 'k1' }),
      },
    )

  interface Scenario {
    idToken: string
    /** Merged over the otherwise-valid token response; `undefined` removes a field. */
    patch?: Record<string, unknown>
    tokenStatus?: number
    jwksStatus?: number
  }

  const scenarios: Array<[string, Scenario, RegExp]> = [
    ['the token endpoint refuses the grant', { idToken: sign({}), tokenStatus: 400 }, /token exchange failed \(status 400\)/],
    ['no access token comes back', { idToken: sign({}), patch: { access_token: undefined } }, /returned no access token/],
    ['no identity token comes back', { idToken: sign({}), patch: { id_token: undefined } }, /returned no identity token/],
    ['offline_access is granted without a refresh token', { idToken: sign({}), patch: { refresh_token: undefined } }, /returned no refresh token/],
    ['the identity token is malformed', { idToken: 'SENTINEL-MALFORMED-ID-TOKEN' }, /no usable key id/],
    ['the identity token has no key id', { idToken: sign({}, { keyid: null }) }, /no usable key id/],
    ['the signing key set is unavailable', { idToken: sign({}), jwksStatus: 503 }, /signing keys are unavailable \(status 503\)/],
    ['the signing key is not in the key set', { idToken: sign({}, { keyid: 'rotated-away' }) }, /signing key for this token was not found/],
    ['the signature is not from the published key', { idToken: sign({}, { key: attacker.privateKey }) }, /could not be verified: invalid signature/],
    ['the issuer is wrong', { idToken: sign({ iss: 'https://evil.example' }) }, /could not be verified: jwt issuer invalid/],
    ['the audience is wrong', { idToken: sign({ aud: 'someone-else' }) }, /could not be verified: jwt audience invalid/],
    ['the nonce does not match', { idToken: sign({ nonce: 'DIFFERENT' }) }, /nonce did not match/],
    ['the identity token has no subject', { idToken: sign({ sub: '' }) }, /has no subject/],
  ]

  it.each(scenarios)('%s', async (_name, scenario, expectedMessage) => {
    // A distinct jwks_uri per scenario keeps the module's key cache from
    // hiding the key-fetch branches behind an earlier scenario's success.
    const jwksUri = `https://auth.openai.com/.well-known/jwks-${_name.replace(/\W+/g, '-')}.json`
    const scenarioConfig = { ...config, jwks_uri: jwksUri }
    const body = {
      access_token: SENTINEL.accessToken,
      refresh_token: SENTINEL.refreshToken,
      id_token: scenario.idToken,
      expires_in: 3600,
      scope: 'openid offline_access chatgpt.tokens.use.direct',
      ...scenario.patch,
    }
    const everySecret = Object.values(SENTINEL).join(' ')
    const fetchImpl = (async (input: string | URL) => {
      if (String(input) === jwksUri) {
        return scenario.jwksStatus
          ? { ok: false, status: scenario.jwksStatus, json: async () => ({ detail: everySecret }) }
          : { ok: true, status: 200, json: async () => ({ keys: [jwk] }) }
      }
      return scenario.tokenStatus
        ? { ok: false, status: scenario.tokenStatus, json: async () => ({ error: 'invalid_grant', error_description: everySecret, ...body }) }
        : { ok: true, status: 200, json: async () => body }
    }) as unknown as typeof fetch

    const error = await exchangeCode({
      config: scenarioConfig,
      clientId: 'client-1',
      code: SENTINEL.code,
      verifier: SENTINEL.verifier,
      redirectUri: 'http://127.0.0.1:1/auth/callback',
      nonce: 'n-1',
      fetchImpl,
    }).then(
      () => null,
      (rejection: unknown) => rejection,
    )

    // Without this, a call that resolved would skip every assertion below
    // and the test would pass having proven nothing.
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    // Pins the scenario to the branch its name claims, so the table cannot
    // drift into exercising the same early failure thirteen times.
    expect(message).toMatch(expectedMessage)
    const forbidden = [
      ...Object.values(SENTINEL),
      scenario.idToken,
      scenario.idToken.split('.')[2], // the signature segment, if it is a JWT
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    for (const value of forbidden) expect(message).not.toContain(value)
  })
})
