import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { Public } from '../common/decorators/public.decorator'
import { JwtAuthGuard } from './jwt-auth.guard'

class ProtectedController {
  handler() {}
}

class PublicHandlerController {
  @Public()
  handler() {}
}

@Public()
class PublicClassController {
  handler() {}
}

function contextFor(target: object, handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard
  let passportCanActivate: jest.SpyInstance

  beforeEach(() => {
    // Real Reflector: no `@Public()` decorator mocking. If the guard read a
    // metadata key that didn't match what `Public()` actually sets, this
    // would fail to grant access below.
    guard = new JwtAuthGuard(new Reflector())
    passportCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true)
  })

  afterEach(() => {
    passportCanActivate.mockRestore()
  })

  it('delegates to the passport jwt guard when no @Public is present', async () => {
    const context = contextFor(
      ProtectedController.prototype,
      ProtectedController.prototype.handler,
    )

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(passportCanActivate).toHaveBeenCalledWith(context)
  })

  it('allows a handler marked @Public without consulting the passport guard', async () => {
    const context = contextFor(
      PublicHandlerController.prototype,
      PublicHandlerController.prototype.handler,
    )

    await expect(
      Promise.resolve(guard.canActivate(context)),
    ).resolves.toBe(true)
    expect(passportCanActivate).not.toHaveBeenCalled()
  })

  it('allows every handler on a class marked @Public without consulting the passport guard', async () => {
    const context = contextFor(
      PublicClassController.prototype,
      PublicClassController.prototype.handler,
    )

    await expect(
      Promise.resolve(guard.canActivate(context)),
    ).resolves.toBe(true)
    expect(passportCanActivate).not.toHaveBeenCalled()
  })
})
