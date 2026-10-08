import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AiModule } from '../ai/ai.module'
import { CategoriesModule } from '../categories/categories.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [
    // For `AiKeyCrypto` alone: `issueTokensForUser` reports `hasAiApiKey` as
    // "a key that still decrypts", the same question `UsersService` asks, so
    // the login payload and `/users/me` cannot disagree about it. `AiModule`
    // is already a direct import of `app.module.ts`, so this adds nothing to
    // the hosted boot requirements -- and `app.local.module.ts` composes
    // neither this module nor its controller (see `UsersModule`'s note).
    AiModule,
    CategoriesModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
