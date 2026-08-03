/**
 * The pure decision at the heart of Phase 4c task 2: given whatever
 * `profile-registry.ts`'s `listProfiles` actually reports for a profile
 * directory, what should main show the user? Zero profiles means
 * onboarding; exactly one means open it directly; more than one means a
 * picker; and a **corrupt** registry must never be mistaken for "zero" --
 * see the module doc comment on `profile-registry.ts` for why conflating a
 * missing registry with a corrupt one is the one mistake that actually
 * loses a user's data (a fresh-start screen, on top of years of history
 * that are still sitting on disk, whose next action is "create a new
 * profile").
 *
 * **Why `decideProfileSituation` takes a `ProfileListResult` value instead
 * of a directory path.** `listProfiles` is not pure -- it reads a file --
 * and `local-api.spec.ts`'s existing style (`applyPendingMigrations`,
 * `resolveProfileAiKeyEncryptionSecret`, ...) already prefers isolating the
 * one part of a decision that is genuinely conditional logic from the part
 * that is I/O. Here that split is not just style: it is what lets every
 * one of the four cases -- including "the registry throws" -- be
 * constructed directly as a value and asserted against, with no temp
 * directory, no real file, and no way for a test's own setup to
 * accidentally paper over the corrupt case (e.g. a `try { ... } catch { []
 * }` fallback silently turning a throw into an empty array is exactly the
 * bug this module exists to make impossible to reintroduce unnoticed --
 * see `profile-lifecycle.spec.ts`'s mutation-proof note). `resolveProfileSituation`
 * below is the thin, impure wrapper that actually reads the registry and
 * everything else (`local-api.ts`, `index.ts`) calls that, never
 * `decideProfileSituation` directly with hand-rolled I/O of its own.
 */
import {
  listProfiles,
  PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE,
  type Profile,
} from '@wimm/api/dist/prisma/local/profile-registry'

/**
 * The outcome of asking `profile-registry.ts` for the current profile
 * list: either it succeeded (however many profiles that turned out to be,
 * including zero), or it threw -- a corrupt registry, or a registry written
 * by a newer build, per that module's own contract. Never collapses either
 * failure into the success case.
 */
export type ProfileListResult = { ok: true; profiles: Profile[] } | { ok: false; error: Error }

/**
 * What main should do about the user's profiles, given a `ProfileListResult`.
 * Exactly one of these five is ever produced -- see `decideProfileSituation`.
 *
 * `'registry-from-newer-version'` and `'corrupt-registry'` are deliberately
 * separate cases, not one merged "the registry could not be read" case: a
 * registry written by a newer build of Wimm is NOT corrupt (see
 * `profile-registry.ts`'s `ProfileRegistryWrittenByNewerBuildError`), and
 * telling the user to update the app is very different advice from telling
 * them their profile index is broken and pointing them at a recovery path
 * for a problem they do not have.
 */
export type ProfileSituation =
  | { kind: 'no-profiles' }
  | { kind: 'single-profile'; profile: Profile }
  | { kind: 'multiple-profiles'; profiles: Profile[] }
  | { kind: 'corrupt-registry'; message: string }
  | { kind: 'registry-from-newer-version'; message: string }

/**
 * True when `err` is `profile-registry.ts`'s
 * `ProfileRegistryWrittenByNewerBuildError`, identified structurally by its
 * `code` field -- never `instanceof`, and never a match on `.message`.
 * Mirrors `local-api.ts`'s `isDatabaseMigratedByNewerBuildError` for exactly
 * the same reason: see that function's doc comment, and
 * `PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE`'s doc comment
 * (`profile-registry.ts`) for why `code` is the sound discriminant here.
 */
function isProfileRegistryWrittenByNewerBuildError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE
  )
}

/**
 * The pure decision. See the module doc comment for why this takes a
 * `ProfileListResult` rather than reading the registry itself.
 *
 * `result.ok === false` is checked FIRST, before ever looking at
 * `profiles.length` -- there is no `profiles` to look at in that branch,
 * and the ordering here is exactly what a future edit could get backwards
 * (e.g. "if profiles is empty or the read failed, no-profiles") without
 * this looking wrong at a glance. `profile-lifecycle.spec.ts`'s mutation
 * proof exercises precisely this.
 *
 * Within the failure branch, `isProfileRegistryWrittenByNewerBuildError` is
 * checked BEFORE falling back to the generic `'corrupt-registry'` case --
 * a registry from a newer build must never be reported as corrupt, see
 * `ProfileSituation`'s doc comment.
 */
export function decideProfileSituation(result: ProfileListResult): ProfileSituation {
  if (!result.ok) {
    if (isProfileRegistryWrittenByNewerBuildError(result.error)) {
      return { kind: 'registry-from-newer-version', message: result.error.message }
    }
    return { kind: 'corrupt-registry', message: result.error.message }
  }
  if (result.profiles.length === 0) {
    return { kind: 'no-profiles' }
  }
  if (result.profiles.length === 1) {
    return { kind: 'single-profile', profile: result.profiles[0] }
  }
  return { kind: 'multiple-profiles', profiles: result.profiles }
}

/**
 * Reads `dir`'s registry and reports the outcome as a value, never
 * throwing itself -- the only place `listProfiles`'s throw is caught, so
 * `decideProfileSituation` above never needs to.
 */
function readProfileList(dir: string): ProfileListResult {
  try {
    return { ok: true, profiles: listProfiles(dir) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * The impure entry point every real caller (`local-api.ts`, `index.ts`)
 * uses: reads `dir`'s registry and decides what to do about it. Kept to a
 * single line on purpose -- all of the actual decision logic lives in
 * `decideProfileSituation`, which is what `profile-lifecycle.spec.ts`
 * exercises directly and exhaustively.
 */
export function resolveProfileSituation(dir: string): ProfileSituation {
  return decideProfileSituation(readProfileList(dir))
}

/** Thrown by `validateProfileName` when `rawName` cannot become a profile name. */
export class InvalidProfileNameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidProfileNameError'
  }
}

/**
 * Arbitrary but generous -- long enough for "Alex's Household Budget 2026",
 * short enough that the picker screen never has to truncate onto a second
 * line for a name typed by a real person.
 */
export const PROFILE_NAME_MAX_LENGTH = 60

/**
 * Validates and normalizes a user-supplied profile name, returning the
 * normalized form (trimmed, internal whitespace collapsed to single
 * spaces) or throwing `InvalidProfileNameError`.
 *
 * **This name is never used to build a filesystem path.**
 * `profile-registry.ts`'s `createProfile` derives `databaseFileName` from the
 * caller-supplied `id` (a `randomUUID()`, generated in `local-api.ts`, never
 * from `name`) -- see that module's doc comment. Because of that separation,
 * this function does not need to reject or sanitize path-traversal
 * characters, null bytes as path separators, reserved filesystem names, or
 * anything else path-shaped: a name of `"../../etc/passwd"` is exactly as
 * safe here as `"Alex"`, because it can never become a path segment. What
 * this function actually guards against is the name being unusable as *user
 * -facing text* in the picker: empty (nothing to show), absurdly long (breaks
 * the picker's layout), or carrying control characters (a pasted newline or
 * tab would break the picker's one-name-per-row rendering). Any script or
 * emoji a real person's name might contain is accepted -- this is a label,
 * not an identifier.
 */
export function validateProfileName(rawName: string): string {
  const trimmed = rawName.trim()

  if (trimmed.length === 0) {
    throw new InvalidProfileNameError('Profile name cannot be empty.')
  }

  // Checked BEFORE collapsing whitespace below, and deliberately rejected
  // rather than silently normalized: a tab or newline pasted into the
  // field is not "whitespace to collapse" the way repeated spaces are --
  // treating it as such would let it become an ordinary space with no
  // feedback to the user that anything happened to their input.
  // eslint-disable-next-line no-control-regex -- deliberately matching C0 controls + DEL, see doc comment above.
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new InvalidProfileNameError('Profile name cannot contain control characters.')
  }

  const name = trimmed.replace(/ +/g, ' ')

  if (name.length > PROFILE_NAME_MAX_LENGTH) {
    throw new InvalidProfileNameError(
      `Profile name cannot be longer than ${PROFILE_NAME_MAX_LENGTH} characters.`,
    )
  }

  return name
}
