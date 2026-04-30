import { Body, Controller, ForbiddenException, Post } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RefreshTokenDto } from './dto/refresh-token.dto'
import { RegisterDto } from './dto/register.dto'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // Tight cap: registration is rare and a brute-force target.
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    if (this.config.get<string>('ALLOW_REGISTRATION') === 'false') {
      throw new ForbiddenException('REGISTRATION_DISABLED')
    }
    return this.authService.register(dto)
  }

  // Anti brute-force: 10 attempts per 15 min per IP, then 429.
  @Throttle({ default: { ttl: 900_000, limit: 10 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  // Refresh runs hot from desktop clients — keep generous but bounded.
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto)
  }
}
