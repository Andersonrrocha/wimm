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
 * **This module never guesses which profile to open, and never creates one
 * on its own.** `ProfileModule` refuses to boot against a database with zero
 * `User` rows or more than one (a deliberate phase 3 behaviour -- see
 * `ActiveProfileService`'s doc comment), so *something* has to guarantee
 * exactly one profile, with exactly one `User` row, exists before
 * `AppLocalModule.forRoot` is ever called -- but this module deliberately
 * does not decide that on its own anymore. An earlier version of this file
 * silently created a default profile on first launch and silently reopened
 * "whichever one was used most recently" when several existed; both were
 * scaffolding for phase 4b, kept only long enough to prove the embedded API
 * could boot at all. WIMM is a standalone app for people who are not
 * developers -- inventing a profile behind the user's back, or guessing
 * among several without asking, is not acceptable product behaviour once
 * profiles are a real, user-visible concept.
 *
 * Phase 4c task 2 replaces that with two explicit entry points, each of
 * which requires the caller (`index.ts`, driven by
 * `profile-lifecycle.ts`'s `resolveProfileSituation`) to have already
 * decided what should happen:
 *
 * - `openProfile` boots an *existing* profile the caller already identified
 *   (the sole profile when exactly one exists, or whichever one the user
 *   picked from a picker screen when several do).
 * - `createProfileAndOpen` creates a brand new profile from a user-supplied
 *   name (onboarding, when zero profiles exist) and then boots it.
 *
 * Both funnel into the same private `bootProfileDatabase`, which is
 * everything this module used to do after "which profile" was already
 * decided: apply pending migrations, resolve the AI key encryption secret,
 * generate a session token, compose `AppLocalModule.forRoot`, and listen.
 * Neither entry point ever reads the registry itself to decide *which*
 * profile to use -- see `profile-lifecycle.ts` for that decision, kept
 * deliberately separate and pure so it can be tested without a filesystem.
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
import {
  applyPendingMigrations,
  DATABASE_MIGRATED_BY_NEWER_BUILD_CODE,
} from '@wimm/api/dist/prisma/local/migration-runner'
import {
  createProfile,
  profileDatabasePath,
  touchProfile,
  type Profile,
} from '@wimm/api/dist/prisma/local/profile-registry'
import { resolveProfileAiKeyEncryptionSecret } from '@wimm/api/dist/prisma/local/profile-secret'
import { generateSessionToken } from '@wimm/api/dist/profile/session-token'

import { validateProfileName } from './profile-lifecycle'

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

/**
 * Absolute path to the directory that holds every local profile: the
 * registry (`profiles.json`), each profile's SQLite file (under
 * `profiles/`), and migration snapshots (under `backups/`). Resolved by
 * the caller (`app.getPath('userData') + 'profiles'`, in main) and passed
 * in -- `@wimm/api` must never import `electron`, so nothing in this
 * module or in `@wimm/api` reads `app.getPath` itself.
 */
export interface OpenProfileOptions {
  profileDir: string
  /**
   * The profile to open, exactly as `profile-lifecycle.ts`'s
   * `resolveProfileSituation` (or a picker screen, once the user has chosen)
   * reported it. This module never reads the registry itself to find or
   * choose a profile -- see the module doc comment.
   */
  profile: Profile
}

export interface CreateProfileOptions {
  profileDir: string
  /**
   * The user-supplied name for the new profile, as typed into the
   * onboarding screen. Validated and normalized by `validateProfileName`
   * (`profile-lifecycle.ts`) before it ever reaches `createProfile` --
   * never used to build a filesystem path either way, see that function's
   * doc comment.
   */
  name: string
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
 * (`DatabaseMigratedByNewerBuildError`, see its doc comment), re-thrown here
 * as this module's own distinguishable error so the caller (Electron `main`)
 * can show the user something actionable instead of a stack trace, without
 * `main` needing to import anything from `@wimm/api` itself.
 *
 * Detection (`isDatabaseMigratedByNewerBuildError` below) matches on
 * `migration-runner.ts`'s `DATABASE_MIGRATED_BY_NEWER_BUILD_CODE` discriminant
 * field, never on the error's *message* -- a caller that had to pattern-match
 * human-readable text would break silently the moment that text was
 * reworded. See `DATABASE_MIGRATED_BY_NEWER_BUILD_CODE`'s doc comment
 * (`apps/api/src/prisma/local/migration-runner.ts`) for the full reasoning,
 * including why `code` is preferred over `instanceof` even though this
 * repo's specific module resolution (a single `workspace:*`-resolved copy of
 * `@wimm/api`) makes `instanceof` sound here too.
 */
export class NewerDatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewerDatabaseError'
  }
}

/**
 * True when `err` is `migration-runner.ts`'s `DatabaseMigratedByNewerBuildError`,
 * identified structurally by its `code` field rather than `instanceof` or a
 * message match. Exported for `local-api.spec.ts` to exercise directly with a
 * synthetic error object -- proving this reacts to the discriminant and not
 * to any particular wording of `.message`.
 */
export function isDatabaseMigratedByNewerBuildError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === DATABASE_MIGRATED_BY_NEWER_BUILD_CODE
  )
}

/**
 * Exported (not just called internally) so `local-api.spec.ts` can prove,
 * directly and without going through a real failing migration, that this
 * reacts to `isDatabaseMigratedByNewerBuildError`'s discriminant check and
 * not to any specific message text -- see that spec for the "reworded
 * message, same detection" and "same message, broken discriminant" cases.
 */
export function rethrowMigrationFailure(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  if (isDatabaseMigratedByNewerBuildError(err)) {
    throw new NewerDatabaseError(message)
  }
  throw err instanceof Error ? err : new Error(message)
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
 * Everything needed to serve `profile` once "which profile" has already
 * been decided by the caller -- the shared core of `openProfile` and
 * `createProfileAndOpen`. In order, this:
 *
 * 1. Applies any pending SQLite migrations to `profile`'s database,
 *    snapshotting first if anything is pending.
 * 2. Seeds the single placeholder `User` row if `isNewProfile` (a profile
 *    `createProfileAndOpen` just registered has no rows yet; one opened by
 *    `openProfile` already has its row from when it was created).
 * 3. Resolves this profile's AI key encryption secret
 *    (`resolveProfileAiKeyEncryptionSecret`, `@wimm/api`'s
 *    `prisma/local/profile-secret`), migrating a BYOK key encrypted under
 *    the old shared constant if this profile predates per-profile secrets.
 *    Runs after step 2 (the `User` table, and its row, must already exist)
 *    and before step 4 (the secret is a required, verified boot argument --
 *    see `assertUsableAiKeyEncryptionSecret`).
 * 4. Generates a fresh per-launch session token and composes
 *    `AppLocalModule.forRoot`.
 * 5. Listens on `127.0.0.1:0` (an OS-assigned ephemeral port), verifies the
 *    kernel actually bound to loopback, and returns the assigned port, the
 *    token, and a `close()` that tears both down.
 *
 * Throws `NewerDatabaseError` if the profile's database was migrated by a
 * newer build of this app (see that class's doc comment) -- the caller
 * should show the user something actionable, not a stack trace. Throws a
 * plain `Error` for any other boot failure (checksum drift, a CHECK-
 * constraint violation in a hand-edited database, ...).
 */
async function bootProfileDatabase(
  profileDir: string,
  profile: Profile,
  now: Date,
  isNewProfile: boolean,
): Promise<LocalApiHandle> {
  const databaseFile = profileDatabasePath(profileDir, profile)
  mkdirSync(dirname(databaseFile), { recursive: true })

  const backupDir = join(profileDir, 'backups')

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

  // Resolves (creating and migrating on first use) this profile's own AI key
  // encryption secret -- see profile-secret.ts for the full design, in
  // particular why it lives outside `profiles/` (so Task 4's export of the
  // `.db` file alone never carries it) and how a profile written before this
  // existed is migrated from the old shared constant. A freshly created
  // profile (isNewProfile above) has no BYOK key yet, so this is a cheap
  // no-op migration the first time it runs for it, exactly like every other
  // profile.
  const { secret: aiKeyEncryptionSecret, migration } = resolveProfileAiKeyEncryptionSecret({
    profileDir,
    profileId: profile.id,
    databaseFile,
  })

  if (migration && migration.leftUntouchedUserIds.length > 0) {
    // Not expected on the normal migration path -- see
    // `MigrateAiKeyEncryptionSecretResult.leftUntouchedUserIds`'s doc
    // comment for the narrow crash window that can cause it. Logged, never
    // swallowed: the affected user's BYOK key is gone (AiKeyResolverService
    // degrades to "no key" for them), and this is the one place that can
    // still name it.
    console.warn(
      `bootProfileDatabase: ${migration.leftUntouchedUserIds.length} user row(s) in profile "${profile.id}" had ` +
        'an aiApiKeyEncrypted value that could not be decrypted during AI key secret migration; left untouched. ' +
        'The affected user will see AI off and needs to re-enter their BYOK API key in Settings.',
    )
  }

  const sessionToken = generateSessionToken()

  const app: INestApplication = await NestFactory.create(
    AppLocalModule.forRoot({ databaseFile, sessionToken, aiKeyEncryptionSecret }),
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

/**
 * Opens a profile the caller has already identified -- the sole profile
 * `resolveProfileSituation` found, or the one a picker screen's user
 * selected. Marks it as opened `now` (`touchProfile`) and boots it via
 * `bootProfileDatabase`. Never creates a profile and never consults the
 * registry to decide *which* one to open -- see the module doc comment.
 */
export async function openProfile(options: OpenProfileOptions): Promise<LocalApiHandle> {
  const now = new Date()
  touchProfile(options.profileDir, options.profile.id, now)
  return bootProfileDatabase(options.profileDir, options.profile, now, false)
}

/**
 * Registers a brand new profile named `options.name` (validated and
 * normalized by `validateProfileName` -- throws `InvalidProfileNameError`
 * for anything that fails that check, before touching the registry or the
 * filesystem at all) and boots it via `bootProfileDatabase`, which seeds its
 * single placeholder `User` row (see that function's doc comment) since a
 * newly created profile has none yet.
 *
 * The new profile's `id` is generated here (`randomUUID()`), never derived
 * from `options.name` -- `createProfile` (`profile-registry.ts`) builds
 * `dbFileName` from this `id` alone, which is what keeps a user-chosen name
 * from ever being able to influence a filesystem path.
 */
export async function createProfileAndOpen(options: CreateProfileOptions): Promise<LocalApiHandle> {
  const now = new Date()
  const name = validateProfileName(options.name)
  const profile = createProfile(options.profileDir, name, randomUUID(), now)
  touchProfile(options.profileDir, profile.id, now)
  return bootProfileDatabase(options.profileDir, profile, now, true)
}
