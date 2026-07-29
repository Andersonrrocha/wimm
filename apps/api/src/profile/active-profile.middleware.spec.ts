import type { NextFunction, Request, Response } from 'express'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { ActiveProfileMiddleware } from './active-profile.middleware'
import { ActiveProfileService } from './active-profile.service'

/**
 * Unit-level only: proves the middleware's function body assigns what
 * `ActiveProfileService.getUser()` returns onto `req.user` and calls
 * `next()`. It does NOT prove the middleware is actually bound into a real
 * request pipeline, applied to the right routes, or that `@CurrentUser()`
 * can read what it wrote -- a test double stands in for `ActiveProfileService`
 * here, and the request object is a plain literal, not a real Express
 * request routed through Nest. That end-to-end proof is
 * `request-seam.spec.ts`, which boots a real Nest app and issues a real HTTP
 * request. Both are kept, deliberately: this one gives fast, precise
 * feedback on the middleware's own logic; the other is what actually proves
 * the seam this module exists for.
 */
describe('ActiveProfileMiddleware (unit)', () => {
  it('assigns activeProfileService.getUser() onto req.user and calls next()', () => {
    const user: JwtPayload = { sub: 'user-1', email: 'a@example.com', username: 'a' }
    const activeProfileService = { getUser: jest.fn().mockReturnValue(user) } as unknown as ActiveProfileService
    const middleware = new ActiveProfileMiddleware(activeProfileService)
    const req = {} as Request & { user?: JwtPayload }
    const res = {} as Response
    const next = jest.fn() as NextFunction

    middleware.use(req, res, next)

    expect(req.user).toEqual(user)
    expect(activeProfileService.getUser).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('propagates getUser()\'s failure instead of swallowing it (no silent fallback identity)', () => {
    const activeProfileService = {
      getUser: jest.fn().mockImplementation(() => {
        throw new Error('not resolved yet')
      }),
    } as unknown as ActiveProfileService
    const middleware = new ActiveProfileMiddleware(activeProfileService)
    const req = {} as Request & { user?: JwtPayload }
    const res = {} as Response
    const next = jest.fn() as NextFunction

    expect(() => middleware.use(req, res, next)).toThrow('not resolved yet')
    expect(next).not.toHaveBeenCalled()
    expect(req.user).toBeUndefined()
  })
})
