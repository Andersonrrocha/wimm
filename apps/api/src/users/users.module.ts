import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

// `AuthModule` was imported here historically but never actually consumed --
// neither `UsersService` nor `UsersController` injects `AuthService`,
// `JwtModule`, or `PassportModule` (the only things `AuthModule` exports).
// The hosted build already gets `AuthModule` from `app.module.ts` directly,
// so removing the dead import here has no effect on it. It matters for the
// local composition root (`app.local.module.ts`), which must NOT include
// `AuthModule` at all: that module's `JwtModule.registerAsync` factory
// throws on missing `JWT_ACCESS_SECRET`, and its `AuthController` exposes
// register/login/refresh routes that would create extra `User` rows --
// directly contradicting the local build's "exactly one profile, one user"
// invariant (see `ActiveProfileService`). Since Nest registers every
// imported module's controllers regardless of who imports it, this dead
// import would otherwise leak `AuthModule` into the local build transitively
// through `UsersModule`, which the local root does need for `/users/me`.
@Module({
  imports: [AiModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
