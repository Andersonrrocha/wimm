/**
 * `generateSessionToken` is the only source of the per-launch secret the
 * local composition's `SessionTokenGuard` checks every request against, so
 * this spec is deliberately paranoid about the one property that actually
 * matters for that role: the value comes from a cryptographically strong
 * RNG, not `Math.random()` or a counter dressed up as a token.
 */
import * as nodeCrypto from 'node:crypto'
import { generateSessionToken } from './session-token'

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
