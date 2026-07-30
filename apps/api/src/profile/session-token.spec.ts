/**
 * `generateSessionToken` is the only source of the per-launch secret the
 * local composition's `SessionTokenGuard` checks every request against, so
 * this spec is deliberately paranoid about the one property that actually
 * matters for that role: the value comes from a cryptographically strong
 * RNG, not `Math.random()` or a counter dressed up as a token.
 */
import * as nodeCrypto from 'node:crypto'
import { assertUsableSessionToken, generateSessionToken } from './session-token'

describe('generateSessionToken', () => {
  it('returns a lowercase-hex string at least 256 bits (32 bytes) long', () => {
    const token = generateSessionToken()

    expect(typeof token).toBe('string')
    // 32 bytes hex-encoded -> 64 hex characters. Asserting a floor (not an
    // exact value) so a future move to a larger byte count would not break
    // this spec for no reason, while a regression to something clearly too
    // short (e.g. a 4-byte token) would still be caught.
    expect(token.length).toBeGreaterThanOrEqual(64)
    expect(token).toMatch(/^[0-9a-f]+$/)
  })

  it('never returns the same value twice across many calls', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()))
    expect(tokens.size).toBe(1000)
  })

  it('is generated via node:crypto.randomBytes, not a non-cryptographic RNG', () => {
    // Spies on the real module's export rather than asserting on output
    // shape alone -- a token that merely *looks* random (right length,
    // hex-encoded) could still come from `Math.random()`. This proves the
    // implementation actually calls into the OS-backed CSPRNG.
    const randomBytesSpy = jest.spyOn(nodeCrypto, 'randomBytes')

    generateSessionToken()

    expect(randomBytesSpy).toHaveBeenCalledTimes(1)
    const [size] = randomBytesSpy.mock.calls[0]
    expect(size).toBeGreaterThanOrEqual(32)

    randomBytesSpy.mockRestore()
  })
})

describe('assertUsableSessionToken', () => {
  it('accepts a real generated token without throwing', () => {
    expect(() => assertUsableSessionToken(generateSessionToken())).not.toThrow()
  })

  it('accepts a short, fixed test literal without imposing a minimum length', () => {
    // No minimum length is imposed -- see the function's doc comment for
    // why. This is the exact shape of fixture `app.local.module.spec.ts`
    // already relies on (`TEST_SESSION_TOKEN`), so this pins that decision
    // down as a behavior, not just a comment.
    expect(() => assertUsableSessionToken('short-fixed-test-token')).not.toThrow()
  })

  it('throws on an empty string, naming the problem but never echoing the value', () => {
    expect(() => assertUsableSessionToken('')).toThrow(/non-empty, non-whitespace string/)
    try {
      assertUsableSessionToken('')
      throw new Error('expected assertUsableSessionToken to throw')
    } catch (error) {
      expect((error as Error).message).toContain('empty or whitespace-only string')
    }
  })

  it('throws on a whitespace-only string without silently trimming it into passing', () => {
    expect(() => assertUsableSessionToken('   \t\n  ')).toThrow(/non-empty, non-whitespace string/)
  })

  it('throws on undefined, naming its type rather than crashing later inside the guard', () => {
    // The exact runtime shape a JS caller (or anything that bypasses the
    // `string` type on `AppLocalModuleOptions.sessionToken`) could produce.
    // Without this check, `undefined` would instead reach
    // `constantTimeEqual`'s `createHash().update()` inside the guard, on
    // the first real request, and throw there as an uncaught 500.
    let thrown: Error | undefined
    try {
      assertUsableSessionToken(undefined)
    } catch (error) {
      thrown = error as Error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.message).toContain('a undefined value')
  })

  it('throws on a non-string value, naming its type but never its content', () => {
    try {
      assertUsableSessionToken(12345)
      throw new Error('expected assertUsableSessionToken to throw')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('a number value')
      expect(message).not.toContain('12345')
    }
  })
})
