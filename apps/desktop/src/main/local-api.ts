/**
 * Boots the NestJS local composition (`AppLocalModule`, from `@wimm/api`)
 * inside Electron's main process, on an ephemeral loopback port protected by
 * a per-launch session token.
 *
 * **Why `@wimm/api` is imported only from `dist/`, never from `src/`.**
 * `electron-vite` bundles the main process with esbuild/rollup, and esbuild's
 * TypeScript-decorator transform does not implement `emitDecoratorMetadata`.
 * NestJS dependency injection is built entirely on that metadata: it is how
 * Nest discovers a constructor parameter's *type* (`SourcesService` needing a
 * `PrismaService`, say) well enough to resolve it. Importing `AppLocalModule`
 * (or anything it transitively pulls in) from TypeScript source under `apps/api/src` here
 * would feed that TypeScript source through esbuild as part of this bundle,
 * silently produce metadata-free decorators, and build a desktop app that
 * compiles cleanly and then fails at runtime with unresolvable providers --
 * exactly the failure already hit once in this project when booting Nest
 * under `tsx` (see the phase 4b plan's "landmine" section). `apps/api`'s own
 * `tsc` build (`emitDecoratorMetadata: true`, see `apps/api/tsconfig.json`)
 * already emits the correct metadata into plain, pre-compiled `dist/*.js` --
 * loading *that* output, instead of re-deriving it through a different
 * compiler, is what keeps decorator metadata intact. So every value imported
 * from `@wimm/api` below is imported from a `dist/` subpath specifically,
 * never a bare `@wimm/api` import (there is no `main`/`exports` field on
 * `apps/api/package.json` to accidentally resolve to source) and never a
 * `../../../api/src/...` relative path.
 *
 * **Why this is safe to import at all under `electron-vite`'s bundler.**
 * `apps/desktop/electron.vite.config.ts` explicitly keeps `@wimm/api`
 * external to the main-process bundle (see that file's comment) -- Rollup
 * leaves every `require('@wimm/api/dist/...')` call below untouched rather
 * than inlining `@wimm/api`'s source, so this module's own compiled output
 * still just `require()`s the real `dist/*.js` files at runtime, the same as
 * any other Node program would. `@wimm/api` is a real `workspace:*`
 * dependency of `apps/desktop` (see `package.json`) specifically so this
 * import resolves through normal `node_modules` resolution in both a dev
 * checkout (a symlink to `apps/api`) and, once Task 4 packages the API's
 * `dist/` and `prisma/migrations-sqlite/` alongside it, a packaged build.
 *
 * **Profile bootstrap here is headless only.** `ProfileModule` refuses to
 * boot against a database with zero `User` rows or more than one (a
 * deliberate phase 3 behaviour -- see `ActiveProfileService`'s doc comment).
 * Something has to guarantee exactly one profile, with exactly one `User`
 * row, exists before `AppLocalModule.forRoot` is ever called. `startLocalApi`
 * does the minimum needed for that: reuse the most recently opened profile if
 * one exists, or create a single default one (with a placeholder single user
 * row -- there are no credentials to collect in an offline, no-accounts
 * build) if none does. Choosing *which* profile to open, and letting the user
 * name one or create a second, is a picker UI -- Phase 4c's job, not this
 * one's.
 *
 * **CORS.** Deliberately not configured here at all -- see the phase 4b task
 * 2 report for the full reasoning. In short: the hosted build's
 * `app.enableCors()` is a permissive default that would let any origin
 * (including a page that DNS-rebinds a hostname it controls to `127.0.0.1`)
 * complete a CORS preflight and then send the session token header, which
 * defeats the exact protection that header is supposed to provide. Whatever
 * origin the renderer's own HTTP calls need to be allowed from is something
 * only Task 3 (which wires the renderer to this server) knows, and Task 3 may
 * choose to avoid the question entirely by proxying those calls through the
 * main process instead of issuing them directly from browser code.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'

import { INestApplication, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppLocalModule } from '@wimm/api/dist/app.local.module'
import { LocalPrismaService } from '@wimm/api/dist/prisma/local/local-prisma.service'
import { applyPendingMigrations } from '@wimm/api/dist/prisma/local/migration-runner'
import {
  createProfile,
  listProfiles,
  profileDatabasePath,
  touchProfile,
  type Profile,
} from '@wimm/api/dist/prisma/local/profile-registry'
import { generateSessionToken } from '@wimm/api/dist/profile/session-token'

// `require.resolve` rather than `__dirname`-relative traversal: the latter
// would point at wherever electron-vite happens to emit this bundle's own
// output (`apps/desktop/out/main/` in dev), which has no fixed relationship
// to `apps/api`'s own directory in a packaged build. Resolving through
// Node's module system instead finds the actual installed `@wimm/api`
// package root in both dev (a workspace symlink) and, once packaged, wherever
// `electron-builder` places it -- as long as Task 4 ships `@wimm/api`'s
// `package.json` alongside `dist/` and `prisma/migrations-sqlite/`, which is
// a direct consequence of treating `@wimm/api` as a real dependency instead
// of bundling it away. `createRequire(__filename)` avoids needing
// `import.meta.url` interop under this bundle's CommonJS output format.
const nodeRequire = createRequire(__filename)
const API_PACKAGE_ROOT = dirname(nodeRequire.resolve('@wimm/api/package.json'))
const SQLITE_MIGRATIONS_DIR = join(API_PACKAGE_ROOT, 'prisma', 'migrations-sqlite')

/** Name given to the single profile created on a first-ever launch. Phase 4c's onboarding replaces this with a name the user chooses. */
const DEFAULT_PROFILE_NAME = 'Default'

/**
 * Placeholder identity for the single `User` row a freshly created profile
 * needs (see `ActiveProfileService`'s "zero rows" failure). Local mode has
 * no sign-up flow -- there is no email or password to collect -- so these
 * values exist only to satisfy the schema; nothing in the local composition
 * ever authenticates against `passwordHash`, `ActiveProfileService` derives
 * identity straight from the one row in the profile's own database.
 */
const DEFAULT_USER_EMAIL = 'local@wimm.local'
const DEFAULT_USER_USERNAME = 'local'
const DEFAULT_USER_PASSWORD_HASH = 'local-profile-no-password-required'

export interface StartLocalApiOptions {
  /**
   * Absolute path to the directory that holds every local profile: the
   * registry (`profiles.json`), each profile's SQLite file (under
   * `profiles/`), and migration snapshots (under `backups/`). Resolved by
   * the caller (`app.getPath('userData') + 'profiles'`, in main) and passed
   * in -- `@wimm/api` must never import `electron`, so nothing in this
   * module or in `@wimm/api` reads `app.getPath` itself.
   */
  profileDir: string
}

export interface LocalApiHandle {
  /** The ephemeral port the OS actually assigned -- never assume this matches any prior launch. */
  port: number
  /**
   * This launch's session token. Held in memory by the caller only (handed
   * to the renderer over IPC, by Task 3) -- never persisted to disk or
   * logged. See `generateSessionToken`'s doc comment.
   */
  token: string
  /** Closes the HTTP server and disconnects Prisma. See the module doc comment's teardown notes. */
  close(): Promise<void>
}

/**
 * Thrown by `startLocalApi` when the profile's database was already migrated
 * by a build newer than this one -- `migration-runner.ts`'s own hard refusal
 * (see its doc comment), re-thrown here as a distinguishable error so the
 * caller (Electron `main`) can show the user something actionable instead of
 * a stack trace. `migration-runner.ts` cannot be modified by this task (it
 * belongs to `apps/api/src`, out of scope here), so detection is necessarily
 * a message match against its documented, stable wording rather than a
 * dedicated error class or `code` field -- brittle against a future wording
 * change there, but the alternative (never distinguishing this case at all)
 * is strictly worse. If `migration-runner.ts`'s message ever changes, this
 * degrades to the generic "unexpected boot failure" path below, not a crash.
 */
export class NewerDatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewerDatabaseError'
  }
}

const NEWER_BUILD_MARKER = 'was already migrated by a newer build of this app'

function rethrowMigrationFailure(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes(NEWER_BUILD_MARKER)) {
    throw new NewerDatabaseError(message)
  }
  throw err instanceof Error ? err : new Error(message)
}

/**
 * Picks which profile to open when more than one exists: the one with the
 * most recent `lastOpenedAt`, treating `null` (never reopened since being
 * created) as older than any real timestamp. This is a placeholder for a
 * real choice -- Phase 4c's profile picker replaces it -- so it deliberately
 * does the simplest thing that is not silently wrong: never guesses among
 * profiles with no way to prefer one, just picks the most recently used.
 */
function mostRecentlyOpened(profiles: readonly Profile[]): Profile {
  return [...profiles].sort((a, b) => {
    const aTime = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0
    const bTime = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0
    return bTime - aTime
  })[0]
}

/**
 * Ensures exactly one profile exists in `profileDir` and returns it, creating
 * one (headlessly -- see the module doc comment) if the registry is empty.
 * Marks the returned profile as opened `now`. Returns whether the profile was
 * newly created, so the caller knows whether it still needs its single
 * `User` row seeded.
 */
function ensureProfile(profileDir: string, now: Date): { profile: Profile; isNewProfile: boolean } {
  const profiles = listProfiles(profileDir)

  let profile: Profile
  let isNewProfile: boolean

  if (profiles.length === 0) {
    profile = createProfile(profileDir, DEFAULT_PROFILE_NAME, randomUUID(), now)
    isNewProfile = true
  } else {
    profile = mostRecentlyOpened(profiles)
    isNewProfile = false
  }

  touchProfile(profileDir, profile.id, now)

  return { profile, isNewProfile }
}

/**
 * Inserts the single `User` row a freshly created profile needs, through a
 * throwaway `LocalPrismaService` connection -- opened, used, and disconnected
 * before `AppLocalModule` composes its own connection to the same file, so
 * the two are never open at once. Mirrors the `seedUser` helper
 * `app.local.module.spec.ts` and `local-route-posture.spec.ts` already use
 * for the same purpose.
 */
async function seedDefaultUser(databaseFile: string): Promise<void> {
  const seeding = new LocalPrismaService(databaseFile)
  await seeding.onModuleInit()
  try {
    await seeding.user.create({
      data: {
        id: randomUUID(),
        email: DEFAULT_USER_EMAIL,
        username: DEFAULT_USER_USERNAME,
        passwordHash: DEFAULT_USER_PASSWORD_HASH,
      },
    })
  } finally {
    await seeding.onModuleDestroy()
  }
}

/**
 * Refuses unless `server.address()` reports a literal `127.0.0.1`.
 *
 * `app.listen(0, '127.0.0.1')` two lines below is easy to get right today and
 * easy to break later -- a refactor that reads the host from a config default
 * or an environment variable, say, would still look correct at a glance. This
 * is the same "set, then verify against the thing that actually happened,
 * then refuse" contract `openLocalDatabase`, `LocalPrismaService`, and
 * `native-abi-guard.ts` already use elsewhere in this codebase: reading the
 * *string passed to* `listen()` back would prove nothing, since that string
 * cannot lie about what it itself says. Reading `server.address()` instead
 * asks the kernel what it actually bound, and turns "this is now listening on
 * every interface" into an immediate, loud boot failure instead of a silent
 * network exposure.
 */
function assertBoundToLoopback(address: AddressInfo | string | null): void {
  if (typeof address === 'string' || address === null || address.address !== '127.0.0.1') {
    throw new Error(
      `startLocalApi: refusing to continue -- expected the server to be bound to 127.0.0.1, but ` +
        `server.address() reported ${JSON.stringify(address)}. This must never listen on a non-loopback ` +
        'address (e.g. 0.0.0.0), which would expose the local profile database to the rest of the network.',
    )
  }
}

/**
 * Boots the local (offline, per-profile SQLite) NestJS composition and
 * starts serving it on an ephemeral loopback port. See the module doc
 * comment for the full design; in order, this:
 *
 * 1. Ensures a profile exists in `options.profileDir` (creating one, with its
 *    single `User` row, on first launch) and applies any pending SQLite
 *    migrations to it, snapshotting first if anything is pending.
 * 2. Generates a fresh per-launch session token and composes
 *    `AppLocalModule.forRoot`.
 * 3. Listens on `127.0.0.1:0` (an OS-assigned ephemeral port), verifies the
 *    kernel actually bound to loopback, and returns the assigned port, the
 *    token, and a `close()` that tears both down.
 *
 * Throws `NewerDatabaseError` if the profile's database was migrated by a
 * newer build of this app (see that class's doc comment) -- the caller
 * should show the user something actionable, not a stack trace. Throws a
 * plain `Error` for any other boot failure (checksum drift, a corrupt
 * registry, a CHECK-constraint violation in a hand-edited database, ...).
 */
export async function startLocalApi(options: StartLocalApiOptions): Promise<LocalApiHandle> {
  const now = new Date()

  const { profile, isNewProfile } = ensureProfile(options.profileDir, now)

  const databaseFile = profileDatabasePath(options.profileDir, profile)
  mkdirSync(dirname(databaseFile), { recursive: true })

  const backupDir = join(options.profileDir, 'backups')

  try {
    applyPendingMigrations({
      file: databaseFile,
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      backupDir,
      databaseId: profile.id,
      now,
    })
  } catch (err) {
    rethrowMigrationFailure(err)
  }

  if (isNewProfile) {
    await seedDefaultUser(databaseFile)
  }

  const sessionToken = generateSessionToken()

  const app: INestApplication = await NestFactory.create(
    AppLocalModule.forRoot({ databaseFile, sessionToken }),
  )

  // Everything from here on can fail after the app (and, once `listen()`
  // resolves, its HTTP server) already exists -- assertBoundToLoopback below
  // is exactly such a check. Without this try/catch, a failure here would
  // leave a live Nest application (an open HTTP listener, an open Prisma
  // connection) with no `LocalApiHandle` for the caller to call `close()`
  // on, silently leaking both for the rest of the process's lifetime. See
  // this task's report for how this was actually found: the mutation proof
  // below (binding to 0.0.0.0) initially hung the whole test process rather
  // than failing fast, for exactly this reason.
  try {
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    // Deliberately no app.enableCors() call -- see the module doc comment.

    const server = await app.listen(0, '127.0.0.1')
    const address = server.address() as AddressInfo | string | null
    assertBoundToLoopback(address)
    const port = (address as AddressInfo).port

    return {
      port,
      token: sessionToken,
      close: async () => {
        await app.close()
      },
    }
  } catch (err) {
    await app.close().catch(() => {
      // Best-effort: the boot failure itself is what must propagate to the
      // caller; a secondary failure while cleaning up a partially-booted
      // app must never mask the original error.
    })
    throw err
  }
}
