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
 * **Phase 4c task 3 adds a third entry point, `switchProfile`,** for moving
 * from one already-open profile to another without restarting the app. It
 * tears the current profile's Nest application down and boots the target
 * through the exact same `bootProfileDatabase` the two entry points above
 * use -- there is no separate, parallel "switch" boot path to keep in sync
 * with the other two.
 *
 * **Does switching rotate the session token? Yes -- for free, and it could
 * not be otherwise without extra code to prevent it.** `bootProfileDatabase`
 * calls `generateSessionToken()` on every boot, unconditionally; `openProfile`
 * and `createProfileAndOpen` already rely on that (reopening the same
 * profile a second time gets a new token too -- see `local-api.spec.ts`'s
 * "reopens the existing profile" test, which never asserts the token stays
 * the same). `switchProfile` reuses `openProfile` for the target, so the new
 * token is simply whatever that boot generates -- there is no old token to
 * "carry over" even if that were desirable. This is also the *correct*
 * behaviour, not just the convenient one: a session token authenticates
 * against one specific, currently-running `AppLocalModule` instance (its
 * `SessionTokenGuard` holds exactly that one value), not against "the app"
 * as an abstract, ongoing concept. Once the old instance is torn down, its
 * token authenticates nothing -- keeping it "valid" would be a token that
 * accepts requests no server is listening for. And because the renderer
 * never receives a session token in the first place (`local-api-bridge.ts`
 * attaches it in main, from whichever `LocalApiHandle` is current, read
 * fresh at request time -- see that module's doc comment), there is no
 * stale-token cleanup for the renderer to perform after a switch either: the
 * very next `local-api:request` call simply gets routed with the new
 * handle's token, transparently.
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
import { basename, dirname, join } from 'node:path'

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
import {
  exportDatabaseCopy,
  listPreservationCopies,
  listSnapshots,
  restoreSnapshot,
  type SnapshotInfo,
} from '@wimm/api/dist/prisma/local/snapshot'
import { generateSessionToken } from '@wimm/api/dist/profile/session-token'

import type { BackupSummary, ProfileBackups } from '../shared/backup-protocol'
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
  /**
   * The profile this handle is serving. Added for Task 3 (profile
   * switching): `switchProfile` (below) needs to know which profile to
   * reopen if the profile it is switching TO fails to boot -- see that
   * function's rollback behaviour. Carrying it on the handle itself is what
   * lets both `switchProfile` and its caller (`index.ts`) treat "which
   * profile is this handle serving" as a single fact instead of a second,
   * separately-tracked variable that could drift out of sync with
   * `localApiHandle` itself.
   */
  profile: Profile
  /**
   * The underlying NestJS application. No production code path other than
   * `close()` below (which already wraps `app.close()`) needs this -- it is
   * exposed so `local-api.spec.ts` can reach this profile's real
   * `LocalPrismaService` (`app.get(LocalPrismaService)`) and hold a
   * genuine, in-flight write transaction against it. That turned out to be
   * the only way to construct a real, OS-level SQLite lock on a profile's
   * database file that `switchProfile`'s teardown can be proven to release:
   * an idle connection -- even a fully open one -- holds no SQLite lock at
   * all (see `assertExclusiveAccess`'s doc comment,
   * `apps/api/src/prisma/local/snapshot.ts`), so there is nothing for an
   * exclusive-lock probe to catch unless a real transaction is genuinely in
   * flight. See this task's report for the full investigation, including a
   * previously-undocumented finding: a probe using the root workspace
   * `better-sqlite3` build (what `assertExclusiveAccess` itself uses)
   * cannot see a lock held by `LocalPrismaService`'s connection at all, in
   * this environment, because `@prisma/adapter-better-sqlite3` bundles a
   * *different* `better-sqlite3` build internally -- the probe in
   * `local-api.spec.ts` therefore deliberately opens the SAME bundled build
   * Prisma itself uses, not the root one.
   */
  app: INestApplication
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
      profile,
      app,
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
 * `databaseFileName` from this `id` alone, which is what keeps a user-chosen name
 * from ever being able to influence a filesystem path.
 */
export async function createProfileAndOpen(options: CreateProfileOptions): Promise<LocalApiHandle> {
  const now = new Date()
  const name = validateProfileName(options.name)
  const profile = createProfile(options.profileDir, name, randomUUID(), now)
  touchProfile(options.profileDir, profile.id, now)
  return bootProfileDatabase(options.profileDir, profile, now, true)
}

/** What `switchProfile` needs to move from one already-open profile to another. */
export interface SwitchProfileOptions {
  profileDir: string
  /**
   * The profile currently open -- torn down (the hard requirement below)
   * before `target` is ever touched. `current.profile` is what
   * `switchProfile` reopens if `target` fails to boot; see
   * `ProfileSwitchError`'s doc comment.
   */
  current: LocalApiHandle
  /**
   * The profile to switch to. `switchProfile` never reads the registry
   * itself to validate this -- the caller (`index.ts`'s `profiles:switch`
   * handler) re-reads it fresh and confirms `target` is a real entry before
   * calling this, the same "validate in main, never trust a renderer-
   * supplied id" contract `profiles:open` already follows.
   */
  target: Profile
}

/**
 * Thrown by `switchProfile` when `target` could not be opened -- a corrupt
 * database, a `NewerDatabaseError`, or any other boot failure `openProfile`
 * can raise (see `bootProfileDatabase`'s doc comment). By the time this is
 * thrown, `current` is already closed: the hard teardown-first requirement
 * below applies unconditionally, whether or not the switch itself goes on
 * to succeed. The caller therefore cannot simply keep using `current` --
 * `rolledBackHandle` is what `switchProfile` could put back in its place:
 *
 * - A freshly booted handle for the SAME profile `current` was already
 *   serving, if reopening it succeeded. This is the expected outcome for a
 *   bad *target* (the common failure: the profile the user picked is
 *   corrupt, or was written by a newer build) -- the user lands back on
 *   exactly the profile they started from, still working, under a new
 *   session token (see the module doc comment's "does switching rotate the
 *   token" note: every boot generates one, and rollback is just another
 *   boot of the same profile).
 * - `undefined` if even that reopen failed -- both the target and the
 *   profile the user started from are now unopenable, and nothing is
 *   running. Rare (it means a profile that was working moments ago no
 *   longer is), but the caller must still handle it: see `index.ts`'s
 *   `profiles:switch` handler, which falls back to re-deriving the
 *   picker/onboarding situation so a renderer reload (the existing
 *   `local-backend-error` screen's own recovery action, reused rather than
 *   inventing a second failure surface -- see this task's report) lands the
 *   user on a real recovery screen instead of nothing.
 */
export class ProfileSwitchError extends Error {
  constructor(
    message: string,
    public readonly rolledBackHandle: LocalApiHandle | undefined,
  ) {
    super(message)
    this.name = 'ProfileSwitchError'
  }
}

/**
 * Switches from `options.current` to `options.target`: tears the current
 * profile's Nest application and Prisma connection down, then boots the
 * target the same way `openProfile` boots any other existing profile.
 *
 * **Hard requirement, carried over from the Phase 2 review and restated
 * here because it is not negotiable: `current` is fully closed BEFORE
 * `target`'s database file is ever touched.** Overwriting or even just
 * opening a second connection to a SQLite file while another connection is
 * still using it is undefined behaviour -- corruption, or a stale page-
 * cache read, and either way silently. `await current.close()` runs first,
 * unconditionally, before `openProfile(target)` is ever called -- there is
 * no code path in this function that reaches `openProfile` without having
 * already awaited that close. This matters beyond this function's own
 * correctness: `restoreSnapshot` (Task 4, next) refuses when it cannot get
 * exclusive access to its target, but it can only detect a connection that
 * is genuinely mid-transaction at the moment it checks -- not an idle open
 * handle (see `assertExclusiveAccess`'s doc comment,
 * `apps/api/src/prisma/local/snapshot.ts`). A handle this function leaked
 * would not announce itself there; it would either slip past that check
 * silently or turn a later restore into a refusal the user cannot explain.
 * `local-api.spec.ts` proves the teardown is genuine with a real OS-level
 * SQLite lock, not a spy on `close()` -- see that file's "switchProfile"
 * describe block, and this task's report for why a naive lock probe cannot
 * prove this on its own (an idle connection holds no lock to detect).
 *
 * If `target` fails to boot, `current` is NOT reopened automatically as a
 * side effect of the failure being thrown -- this function makes exactly
 * one attempt to land the user somewhere usable (reopening `current.profile`
 * once) and reports the outcome via `ProfileSwitchError.rolledBackHandle`
 * rather than silently retrying or leaving the caller to guess what state
 * things are in. See that class's doc comment for the two possible
 * outcomes.
 */
export async function switchProfile(options: SwitchProfileOptions): Promise<LocalApiHandle> {
  const { profileDir, current, target } = options

  // The hard requirement above -- nothing below this line may run before
  // this resolves.
  await current.close()

  try {
    return await openProfile({ profileDir, profile: target })
  } catch (err) {
    let rolledBackHandle: LocalApiHandle | undefined
    try {
      rolledBackHandle = await openProfile({ profileDir, profile: current.profile })
    } catch (rollbackErr) {
      // Logged, never swallowed: this is the one place that can still name
      // the rollback's own failure. The error thrown below carries the
      // ORIGINAL switch failure (what the user actually needs to see);
      // conflating it with the rollback failure would bury one message
      // inside the other instead of reporting either clearly.
      console.error(
        `switchProfile: rollback to the previous profile ("${current.profile.id}") also failed after switching ` +
          `to "${target.id}" failed:`,
        rollbackErr,
      )
    }

    const message = err instanceof Error ? err.message : String(err)
    throw new ProfileSwitchError(`Could not switch to profile "${target.name}": ${message}`, rolledBackHandle)
  }
}

// --- Phase 4c task 4: export and restore -----------------------------------
//
// D8 (see the phase plan): a profile's SQLite file lives at
// `userData/profiles/<id>.db` -- a location a non-technical person will
// never find on their own. That location is only acceptable BECAUSE the app
// gains an explicit export action, and restore is the recovery half of the
// same story: the path back when an update, or a mistake, damages the data.
// Every function below reuses the exact machinery Tasks 1-3 already built
// (`profileDatabasePath`, `resolveProfileSituation`'s registry, and --
// critically -- Task 3's own `LocalApiHandle.close()` teardown) rather than
// inventing a second copy of any of it.

/** Absolute path of `profileDir`'s shared backup directory -- see `snapshot.ts`'s module doc comment for why every profile's snapshots live in one directory, distinguished by `databaseId` (the profile's own `id`). */
function backupDirFor(profileDir: string): string {
  return join(profileDir, 'backups')
}

/** Strips `SnapshotInfo.path` down to a `fileName` before it crosses into the renderer -- see `backup-protocol.ts`'s doc comment for why. */
function toBackupSummary(info: SnapshotInfo): BackupSummary {
  return {
    fileName: basename(info.path),
    takenAt: info.takenAt.toISOString(),
    sizeBytes: info.sizeBytes,
    schemaVersion: info.schemaVersion,
  }
}

/**
 * Lists `profile`'s own backups -- both ordinary, validated snapshots and
 * (carry-over 1) the unvalidated preservation copies a previous restore may
 * have left behind, each carrying its schema version (carry-over 2). Never
 * touches whether `profile` is the currently active one; a restore UI can
 * browse a DIFFERENT, already-closed profile's backups just as well (the
 * multi-profile recovery path -- see `restoreProfileFromBackup`'s doc
 * comment).
 */
export function listProfileBackups(profileDir: string, profile: Profile): ProfileBackups {
  const backupDir = backupDirFor(profileDir)
  return {
    snapshots: listSnapshots(backupDir, profile.id).map(toBackupSummary),
    preservationCopies: listPreservationCopies(backupDir, profile.id).map(toBackupSummary),
  }
}

/**
 * Copies `profile`'s live database to `destination` -- the whole of "export"
 * (D8): main's `backups:export` IPC handler resolves `destination` via
 * `dialog.showSaveDialog` and calls straight through to this. Reuses
 * `snapshot.ts`'s `exportDatabaseCopy` for the actual copy (DELETE-journal-
 * mode check, then a post-write integrity check) -- this function's only
 * job is resolving `profile`'s database file path, the same
 * `profileDatabasePath` every other profile operation in this module uses.
 *
 * **What this does NOT copy, deliberately.** Task 1's AI key encryption
 * secret lives at `<profileDir>/secrets/<id>.key` -- a sibling of
 * `profiles/`, outside this function's reach entirely (it never even
 * constructs that path). An exported profile therefore never carries the
 * secret its BYOK key is encrypted under; `AiKeyResolverService` treats the
 * resulting decrypt failure as "no key" and degrades to AI-off rather than
 * crashing. See `profile-secret.ts`'s module doc comment for the full
 * reasoning, and the export UI copy (`profile-backups.tsx`) for where this
 * is disclosed to the user, in both `en` and `pt`, before they export.
 */
export function exportActiveProfileDatabase(profileDir: string, profile: Profile, destination: string): void {
  exportDatabaseCopy(profileDatabasePath(profileDir, profile), destination)
}

/**
 * Thrown by `restoreProfileFromBackup` when restoring the ACTIVE profile
 * fails after its connection was already closed -- mirrors
 * `ProfileSwitchError` exactly, including the one rollback attempt and the
 * two possible outcomes for `rolledBackHandle`. See that class's doc
 * comment; the reasoning is identical here, just for a restore instead of a
 * switch.
 */
export class ProfileRestoreError extends Error {
  constructor(
    message: string,
    public readonly rolledBackHandle: LocalApiHandle | undefined,
  ) {
    super(message)
    this.name = 'ProfileRestoreError'
  }
}

export interface RestoreProfileOptions {
  profileDir: string
  /** The profile being restored -- not necessarily the active one, see below. */
  profile: Profile
  /** `basename` of the snapshot or preservation copy to restore from, exactly as `listProfileBackups` reported it. Re-validated against a fresh listing before anything is touched -- see this function's doc comment. */
  fileName: string
  /**
   * The currently open handle, if `profile` is the one it is serving --
   * `undefined` when restoring a DIFFERENT, already-closed profile (this
   * process holds no live connection to it, so there is nothing to close
   * and nothing to reopen afterward). The caller (`index.ts`'s
   * `backups:restore` handler) decides which case applies by comparing
   * `profile.id` against whichever profile `localApiHandle` is currently
   * serving.
   */
  current: LocalApiHandle | undefined
}

/**
 * Restores `profile`'s database from one of its own backups (`fileName`),
 * overwriting the live file.
 *
 * **Reuses Task 3's teardown, not a second one.** When `current` is
 * provided (restoring the profile this process currently has open),
 * `current.close()` -- the exact function `switchProfile` already proved
 * genuinely releases the SQLite connection, even mid-transaction -- is
 * passed straight through as `restoreSnapshot`'s required
 * `closeExistingConnections` callback, run at the one moment that matters
 * (immediately before `restoreSnapshot`'s own exclusive-access probe), not
 * closed ahead of time and hoped to still be closed by the time it matters.
 *
 * **Never trusts `fileName` as a path.** The real candidate set is
 * re-derived fresh from `listProfileBackups` and matched by basename; a
 * `fileName` that does not name a real, current backup of `profile` is
 * rejected before `restoreSnapshot` -- and therefore before
 * `closeExistingConnections` -- ever runs. This is what keeps a restore
 * request for an unrelated file (or a stale `fileName` from a listing taken
 * before pruning removed it) from ever tearing down a live connection for
 * nothing.
 *
 * **The multi-profile recovery path.** `current: undefined` is not merely
 * "no profile is open at all" -- it is also the ordinary case for
 * restoring a profile OTHER than the one currently active. A user with two
 * profiles who hits `NewerDatabaseError` opening or switching to one of
 * them can open the OTHER, working profile, and from there restore the
 * broken one from an earlier backup (taken before whatever upgrade broke
 * it) without this process ever needing a live connection to it. Recovering
 * the active profile and recovering a sibling profile are the same
 * operation here, distinguished only by whether `current` is supplied.
 *
 * **Failure after a successful close.** If `restoreSnapshot` fails for any
 * reason AFTER `current.close()` has already run -- e.g. the exclusive-
 * access probe still finds contention from some other process entirely --
 * this makes exactly one rollback attempt (`openProfile(profile)`, the same
 * profile, unchanged on disk since the failure happened before the final
 * rename) and throws `ProfileRestoreError` carrying the result, mirroring
 * `switchProfile`/`ProfileSwitchError`. If it fails BEFORE `current` was
 * ever closed (the common case: the chosen backup itself fails validation,
 * which is exactly what picking an "unvalidated" preservation copy can
 * legitimately do), the original error is rethrown as-is -- `current` was
 * never touched, so there is nothing to roll back.
 */
export async function restoreProfileFromBackup(options: RestoreProfileOptions): Promise<LocalApiHandle | undefined> {
  const { profileDir, profile, fileName, current } = options
  const backupDir = backupDirFor(profileDir)

  const candidates = [...listSnapshots(backupDir, profile.id), ...listPreservationCopies(backupDir, profile.id)]
  const match = candidates.find((candidate) => basename(candidate.path) === fileName)
  if (!match) {
    throw new Error(
      `restoreProfileFromBackup: no backup named ${JSON.stringify(fileName)} was found for profile "${profile.id}".`,
    )
  }

  const targetFile = profileDatabasePath(profileDir, profile)
  const now = new Date()

  if (!current) {
    // No live connection in this process to close, and nothing to reopen
    // afterward -- `profile` is not the one this process is serving. See
    // this function's doc comment's "multi-profile recovery path".
    await restoreSnapshot(match.path, targetFile, profile.id, now, () => {})
    return undefined
  }

  let closed = false
  const closeExistingConnections = async (): Promise<void> => {
    // Task 3's own proven teardown -- see this function's doc comment.
    await current.close()
    closed = true
  }

  try {
    await restoreSnapshot(match.path, targetFile, profile.id, now, closeExistingConnections)
    return await openProfile({ profileDir, profile })
  } catch (err) {
    if (!closed) {
      // Refused before touching anything -- current is untouched and still
      // serving. Nothing to roll back.
      throw err
    }

    let rolledBackHandle: LocalApiHandle | undefined
    try {
      rolledBackHandle = await openProfile({ profileDir, profile })
    } catch (reopenErr) {
      console.error(
        `restoreProfileFromBackup: reopening profile "${profile.id}" after a failed restore also failed:`,
        reopenErr,
      )
    }

    const message = err instanceof Error ? err.message : String(err)
    throw new ProfileRestoreError(`Could not restore profile "${profile.name}": ${message}`, rolledBackHandle)
  }
}
