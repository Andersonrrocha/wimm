/**
 * Unit-level proof of `SessionTokenGuard`'s decision logic in isolation:
 * given a fixed expected token and a fabricated `ExecutionContext`, does
 * `canActivate` accept or reject for each header shape that can actually
 * arrive over HTTP?
 *
 * This spec cannot prove the guard is *wired in* -- that a request
 * genuinely reaching a real, booted local composition is rejected or
 * admitted -- only that the class's own logic is correct once invoked. That
 * stronger, end-to-end proof lives in `local-route-posture.spec.ts` (see
 * its file comment for why a tokenless-only check is not enough on its
 * own). Both are needed: this one is fast and pins down edge cases
 * (missing/empty/wrong-length/array header, `@Public()`) that would be
 * tedious to hit one-by-one through real HTTP; the other one is the proof
 * that actually carries the task.
 */
import type { ExecutionContext } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Public } from '../common/decorators/public.decorator'
import { SESSION_TOKEN_HEADER } from './session-token'
import { SessionTokenGuard } from './session-token.guard'

const EXPECTED_TOKEN = 'a'.repeat(64)

class ProtectedController {
  handler() {}
}

class PublicHandlerController {
  @Public()
  handler() {}
}

/** The port every fixture below pretends this connection actually landed on -- see `isAllowedHost`. */
const FIXTURE_PORT = 54321

// `null` (not `undefined`) means "omit the Host header entirely" -- a
// default *parameter* only kicks in for an omitted or literal `undefined`
// argument, so `undefined` cannot double as "no host" without silently
// falling back to the default instead. Every call site keeps meaning what
// it looks like it means: passing `undefined` for `hostHeader` uses the
// realistic default, passing `null` explicitly asks for no header at all.
function contextFor(
  target: object,
  handler: () => void,
  headerValue: string | string[] | undefined,
  hostHeader: string | null = `127.0.0.1:${FIXTURE_PORT}`,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          ...(headerValue === undefined ? {} : { [SESSION_TOKEN_HEADER]: headerValue }),
          ...(hostHeader === null ? {} : { host: hostHeader }),
        },
        socket: { localPort: FIXTURE_PORT },
      }),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext
}

describe('SessionTokenGuard', () => {
  let guard: SessionTokenGuard

  beforeEach(() => {
    guard = new SessionTokenGuard(EXPECTED_TOKEN, new Reflector())
  })

  it('admits a request whose header exactly matches the expected token', () => {
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
      EXPECTED_TOKEN,
    )

    expect(guard.canActivate(context)).toBe(true)
  })

  it('rejects with 401 when the header is absent', () => {
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
      undefined,
    )

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('rejects with 401 when the header is present but empty', () => {
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
      '',
    )

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('rejects with 401 when the header is wrong but the same length as the expected token', () => {
    const wrongSameLength = 'b'.repeat(EXPECTED_TOKEN.length)
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
      wrongSameLength,
    )

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('rejects with 401 when the header is wrong and a different length than the expected token', () => {
    // This is the case that would make a naive `crypto.timingSafeEqual(a, b)`
    // call throw a RangeError instead of denying access -- proving the
    // guard handles the length mismatch itself rather than letting an
    // uncaught exception turn into a 500.
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
      'too-short',
    )

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('rejects with 401 when the header arrives more than once (an array of values)', () => {
    // Express represents a repeated header as `string[]`. Picking one value
    // to trust would be an ambiguous, silent choice; failing closed on the
    // ambiguity is the safer default and requires no special-casing beyond
    // "only a plain string counts".
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
      [EXPECTED_TOKEN, EXPECTED_TOKEN],
    )

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('never includes the provided or expected token in the exception it throws', () => {
    const wrongToken = 'c'.repeat(EXPECTED_TOKEN.length)
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
      wrongToken,
    )

    try {
      guard.canActivate(context)
      throw new Error('expected canActivate to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException)
      const serialized = JSON.stringify((error as UnauthorizedException).getResponse())
      expect(serialized).not.toContain(wrongToken)
      expect(serialized).not.toContain(EXPECTED_TOKEN)
    }
  })

  it('admits a handler marked @Public() without requiring any header at all', () => {
    const context = contextFor(
      PublicHandlerController.prototype,
      PublicHandlerController.prototype.handler,
      undefined,
    )

    expect(guard.canActivate(context)).toBe(true)
  })

  describe('Host header allowlist (Finding 5)', () => {
    it('rejects with 401 when Host names a different hostname, even with a valid token', () => {
      // The DNS-rebinding scenario this check exists for: the browser
      // resolved "evil.com" to 127.0.0.1, connects there, but still sends
      // "Host: evil.com" -- the hostname it believes it is talking to.
      const context = contextFor(
        ProtectedController.prototype,
        ProtectedController.prototype.handler,
        EXPECTED_TOKEN,
        `evil.com:${FIXTURE_PORT}`,
      )

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('rejects with 401 when Host names the right hostname but the wrong port, even with a valid token', () => {
      const context = contextFor(
        ProtectedController.prototype,
        ProtectedController.prototype.handler,
        EXPECTED_TOKEN,
        `127.0.0.1:${FIXTURE_PORT + 1}`,
      )

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('rejects with 401 when the Host header is absent, even with a valid token', () => {
      const context = contextFor(
        ProtectedController.prototype,
        ProtectedController.prototype.handler,
        EXPECTED_TOKEN,
        null,
      )

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('rejects a @Public() handler too when Host is wrong -- the Host check runs before the @Public() bypass', () => {
      const context = contextFor(
        PublicHandlerController.prototype,
        PublicHandlerController.prototype.handler,
        undefined,
        `evil.com:${FIXTURE_PORT}`,
      )

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('admits "localhost" as well as "127.0.0.1" when the port matches', () => {
      const context = contextFor(
        ProtectedController.prototype,
        ProtectedController.prototype.handler,
        EXPECTED_TOKEN,
        `localhost:${FIXTURE_PORT}`,
      )

      expect(guard.canActivate(context)).toBe(true)
    })
  })
})
