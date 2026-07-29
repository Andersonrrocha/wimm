/**
 * Resolves the active profile's single `User` row and caches it, shaped
 * exactly as `JwtPayload` (`{ sub, email, username }` -- see
 * `auth/strategies/jwt.strategy.ts`). This is the local (offline,
 * no-accounts) build's substitute for a JWT: there is no token to decode, so
 * this service is the thing that decides what `@CurrentUser()` sees, sourced
 * straight from the one SQLite file this running instance owns.
 *
 * **Lookup timing: once, at `onModuleInit`, not per request.** The brief for
 * this module poses this as a deliberate choice, not something to default
 * into, so here is the reasoning:
 *
 * - There is exactly one profile, one database, and one user per running
 *   instance -- chosen once at composition time (see `ProfileModule`).
 *   Switching profiles tears down and rebuilds the whole Nest application
 *   (Phase 4's job), so nothing short of a full restart can change *which*
 *   user this instance serves.
 * - Within a single running instance, nothing exposed today can change
 *   `sub` (the row's primary key, immutable once created), `email`, or
 *   `username` -- `UsersService.updateMe` (see `users/users.service.ts`)
 *   only ever writes `preferredLocale`, `chartDateMode`,
 *   `aiCategorizationMode`, and `aiApiKeyEncrypted`. So there is no code
 *   path today that could make a cached value stale during a session.
 * - A per-request lookup would cost a query on every single request to
 *   guard against a staleness window that, given the point above, cannot
 *   currently occur -- pure overengineering for a value that is, in
 *   practice, already immutable for the lifetime of the process. If
 *   `email`/`username` ever become editable in the local build, that is a
 *   deliberate design change (most likely: restart the profile's Nest
 *   instance the same way switching profiles already does) rather than a
 *   silent gap this service should paper over by re-querying every time.
 *
 * **Zero users vs. more than one user -- both are real, and neither is
 * silently tolerated.** A profile's database is meant to hold exactly one
 * `User` row by construction (one profile = one person = one row), but nothing
 * enforces that at the schema level, and both failure shapes are reachable:
 *
 * - **Zero rows**: a freshly created profile file that has had migrations
 *   applied but has not yet been onboarded (that step -- inserting the first
 *   `User` row -- belongs to whatever creates and onboards a profile,
 *   Phase 4's composition root, not this service). This service's job
 *   assumes an already-onboarded profile; conjuring a placeholder user here
 *   would invent identity data (an email, a username) nobody supplied, which
 *   this project's principles explicitly forbid ("Never invent features
 *   outside what the user asked"). So this is a hard failure, not a silent
 *   default -- it means whatever composed this module did so too early.
 * - **More than one row**: never expected, and not recoverable by guessing
 *   -- there is no way to know which row is "the" user for this session, and
 *   picking one (e.g. the first) would silently authenticate every request
 *   as a possibly-wrong user. This is corruption or a schema-isolation bug,
 *   and it fails loudly, naming the count.
 *
 * Both are checked -- and, if invalid, thrown -- inside `onModuleInit`, so a
 * broken profile fails Nest's bootstrap itself, before the HTTP server ever
 * starts accepting connections. That is deliberate: the alternative (defer
 * the check to the first request) would let the app start serving traffic
 * with no working identity source, and the *symptom* of that -- given
 * `@CurrentUser()`'s own independent 401 on a missing `request.user` -- would
 * be a confusing 401 on every route, indistinguishable from "no one is
 * logged in yet" instead of what it actually is: a broken composition that
 * should never have started.
 */
import { Injectable, OnModuleInit } from '@nestjs/common'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { LocalPrismaService } from '../prisma/local/local-prisma.service'

@Injectable()
export class ActiveProfileService implements OnModuleInit {
  private user: JwtPayload | undefined

  constructor(private readonly prisma: LocalPrismaService) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.prisma.user.findMany({
      select: { id: true, email: true, username: true },
    })

    if (rows.length === 0) {
      throw new Error(
        "ActiveProfileService: the active profile's database has no User row yet. Every profile is expected " +
          'to already be onboarded (exactly one User row created) before its Nest instance is composed -- ' +
          'creating a placeholder user here would invent identity data (email/username) nobody supplied. ' +
          'This means the profile was wired up before onboarding finished, or the User row was deleted after ' +
          'the fact; neither is something this service can recover from on its own.',
      )
    }

    if (rows.length > 1) {
      throw new Error(
        `ActiveProfileService: the active profile's database contains ${rows.length} User rows; expected ` +
          'exactly 1. Each profile is meant to be one person\'s isolated SQLite file, so more than one User ' +
          'row means the database is corrupted or shared across profiles -- there is no way to know which ' +
          'row is "the" user for this session, so none is guessed.',
      )
    }

    const [row] = rows
    this.user = { sub: row.id, email: row.email, username: row.username }
  }

  /**
   * Returns the active profile's single user, shaped as `JwtPayload` --
   * exactly what the middleware writes onto every request's `req.user`.
   *
   * Throws if called before `onModuleInit` has resolved a user. This should
   * never happen once Nest has finished bootstrapping: Nest resolves a
   * provider's dependencies' `onModuleInit` hooks before that provider's own
   * consumers can be invoked (this service is `ActiveProfileMiddleware`'s
   * only dependency), so by the time any request reaches the middleware,
   * this has already run. The guard exists so a future direct call (e.g. a
   * test, or code that forgets to await bootstrap) fails loudly with a
   * message that names the actual problem, instead of silently handing back
   * `undefined` for `@CurrentUser()` to misreport as "not logged in".
   */
  getUser(): JwtPayload {
    if (!this.user) {
      throw new Error(
        "ActiveProfileService.getUser() was called before the active profile's user was resolved " +
          '(onModuleInit has not completed). This should never happen once the application has finished ' +
          'bootstrapping.',
      )
    }
    return this.user
  }
}
