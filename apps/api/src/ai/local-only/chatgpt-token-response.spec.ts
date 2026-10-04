import {
  MAX_EXPIRES_IN_SECONDS,
  readExpiresInSeconds,
  readJsonObject,
} from './chatgpt-token-response'

const responding = (body: unknown, throws = false) =>
  ({
    json: async () => {
      if (throws) throw new SyntaxError('Unexpected token < in JSON at position 0')
      return body
    },
  }) as unknown as Response

describe('readExpiresInSeconds', () => {
  it('passes a normal lifetime through', () => {
    expect(readExpiresInSeconds(3600)).toBe(3600)
  })

  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '3600'])(
    'reads %p as no lifetime at all',
    (value) => {
      expect(readExpiresInSeconds(value)).toBe(0)
    },
  )

  it.each([1e13, 1e308, Number.MAX_VALUE])('clamps %p to a year', (value) => {
    // Unclamped, these produce an `Invalid Date`, and every later
    // `expiresAt <= now` comparison is false for `NaN` -- so the credential
    // would read as never expiring.
    expect(readExpiresInSeconds(value)).toBe(MAX_EXPIRES_IN_SECONDS)
    expect(Number.isNaN(new Date(Date.now() + readExpiresInSeconds(value) * 1000).getTime())).toBe(false)
  })
})

describe('readJsonObject', () => {
  it('returns the parsed object', async () => {
    await expect(
      readJsonObject(responding({ access_token: 'a' }), 'Label'),
    ).resolves.toEqual({ access_token: 'a' })
  })

  it('rejects an unparseable body without quoting it', async () => {
    // `json()` quotes the first characters of what it failed to parse, and
    // these bodies carry tokens -- so the message must be ours, not its.
    const failure = await readJsonObject(
      responding(undefined, true),
      'ChatGPT token response',
    ).catch((error: Error) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(
      'ChatGPT token response could not be parsed.',
    )
    expect((failure as Error).message).not.toContain('Unexpected token')
  })

  it.each([null, 42, 'a string', true])(
    'rejects a JSON %p body rather than letting field reads throw',
    async (body) => {
      // A `null` body in particular would make every `data.x` read below
      // throw a raw TypeError.
      await expect(readJsonObject(responding(body), 'Label')).rejects.toThrow(
        'Label was not an object.',
      )
    },
  )

  it('carries the caller\'s label, which is why extraction was safe', async () => {
    // The two call sites had distinct messages on purpose -- they say WHICH
    // parse failed. Flattening them into one string would have lost that.
    await expect(
      readJsonObject(responding(null), 'ChatGPT token refresh response'),
    ).rejects.toThrow('ChatGPT token refresh response was not an object.')
  })

  it('lets an array through, as both call sites already did', async () => {
    // `typeof [] === 'object'` and it is not null. Preserved deliberately:
    // this is a refactor, and downstream field reads simply find nothing.
    await expect(readJsonObject(responding([1, 2]), 'Label')).resolves.toEqual([
      1, 2,
    ])
  })
})
