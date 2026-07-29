/**
 * Puts the active profile's user, shaped as `JwtPayload`, on every request's
 * `request.user` -- the exact seam `CurrentUser` (`common/decorators/current-
 * user.decorator.ts`) already reads, and the exact shape the JWT strategy
 * produces for the hosted build (`auth/strategies/jwt.strategy.ts`). This is
 * the whole point of this module: `CurrentUser`, and every controller and
 * service built against it, works unchanged in both builds because both
 * builds hand it the same shape -- one from a decoded token, one from here.
 *
 * Deliberately does no work of its own beyond that assignment: identity
 * resolution (including the "zero or more than one user" decisions) lives in
 * `ActiveProfileService`, resolved once at `onModuleInit` -- see that
 * service's doc comment for why a per-request lookup is not used here. This
 * middleware just copies the already-resolved value onto every request, so
 * there is exactly one thing to get wrong here (wiring), not two (wiring and
 * lookup).
 *
 * Not applying this middleware to a route is a silent failure mode worth
 * naming explicitly: `CurrentUser` throws its own `UnauthorizedException`
 * (401) when `request.user` is unset, which is byte-for-byte identical to
 * "no active profile user" from the caller's point of view. A unit test that
 * calls `.use()` directly cannot catch a route this middleware was never
 * bound to -- only a real request through the actual Nest pipeline can (see
 * `profile.module.ts`'s `configure()` and the request-seam spec).
 */
import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { ActiveProfileService } from './active-profile.service'

@Injectable()
export class ActiveProfileMiddleware implements NestMiddleware {
  constructor(private readonly activeProfileService: ActiveProfileService) {}

  use(req: Request & { user?: JwtPayload }, _res: Response, next: NextFunction): void {
    req.user = this.activeProfileService.getUser()
    next()
  }
}
