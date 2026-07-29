/**
 * Wires the local (offline, no-accounts) build's identity seam into Nest's
 * DI graph: `LocalPrismaService`, constructed against the profile database
 * file supplied at registration, and `ActiveProfileService` on top of it,
 * with `ActiveProfileMiddleware` bound to every route.
 *
 * A dynamic module (`forRoot`) rather than a plain `@Module` because the
 * database file path cannot be a compile-time constant: Phase 3 stays
 * Electron-free specifically so it remains testable offline (see the plan's
 * global constraints) -- the profile directory/file is always injected by
 * whatever composes this module (a test, or eventually the local
 * composition root), never read from `app.getPath` here.
 *
 * `LocalPrismaService`'s constructor takes a plain `file: string`, not an
 * injectable token, so it cannot be constructed via `useClass` -- Nest would
 * have nothing to resolve that parameter from. `useFactory` closes over the
 * registration-time option instead. Nest still calls the resulting
 * instance's `onModuleInit`/`onModuleDestroy` normally: those lifecycle
 * hooks fire for any provider instance that implements them, regardless of
 * whether it was constructed via `useClass` or `useFactory`.
 *
 * Both `LocalPrismaService` and `ActiveProfileService` are exported so a
 * later composition root (Phase 4's `app.local.module.ts`) can bind
 * `LocalPrismaService` under the `PrismaService` token for the existing
 * feature modules -- that provider-token cast is explicitly out of scope
 * here; this module only has to make `LocalPrismaService` and
 * `ActiveProfileService` resolvable at all.
 */
import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { LocalPrismaService } from '../prisma/local/local-prisma.service'
import { ActiveProfileMiddleware } from './active-profile.middleware'
import { ActiveProfileService } from './active-profile.service'

export interface ProfileModuleOptions {
  /**
   * Absolute path to the active profile's SQLite database file. Chosen once
   * by whoever composes the application (see `ActiveProfileService`'s doc
   * comment for why per-request re-resolution is not needed) -- never
   * derived from `app.getPath` inside this module.
   */
  databaseFile: string
}

@Module({})
export class ProfileModule implements NestModule {
  static forRoot(options: ProfileModuleOptions): DynamicModule {
    return {
      module: ProfileModule,
      providers: [
        {
          provide: LocalPrismaService,
          useFactory: () => new LocalPrismaService(options.databaseFile),
        },
        ActiveProfileService,
        ActiveProfileMiddleware,
      ],
      exports: [LocalPrismaService, ActiveProfileService],
    }
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActiveProfileMiddleware).forRoutes('*')
  }
}
