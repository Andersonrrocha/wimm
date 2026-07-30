/**
 * The second NestJS composition root: the same feature modules as
 * `app.module.ts` (the hosted, Postgres + accounts build), served instead
 * against one local, per-profile SQLite database, with `ProfileModule`
 * supplying identity in place of `AuthModule` + the global `JwtAuthGuard`,
 * and no rate limiting -- there is no network surface to abuse here, this
 * root is meant to be driven by a bundled, offline client, not exposed to
 * the internet the way the hosted API is.
 *
 * | Concern       | Hosted (`app.module.ts`)     | Local (this file)                    |
 * |---------------|------------------------------|---------------------------------------|
 * | Identity      | `AuthModule` + `JwtAuthGuard`| `ProfileModule` + its middleware      |
 * | Persistence   | `PrismaService` (Postgres)   | `LocalPrismaService` (SQLite), under   |
 * |               |                              | the `PrismaService` token             |
 * | Rate limiting | `ThrottlerGuard`             | none                                   |
 *
 * A dynamic module (`forRoot`), not a plain `@Module`, for the same reason
 * `ProfileModule` is one: the profile's database file path cannot be a
 * compile-time constant. Phase 3 stays Electron-free specifically so this
 * stays testable offline -- the file is always supplied by whoever composes
 * this module (a test, or eventually a `main.local.ts`), never read from
 * `app.getPath` here.
 *
 * **Why `PrismaModule` is never imported here.** `PrismaModule` is
 * `@Global()` and provides/exports the real, Postgres-backed `PrismaService`
 * -- but no feature module (`CategoriesModule`, `SourcesModule`, ...) imports
 * it directly; they all rely entirely on that `@Global()` registration
 * reaching them through the hosted `AppModule`. Importing `PrismaModule`
 * here would construct the real `PrismaService`, which throws in its own
 * constructor without `DATABASE_URL` -- something the local build never has.
 * So this module re-creates the *same global registration*, pointed at
 * `LocalPrismaService` instead: it declares `PrismaService` as one of its own
 * providers (aliased -- see the provider comment below, which explains why
 * that alias is invisible to the type checker) and marks the returned
 * `DynamicModule` `global: true`. That flag is not cosmetic -- Nest does not
 * let a module's own providers reach modules it imports by default (only the
 * reverse: an importer can see what an imported module exports). Every
 * feature module below is a sibling import of this alias, exactly like
 * `CategoriesModule` is a sibling of `PrismaModule` under the hosted
 * `AppModule` -- `global: true` is what makes the alias visible to them,
 * mirroring `@Global()` on `PrismaModule` itself.
 */
import { DynamicModule, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { AiModule } from './ai/ai.module'
import { CategoriesModule } from './categories/categories.module'
import { CategorizationRulesModule } from './categorization-rules/categorization-rules.module'
import { ImportsModule } from './imports/imports.module'
import { LocalPrismaService } from './prisma/local/local-prisma.service'
import { PrismaService } from './prisma/prisma.service'
import { ProfileModule } from './profile/profile.module'
import { assertUsableSessionToken, SESSION_TOKEN } from './profile/session-token'
import { SessionTokenGuard } from './profile/session-token.guard'
import { RecurrencesModule } from './recurrences/recurrences.module'
import { ReportsModule } from './reports/reports.module'
import { SourcesModule } from './sources/sources.module'
import { TransactionsModule } from './transactions/transactions.module'
import { UsersModule } from './users/users.module'

/**
 * `AiKeyCrypto` (`ai/ai-key-crypto.ts`) throws in its own constructor unless
 * `AI_KEY_ENCRYPTION_SECRET` resolves to a string of 16+ characters -- and it
 * is a hard dependency of `UsersService` (BYOK key encryption on
 * `PATCH /users/me`), which makes it a hard, transitive dependency of
 * `UsersModule`. `UsersModule` is one of "the same feature modules" this root
 * is required to serve, so this is not optional to satisfy: there is no
 * `.env` in the local build (no hosted secret exists to read), and there is
 * no other running instance to "keep the secret consistent across deploys"
 * with (`AiKeyCrypto`'s own doc comment) -- a single local profile *is* the
 * only deploy. A fixed, compiled-in value is therefore the honest choice
 * here, not a workaround: it is stable across restarts (so a previously
 * saved BYOK key stays decryptable), which a random-per-boot value would not
 * be (`AiKeyResolverService.resolveForUser` already treats a decrypt failure
 * as "no key" -- see its catch block -- so a wrong secret degrades
 * gracefully to "AI off", it does not crash).
 *
 * Worth being honest about, not papering over: this does not make the
 * BYOK key meaningfully secret against someone with filesystem access to the
 * profile's SQLite file -- the rest of that file (every transaction,
 * category, source) is already unencrypted on disk, so a fixed, known
 * constant only obscures the value from a casual glance at the raw database,
 * it is not a real security boundary. That is an accurate description of
 * what BYOK-at-rest "encryption" buys in a single-user, offline build, not a
 * defect introduced here -- flagged for whoever designs Phase 4's profile
 * storage in case a per-profile secret becomes worth the added complexity.
 */
const LOCAL_AI_KEY_ENCRYPTION_SECRET =
  'wimm-local-build-fixed-ai-key-encryption-secret-v1'

export interface AppLocalModuleOptions {
  /**
   * Absolute path to the active profile's SQLite database file. Supplied by
   * whoever composes this module -- never derived from `app.getPath` here
   * (see `ProfileModule`'s doc comment for the same rule).
   */
  databaseFile: string

  /**
   * The per-launch secret `SessionTokenGuard` checks every request against.
   * Generated once per process by `generateSessionToken()`
   * (`profile/session-token.ts`) and supplied here -- this module never
   * generates its own, so a test (or a future `main.local.ts`) controls
   * the value and can present it back on outgoing requests.
   */
  sessionToken: string
}

@Module({})
export class AppLocalModule {
  static forRoot(options: AppLocalModuleOptions): DynamicModule {
    // Verify-then-refuse, at the one call site nothing can route around --
    // see `assertUsableSessionToken`'s doc comment for why booting is the
    // right place for this check (and not, say, `SessionTokenGuard`'s
    // constructor: by the time Nest gets there, the misconfiguration has
    // already become either a silent total lockout or a request-time 500,
    // instead of a boot failure that names the problem). Mirrors the
    // set-verify-refuse contract `openLocalDatabase` and
    // `assertNativeAbiSelectedAt` already use elsewhere in this package.
    assertUsableSessionToken(options.sessionToken)

    return {
      module: AppLocalModule,
      global: true,
      imports: [
        // `isGlobal: true` mirrors the hosted root so `ConfigService` is
        // resolvable anywhere (`AiKeyCrypto`, `AiKeyResolverService`).
        // `ignoreEnvFile: true` is deliberate: the local build ships no
        // `.env`, and this keeps that true in tests regardless of whatever
        // `apps/api/.env` happens to exist on a developer's machine (which
        // carries hosted-only values like `DATABASE_URL` and
        // `JWT_ACCESS_SECRET` this root must never depend on).
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ AI_KEY_ENCRYPTION_SECRET: LOCAL_AI_KEY_ENCRYPTION_SECRET })],
        }),
        ProfileModule.forRoot({ databaseFile: options.databaseFile }),
        UsersModule,
        SourcesModule,
        CategoriesModule,
        CategorizationRulesModule,
        TransactionsModule,
        ImportsModule,
        RecurrencesModule,
        ReportsModule,
        AiModule,
      ],
      providers: [
        {
          provide: PrismaService,
          // The two generated clients are branded per provider, so TypeScript treats
          // them as distinct types even though phase 0 made the schemas identical and
          // phase 1 verified the SQLite client drives the same operations. Prisma also
          // refuses to pair a sqlite adapter with a postgres-generated client, so a
          // second client is mandatory and this is the single seam where they meet.
          //
          // Note what this line does NOT do: `useExisting` is typed `any` in Nest,
          // so the compiler checks nothing here. Substituting a class that does not
          // implement what the services call would produce no error -- not even a
          // warning -- and would fail only at runtime, deep inside a feature service.
          // Nothing but `app.local.module.spec.ts` stands behind this substitution;
          // it exercises a real read and a real write through `SourcesService` for
          // exactly that reason. Treat those tests as load-bearing, not incidental.
          useExisting: LocalPrismaService,
        },
        // Makes the launch's session token resolvable by DI token so
        // `SessionTokenGuard` (constructed below via `useClass`, which Nest
        // itself instantiates and injects) can receive it through its
        // constructor rather than a compile-time constant.
        { provide: SESSION_TOKEN, useValue: options.sessionToken },
        // Global guard for THIS composition root only -- see
        // `SessionTokenGuard`'s doc comment for why it exists and what it
        // protects. Registering `APP_GUARD` here, inside `forRoot`'s
        // returned `DynamicModule`, scopes it to whichever application
        // graph includes `AppLocalModule`; it has no effect on the hosted
        // `AppModule`, which never imports this module and keeps its own
        // `JwtAuthGuard` registration entirely untouched.
        { provide: APP_GUARD, useClass: SessionTokenGuard },
      ],
      exports: [PrismaService],
    }
  }
}
