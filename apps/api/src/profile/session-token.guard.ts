import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator'
import { SESSION_TOKEN, SESSION_TOKEN_HEADER } from './session-token'

/**
 * Global authentication guard for the **local** (offline, per-profile
 * SQLite) composition root only. Registered as `APP_GUARD` by
 * `AppLocalModule.forRoot` -- never on the hosted `AppModule`, which keeps
 * its own `JwtAuthGuard` + `ThrottlerGuard` posture untouched.
 *
 * **Why this exists at all.** `ProfileModule`'s `ActiveProfileMiddleware`
 * populates `req.user` unconditionally, for every request, regardless of
 * who sent it -- that was fine while nothing was listening on a socket, but
 * once the local composition binds to `127.0.0.1` (Phase 4b), every other
 * process on the machine, and every web page the user's browser loads, can
 * reach it. Binding to loopback is not access control; this guard is what
 * actually closes that surface, by requiring a secret the caller could not
 * have unless it was handed the value out-of-band (over Electron's IPC, in
 * a later task) for this specific launch of the app.
 *
 * **Fail closed.** Every route is protected unless it (or its controller
 * class) carries `@Public()` -- the same precedent `JwtAuthGuard` uses on
 * the hosted build. As of this guard's introduction, nothing in the local
 * composition's route set uses it: unlike the hosted build, there is no
 * pre-authentication bootstrapping route here (no login/register/refresh --
 * `ProfileModule` derives identity from the one `User` row already in the
 * profile's database, not from credentials submitted over HTTP), and no
 * health check is mounted on this root (`AppController`, which owns
 * `GET /health`, is never imported by `AppLocalModule`). The check is kept
 * (rather than omitted) because the mechanism is an existing, tested
 * precedent already relied on elsewhere in this codebase, and a genuine
 * future need for an exemption should not require touching this guard.
 *
 * **Header, not query parameter.** A query string is copied into access
 * logs, into the `Referer` header sent to any third-party resource a page
 * subsequently loads, and into crash reports; a header the caller sets
 * explicitly is not.
 *
 * **Never logs the token, in either direction.** This class does not call
 * any logging function, and the exception it throws is the bare, stock
 * `UnauthorizedException` -- it carries no detail about whether the header
 * was missing, empty, or simply wrong, and never includes the provided or
 * expected value. All three cases produce a byte-for-byte identical
 * response and are handled by the same code path below, so there is
 * nothing decision-shaped to leak through the response either.
 */
@Injectable()
export class SessionTokenGuard implements CanActivate {
  constructor(
    @Inject(SESSION_TOKEN) private readonly expectedToken: string,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const request = context.switchToHttp().getRequest<Request>()
    const provided = request.headers[SESSION_TOKEN_HEADER]

    // Only a single string value is ever accepted. `undefined` (header
    // absent), `''` (header present but empty), and `string[]` (the header
    // arrived more than once -- Express's shape for a repeated header) are
    // all rejected by this one check, deliberately without special-casing
    // any of them: there is no ambiguous case here to resolve by picking a
    // value, only ways of not having a valid token.
    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException()
    }

    if (!constantTimeEqual(provided, this.expectedToken)) {
      throw new UnauthorizedException()
    }

    return true
  }
}

/**
 * Constant-time comparison of two secrets that may differ in length,
 * without ever hitting `crypto.timingSafeEqual`'s length-mismatch
 * `RangeError`.
 *
 * `timingSafeEqual` requires both buffers to be the same length and throws
 * otherwise -- and the obvious way to guard against that,
 * `if (a.length !== b.length) return false`, is exactly the leak the task
 * warns about: that branch is a length check done in variable time *before*
 * any constant-time comparison runs, so a request with a wrong-length token
 * returns measurably faster than one with a right-length-but-wrong-content
 * token, observably telling a network attacker whether their guess's length
 * was correct.
 *
 * Hashing both inputs first (SHA-256) sidesteps the problem instead of
 * masking it: a digest is always exactly 32 bytes, regardless of the
 * input's length, so `timingSafeEqual` below is always called on two
 * equal-length buffers and never throws -- there is no length branch left
 * to take, and therefore nothing about the input's length for one to leak
 * through timing.
 */
function constantTimeEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest()
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(providedDigest, expectedDigest)
}
