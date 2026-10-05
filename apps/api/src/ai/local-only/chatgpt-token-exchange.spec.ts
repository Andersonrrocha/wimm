import { generateKeyPairSync, type KeyObject } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import {
  CHATGPT_SCOPES,
} from './chatgpt-oidc'
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
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code: 'c',
      code_verifier: 'v',
      // Was unasserted: dropping it from the body passed every test, and an
      // exchange without it is rejected by a conformant server.
      redirect_uri: 'http://127.0.0.1:1/auth/callback',
      resource: 'https://api.openai.com/v1',
    })
  })

  const exchange = (tokenBody: unknown) =>
    exchangeCode({
      config,
      clientId: 'client-1',
      code: 'c',
      verifier: 'v',
      redirectUri: 'http://127.0.0.1:1/auth/callback',
      nonce: 'n-1',
      fetchImpl: fetchStub(tokenBody),
    })

  describe('an omitted scope (RFC 6749 makes it optional)', () => {
    // Reading an omission as "no scopes" breaks the HAPPY path, which is why
    // these matter more than they look: `sharing` would be false on a
    // perfectly good connection, and the offline_access requirement below
    // would be skipped so a missing refresh token would pass unnoticed.
    const withoutScope = (idToken: string) => ({
      access_token: 'access-value',
      refresh_token: 'refresh-value',
      id_token: idToken,
      expires_in: 3600,
      // `scope` deliberately absent.
    })

    it('falls back to the requested scopes', async () => {
      const result = await exchange(withoutScope(signIdToken({ nonce: 'n-1' })))
      expect(result.scopes).toBe(CHATGPT_SCOPES)
    })

    it('still reports sharing as granted', async () => {
      const result = await exchange(withoutScope(signIdToken({ nonce: 'n-1' })))
      expect(result.sharing).toBe(true)
    })

    it('still requires a refresh token, because offline_access was requested', async () => {
      const { refresh_token: _dropped, ...noRefresh } = withoutScope(
        signIdToken({ nonce: 'n-1' }),
      )
      await expect(exchange(noRefresh)).rejects.toThrow(/refresh/i)
    })

    it('treats an empty-string scope the same as an absent one', async () => {
      const result = await exchange({
        ...withoutScope(signIdToken({ nonce: 'n-1' })),
        scope: '',
      })
      expect(result.scopes).toBe(CHATGPT_SCOPES)
    })
  })

  it('returns a null refresh token, not an empty string, when offline_access is not granted', async () => {
    // `''` would flow into a refresh grant as a real-looking value and fail
    // at the server rather than here.
    const result = await exchange({
      access_token: 'access-value',
      id_token: signIdToken({ nonce: 'n-1' }),
      expires_in: 3600,
      scope: 'openid profile email',
    })
    expect(result.refreshToken).toBeNull()
    expect(result.sharing).toBe(false)
  })

  it('enforces the issuer, not merely the signature', async () => {
    // Named for the property, rather than relying on it being caught
    // incidentally by a leak-table scenario.
    const foreignIssuer = new JwtService().sign(
      {
        iss: 'https://auth.evil.example',
        aud: 'client-1',
        sub: 'user-sub',
        nonce: 'n-1',
      },
      { privateKey, algorithm: 'RS256', keyid: 'k1', expiresIn: '5m' },
    )
    await expect(
      exchange({
        access_token: 'access-value',
        refresh_token: 'refresh-value',
        id_token: foreignIssuer,
        expires_in: 3600,
        scope: CHATGPT_SCOPES,
      }),
    ).rejects.toThrow()
  })

  it('re-fetches a signing key after a verification failure, so a reused kid recovers', async () => {
    // The cache is keyed by `kid`, so an ordinary rotation to a NEW kid is a
    // miss and re-fetches anyway. This covers the one case where the drop is
    // load-bearing: the issuer reusing a kid for new key material. Without
    // the drop, the stale key would be cached and every later attempt would
    // fail until the user quit the app.
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    let served: KeyObject = other.publicKey
    let jwksCalls = 0
    // Its own jwks_uri. The signing-key cache is module-level and shared
    // across tests, so with `config.jwks_uri` this test only started from a
    // cold cache because an earlier test's verification failure happened to
    // evict `k1`. Run under `-t` on its own it then false-failed on correct
    // code. The leak table already isolates itself the same way.
    const isolated = { ...config, jwks_uri: 'https://auth.openai.com/jwks-kid-reuse' }
    const rotating = (async (input: string | URL) => {
      const url = String(input)
      if (url === isolated.jwks_uri) {
        jwksCalls += 1
        return {
          ok: true,
          json: async () => ({
            keys: [{ ...served.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }],
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-value',
          refresh_token: 'refresh-value',
          id_token: signIdToken({ nonce: 'n-1' }),
          expires_in: 3600,
          scope: CHATGPT_SCOPES,
        }),
      }
    }) as unknown as typeof fetch

    const call = () =>
      exchangeCode({
        config: isolated,
        clientId: 'client-1',
        code: 'c',
        verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/auth/callback',
        nonce: 'n-1',
        fetchImpl: rotating,
      })

    // First attempt: the served key does not match the signing key.
    await expect(call()).rejects.toThrow()
    expect(jwksCalls).toBe(1)

    // The issuer now serves the right material under the same kid.
    served = publicKey
    await expect(call()).resolves.toMatchObject({ subject: 'user-sub' })
    expect(jwksCalls).toBe(2)
  })

  describe('properties that nothing pinned before review', () => {
    const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const signWith = (
      algorithm: 'RS384' | 'RS512' | 'HS256',
      secretOrKey: string | Buffer | typeof privateKey,
    ) =>
      new JwtService().sign(
        {
          iss: config.issuer,
          aud: 'client-1',
          sub: 'user-sub',
          nonce: 'n-1',
        },
        {
          ...(algorithm === 'HS256'
            ? { secret: secretOrKey as string }
            : { privateKey: secretOrKey as typeof privateKey }),
          algorithm,
          keyid: 'k1',
          expiresIn: '5m',
        },
      )

    const body = (idToken: string) => ({
      access_token: 'access-value',
      refresh_token: 'refresh-value',
      id_token: idToken,
      expires_in: 3600,
      scope: CHATGPT_SCOPES,
    })

    // Removing `algorithms: ['RS256']` passed all 26 tests before these.
    it.each(['RS384', 'RS512'] as const)(
      'rejects a genuinely signed %s token, because only RS256 is allowed',
      async (algorithm) => {
        await expect(
          exchange(body(signWith(algorithm, privateKey))),
        ).rejects.toThrow()
      },
    )

    it('rejects an HS256 token signed with the public PEM as the HMAC secret', async () => {
      // The classic algorithm-confusion attack: the "public" key is public,
      // so if HS256 were accepted anyone could mint a valid token.
      await expect(exchange(body(signWith('HS256', PEM)))).rejects.toThrow()
    })

    it('rejects an expired token', async () => {
      // Adding `ignoreExpiration: true` passed all 26 tests before this.
      const expired = new JwtService().sign(
        { iss: config.issuer, aud: 'client-1', sub: 'user-sub', nonce: 'n-1' },
        { privateKey, algorithm: 'RS256', keyid: 'k1', expiresIn: '-10s' },
      )
      await expect(exchange(body(expired))).rejects.toThrow()
    })

    it('rejects a token with no exp claim at all', async () => {
      // OIDC Core makes `exp` REQUIRED, but jsonwebtoken only enforces it
      // when present -- so without this check such a token never expires.
      const noExpiry = new JwtService().sign(
        { iss: config.issuer, aud: 'client-1', sub: 'user-sub', nonce: 'n-1' },
        { privateKey, algorithm: 'RS256', keyid: 'k1' },
      )
      await expect(exchange(body(noExpiry))).rejects.toThrow(/expiry/i)
    })

    it('computes expiresAt as now plus expires_in seconds', async () => {
      // Changing `* 1000` to `* 1` passed all 26 tests before this.
      const before = Date.now()
      const result = await exchange(body(signIdToken({ nonce: 'n-1' })))
      const elapsed = Date.now() - before
      const delta = result.expiresAt.getTime() - before
      expect(delta).toBeGreaterThanOrEqual(3600 * 1000 - 50)
      expect(delta).toBeLessThanOrEqual(3600 * 1000 + elapsed + 50)
    })

    it.each([1e13, 1e308, Number.MAX_VALUE])(
      'clamps an absurd expires_in of %p to a real date rather than an Invalid Date',
      async (expires_in) => {
        // An Invalid Date still satisfies Number.isFinite upstream, and every
        // later `expiresAt <= now` comparison is false for NaN -- so the
        // credential would read as never expiring.
        const result = await exchange({
          ...body(signIdToken({ nonce: 'n-1' })),
          expires_in,
        })
        expect(Number.isNaN(result.expiresAt.getTime())).toBe(false)
      },
    )

    const verify = (override: Record<string, unknown>, claims = { nonce: 'n-1' }) =>
      verifyIdentity({
        idToken: signIdToken(claims),
        clientId: 'client-1',
        issuer: config.issuer,
        jwksUri: config.jwks_uri,
        nonce: 'n-1',
        fetchImpl: fetchStub({}),
        ...override,
      } as never)

    it.each([
      ['an empty client id', { clientId: '' }, /client id and an issuer/],
      ['an empty issuer', { issuer: '' }, /client id and an issuer/],
      ['an empty nonce', { nonce: '' }, /requires a nonce/],
      ['an undefined nonce', { nonce: undefined }, /requires a nonce/],
    ])(
      'refuses to verify with %s, rather than skipping the check',
      async (_why, override, expected) => {
        // jsonwebtoken guards its own checks with truthiness, so an empty
        // string SKIPS the check instead of tightening it. All of these fail
        // open without the guard.
        await expect(verify(override)).rejects.toThrow(expected)
      },
    )

    it('accepts an explicit null nonce, which is how a refresh says it has none', async () => {
      // A refresh has no new authorize request, so there is no nonce to
      // compare. `null` is the only way to say that; Task 8 depends on it.
      await expect(
        verify({ nonce: null }, { nonce: undefined } as never),
      ).resolves.toMatchObject({ subject: 'user-sub' })
    })

    it('still rejects a mismatched nonce when one is expected', async () => {
      await expect(verify({}, { nonce: 'DIFFERENT' })).rejects.toThrow(/nonce/i)
    })

    it('verifies a saved rotation against its receipt time, not the current clock', async () => {
      // A signing-key outage can outlast the identity token without
      // invalidating the refresh token. Verifying such a token against the
      // current clock would fail permanently, on a refresh token that has
      // already been consumed -- an account that can never reconnect.
      const receivedAt = new Date(Date.now() - 60 * 60 * 1000)
      const tokenFromThen = new JwtService().sign(
        {
          iss: config.issuer,
          aud: 'client-1',
          sub: 'user-sub',
          iat: Math.floor(receivedAt.getTime() / 1000),
          exp: Math.floor(receivedAt.getTime() / 1000) + 300,
        },
        { privateKey, algorithm: 'RS256', keyid: 'k1' },
      )

      // Expired as of now...
      await expect(
        verifyIdentity({
          idToken: tokenFromThen,
          clientId: 'client-1',
          issuer: config.issuer,
          jwksUri: config.jwks_uri,
          nonce: null,
          fetchImpl: fetchStub({}),
        }),
      ).rejects.toThrow()

      // ...but valid as of when it was received.
      await expect(
        verifyIdentity({
          idToken: tokenFromThen,
          clientId: 'client-1',
          issuer: config.issuer,
          jwksUri: config.jwks_uri,
          nonce: null,
          verifyAt: receivedAt,
          fetchImpl: fetchStub({}),
        }),
      ).resolves.toMatchObject({ subject: 'user-sub' })
    })

    it('rejects a token whose azp names another client', async () => {
      await expect(
        verify({}, { nonce: 'n-1', azp: 'another-client' } as never),
      ).rejects.toThrow(/another client/i)
    })

    it('rejects multiple audiences without this client as the authorized party', async () => {
      // `audience` alone accepts a token minted for several clients at once,
      // of which we are merely one. OIDC Core requires `azp` in that case.
      await expect(
        verify({}, {
          nonce: 'n-1',
          aud: ['client-1', 'another-client'],
        } as never),
      ).rejects.toThrow(/multiple audiences/i)
    })

    it('accepts multiple audiences when azp names this client', async () => {
      await expect(
        verify({}, {
          nonce: 'n-1',
          aud: ['client-1', 'another-client'],
          azp: 'client-1',
        } as never),
      ).resolves.toMatchObject({ subject: 'user-sub' })
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
  const verified = (claims: Record<string, unknown>) =>
    verifyIdentity({
      idToken: signIdToken({ nonce: 'n-1', ...claims }),
      clientId: 'client-1', issuer: config.issuer, jwksUri: config.jwks_uri,
      nonce: 'n-1', fetchImpl: fetchStub({}),
    })

  it('returns the verified subject', async () => {
    const identity = await verified({})
    expect(identity.subject).toBe('user-sub')
  })

  /**
   * The account label has to come from HERE, out of the payload this
   * function has already verified. A second, unverified `decode` elsewhere
   * would be trusting the token twice over -- once for identity, once for
   * what to display.
   */
  describe('the account label', () => {
    it('is the verified email claim', async () => {
      await expect(verified({ email: 'ada@example.com' })).resolves.toMatchObject({
        accountLabel: 'ada@example.com',
      })
    })

    it.each([
      ['no email claim', {}],
      ['an empty email claim', { email: '' }],
      ['a whitespace-only email claim', { email: '   ' }],
      ['a non-string email claim', { email: 42 }],
    ])('is null for %s, never a placeholder', async (_why, claims) => {
      await expect(verified(claims)).resolves.toMatchObject({
        accountLabel: null,
      })
    })

    it('is trimmed', async () => {
      await expect(verified({ email: '  ada@example.com  ' })).resolves.toMatchObject({
        accountLabel: 'ada@example.com',
      })
    })
  })
})

describe('exchangeCode returns the account label beside the credentials', () => {
  it('carries the label the identity verification produced', async () => {
    const result = await exchangeCode({
      config, clientId: 'client-1', code: 'c', verifier: 'v',
      redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
      fetchImpl: fetchStub({
        access_token: 'access-value', refresh_token: 'refresh-value',
        id_token: signIdToken({ nonce: 'n-1', email: 'ada@example.com' }),
        expires_in: 3600, scope: CHATGPT_SCOPES,
      }),
    })

    expect(result.accountLabel).toBe('ada@example.com')
    // The label is not a credential and is not sealed with them: it is a
    // plain column the status endpoint reads.
    expect(result.accessToken).toBe('access-value')
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
