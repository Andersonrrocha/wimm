import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import type { JwtPayload } from '../../auth/strategies/jwt.strategy'

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | string => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>()
    const user = request.user
    if (!user) {
      throw new UnauthorizedException()
    }
    return data ? user[data] : user
  },
)
