import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

export type JwtPayload = {
  sub: string
  email: string
  username: string
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    })
  }

  validate(
    payload: JwtPayload & { username?: string },
  ): JwtPayload {
    return {
      sub: payload.sub,
      email: payload.email,
      username: payload.username ?? '',
    }
  }
}
