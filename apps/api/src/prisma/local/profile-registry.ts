/**
 * The profile registry: maps a user's local profiles to their SQLite
 * database files.
 *
 * WIMM is becoming a standalone desktop app with no accounts and no server.
 * A "profile" is one person's entire financial history, living in one
 * SQLite file. `profiles.json`, at `<dir>/profiles.json`, is the only index
 * that says which file belongs to whom. If it is lost or truncated, the
 * databases still exist on disk, but nothing knows they exist -- the user
 * sees an empty app, and years of data are technically present and
 * practically gone. That is the failure this module exists to prevent.
 *
 * Three design decisions follow directly from that:
 *
 * - Writing the registry is atomic. The full new contents are written to a
 *   temp file in the same directory as `profiles.json` and then
 *   `renameSync`d over it -- the same temp-then-rename pattern
 *   `snapshot.ts` established in Phase 2 for exactly this reason. A rename
 *   on the same filesystem cannot leave the target half-old, half-new, even
 *   if the process is killed or the disk fills up mid-write.
 *
 * - A missing registry and a corrupt one are deliberately NOT treated the
 *   same. A missing file means "no profiles yet" and returns `[]`, which is
 *   what sends a first-run user to onboarding. A corrupt file means "your
 *   profiles exist, but I cannot read the index that finds them" and
 *   throws, naming the file. Conflating the two is the catastrophic case:
 *   someone with years of data would see a fresh-install welcome screen,
 *   and the next thing the app would do is offer to create a new profile
 *   on top of an index it could have repaired or at least warned about.
 *
 * - The registry carries a schema version, and reading it migrates forward.
 *   Phase 3 made this module tolerate *unknown* fields on an entry and
 *   preserve them across writes (see `StoredProfile`), so a newer build
 *   adding a field never breaks an older one. It did NOT survive a
 *   *renamed or dropped required* field: an older build reading such a
 *   registry rejected the whole file as corrupt, and every profile in it
 *   became unreachable -- the same catastrophic failure the missing-vs-
 *   corrupt distinction above exists to prevent, just triggered by a
 *   version difference instead of a truncated file. `readRegistry` now
 *   resolves a `version` from the file (defaulting to 1 when the field is
 *   absent -- every registry written before this task has no such field,
 *   and must keep working untouched), migrates forward one version at a
 *   time up to `CURRENT_REGISTRY_VERSION`, and -- if anything was migrated
 *   -- rewrites the result atomically through the exact same `writeRegistry`
 *   path described above, so the upgrade only ever happens once per file.
 *   A version newer than `CURRENT_REGISTRY_VERSION` is NOT corruption -- the
 *   file is perfectly well-formed, just written by a build ahead of this
 *   one -- and throws a distinguishable `ProfileRegistryWrittenByNewerBuildError`
 *   instead, mirroring `migration-runner.ts`'s `DatabaseMigratedByNewerBuildError`
 *   for the exact same reason: telling a user to "update the app" is very
 *   different advice from telling them their index is corrupt, and a caller
 *   must be able to tell the two apart by a stable `code`, never by parsing
 *   a message.
 *
 * `id` and `now` are always supplied by the caller, never generated inside
 * this module -- the same determinism reason `snapshot.ts` takes `now` as
 * an argument. That is what keeps these functions pure and trivially
 * testable: no internal `crypto.randomUUID()` or `new Date()` call ever
 * makes an assertion order-dependent or non-reproducible.
 */
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface Profile {
  id: string
  name: string
  databaseFileName: string
  createdAt: string
  lastOpenedAt: string | null
}

/**
 * A profile entry exactly as it comes off disk, already migrated forward to
 * `CURRENT_REGISTRY_VERSION`.
 *
 * WIMM auto-updates. A newer build of the app may add a field to profile
 * entries; an older build then has to read (and possibly rewrite) a
 * registry it does not fully understand. `StoredProfile` names that
 * reality: it is a `Profile` -- the fields *this* version requires,
 * correctly typed -- plus whatever else happens to be on the object.
 *
 * This type exists so `readRegistry` and `touchProfile` never reconstruct
 * an entry field-by-field from a `Profile`-shaped object literal. Doing
 * that would keep only the fields this version recognizes and quietly
 * drop the rest; the next write would persist that loss, and a later
 * upgrade would find the dropped fields permanently gone. Both functions
 * instead only ever spread or pass through existing entries, so a field
 * this version has never heard of survives every read/write cycle
 * unchanged.
 */
type StoredProfile = Profile & Record<string, unknown>

/**
 * A profile entry exactly as version 1 of the registry stored it -- before
 * the version 2 rename of `dbFileName` to `databaseFileName` (see
 * `migrateProfileV1ToV2`). Used only internally, to validate and migrate a
 * version 1 entry forward before any caller ever sees it. Real callers only
 * ever observe `StoredProfile` (the current shape).
 */
type StoredProfileV1 = {
  id: string
  name: string
  dbFileName: string
  createdAt: string
  lastOpenedAt: string | null
} & Record<string, unknown>

/** Name of the registry file, relative to the profiles directory. */
const REGISTRY_FILE_NAME = 'profiles.json'

/** Subdirectory (relative to the profiles directory) that holds the actual `.db` files. */
const DATABASES_SUBDIR = 'profiles'

/**
 * Registry schema version this build fully understands, and the version it
 * always writes.
 *
 * Bumped exactly once so far: version 2 renamed every entry's `dbFileName`
 * to `databaseFileName` (see `migrateProfileV1ToV2`) -- a naming cleanup
 * chosen deliberately as the vehicle to prove this versioning mechanism
 * carries real data across a real rename, rather than shipping a version
 * number with no migration behind it.
 *
 * Exported so tests (and any future migration) can express "a version newer
 * than this build understands" as `CURRENT_REGISTRY_VERSION + 1` instead of
 * a hardcoded literal that could someday coincidentally collide with a real
 * future version.
 */
export const CURRENT_REGISTRY_VERSION = 2

/**
 * Stable discriminant on `ProfileRegistryWrittenByNewerBuildError.code`,
 * mirroring `migration-runner.ts`'s `DATABASE_MIGRATED_BY_NEWER_BUILD_CODE`
 * for exactly the same reason: a caller (Electron `main`, in `apps/desktop`)
 * needs to identify this specific failure -- "this registry is ahead of what
 * this build understands" -- to show the user something actionable ("update
 * Wimm") instead of the generic "your profile index is corrupt" message,
 * which sends them down a recovery path for a problem they do not have.
 *
 * Matching on `code` rather than `instanceof` is preferred for the same
 * reasons `DATABASE_MIGRATED_BY_NEWER_BUILD_CODE`'s own doc comment gives:
 * it survives a second, differently-resolved copy of this module across a
 * bundling boundary, and it survives serialization (IPC, `JSON.stringify`)
 * that a class identity does not.
 */
export const PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE = 'PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD' as const

/**
 * Thrown when `profiles.json` declares a schema `version` greater than
 * `CURRENT_REGISTRY_VERSION` -- i.e. a newer build of the app already wrote
 * this registry, and an older build (this one) was pointed at it afterwards.
 * This is deliberately NOT the same failure as a corrupt registry: the file
 * is well-formed JSON in a shape this build simply does not (yet) know how
 * to read forward. See `PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE`'s doc
 * comment for why callers should match on `code` rather than `instanceof`
 * alone, and `migration-runner.ts`'s `DatabaseMigratedByNewerBuildError` for
 * the precedent this mirrors.
 */
export class ProfileRegistryWrittenByNewerBuildError extends Error {
  readonly code = PROFILE_REGISTRY_WRITTEN_BY_NEWER_BUILD_CODE

  constructor(message: string) {
    super(message)
    this.name = 'ProfileRegistryWrittenByNewerBuildError'
  }
}

function registryPath(dir: string): string {
  return join(dir, REGISTRY_FILE_NAME)
}

/**
 * Checks that `entry` carries every field this version of `Profile`
 * requires, correctly typed. It deliberately does NOT check that `entry`
 * has *only* those fields: an entry from a newer build of the app may
 * carry additional fields this version has never heard of, and that is
 * not corruption -- see `StoredProfile`. Rejecting an entry for carrying
 * extra fields would treat a version difference as a broken registry and
 * lock the user out of every profile in it.
 *
 * Genuine corruption -- a required field missing or the wrong type -- is
 * still rejected. Tolerating unknown *extra* fields is not the same as
 * tolerating *missing* ones.
 */
function isValidProfileShape(entry: unknown): entry is StoredProfile {
  if (typeof entry !== 'object' || entry === null) return false
  const candidate = entry as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.databaseFileName === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.lastOpenedAt === null || typeof candidate.lastOpenedAt === 'string')
  )
}

/**
 * Version 1 counterpart to `isValidProfileShape`: the same required fields,
 * but checking for the pre-rename `dbFileName` key instead of
 * `databaseFileName`. Used only to validate a version 1 entry BEFORE
 * `migrateProfileV1ToV2` runs on it -- genuine corruption in a version 1
 * entry (a missing or mistyped field) must be caught at the shape it
 * actually claims to be, not after the rename has already papered over
 * what was missing.
 */
function isValidProfileShapeV1(entry: unknown): entry is StoredProfileV1 {
  if (typeof entry !== 'object' || entry === null) return false
  const candidate = entry as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.dbFileName === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.lastOpenedAt === null || typeof candidate.lastOpenedAt === 'string')
  )
}

/**
 * Migrates one version 1 entry to version 2: renames `dbFileName` to
 * `databaseFileName`, and passes every other field through completely
 * unchanged -- including fields this version has never heard of (see
 * `StoredProfile`'s doc comment). Destructuring `dbFileName` out and
 * spreading the rest is what keeps a field from a build even newer than
 * this one riding through a version 1 -> version 2 migration exactly as it
 * already does through `touchProfile`/`createProfile`'s own
 * spread-not-rebuild pattern.
 */
function migrateProfileV1ToV2(entry: StoredProfileV1): StoredProfile {
  const { dbFileName, ...rest } = entry
  return { ...rest, databaseFileName: dbFileName } as StoredProfile
}

/** The result of parsing the raw JSON off disk into a schema version and an as-yet-unvalidated list of entries. */
interface ParsedRegistryEnvelope {
  version: number
  profiles: unknown[]
}

/**
 * Resolves `parsed` (the raw result of `JSON.parse`) into a schema version
 * and its list of entries, tolerating every shape this file has ever been
 * written in:
 *
 * - A bare JSON array -- how every registry before this task looked, and
 *   how any hand-edited or externally-written registry might still look.
 *   An array has no field a version number could live on, so this shape
 *   IS version 1, unconditionally -- see the module doc comment for why a
 *   missing version must default to 1 rather than require a rewrite just
 *   to be read.
 * - `{ version, profiles }` -- what `writeRegistry` writes from this task
 *   onward. `version` missing, or not a number, defaults to 1 for the same
 *   reason: a hand-edited or partially-written envelope without the field
 *   is exactly as "no version yet" as the bare-array shape above.
 *
 * Anything else -- not an array, and not an object carrying a `profiles`
 * array -- is corruption and throws, naming `file`.
 */
function parseRegistryEnvelope(parsed: unknown, file: string): ParsedRegistryEnvelope {
  if (Array.isArray(parsed)) {
    return { version: 1, profiles: parsed }
  }

  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>)['profiles'])) {
    const candidate = parsed as Record<string, unknown>
    const version = typeof candidate['version'] === 'number' ? (candidate['version'] as number) : 1
    return { version, profiles: candidate['profiles'] as unknown[] }
  }

  throw new Error(
    `Corrupt profile registry at ${file}: expected a JSON array or an object with a "profiles" array, got ${typeof parsed}`,
  )
}

/**
 * Reads and parses the registry at `<dir>/profiles.json`.
 *
 * Returns `[]` if the file does not exist yet -- see the module doc comment
 * for why that is "no profiles" and not an error. Throws, naming the file
 * and the offending entry's index, for every other way the registry can
 * fail to be read: it is not valid JSON, it does not parse to a recognized
 * shape, its `version` field is not a positive integer, or an entry in it is
 * missing a field its resolved version genuinely requires. All of those are
 * corruption, and must never be silently downgraded to "no profiles" --
 * and never silently downgraded to "drop just that entry" either: a profile
 * vanishing from the list is the same invisible data loss in a different
 * costume.
 *
 * A `version` GREATER than `CURRENT_REGISTRY_VERSION` is deliberately NOT
 * corruption -- see `ProfileRegistryWrittenByNewerBuildError`'s doc comment
 * -- and is checked, and thrown, before any entry is ever validated: an
 * entry shaped for a version this build has never heard of would otherwise
 * look exactly like a missing-field corruption, which is the wrong message
 * to show the user.
 *
 * A `version` LOWER than `CURRENT_REGISTRY_VERSION` (including the implicit
 * version 1 of a registry with no version field at all) is migrated forward
 * one version at a time, and -- if anything was actually migrated -- the
 * result is rewritten atomically via `writeRegistry` before returning, so
 * every subsequent read sees the current shape directly and never repeats
 * the migration.
 *
 * An entry carrying *extra* fields this version does not recognize is not
 * corruption -- see `StoredProfile` and `isValidProfileShape`. Entries are
 * returned exactly as parsed (or migrated), never reconstructed
 * field-by-field, so any such extra fields ride along unchanged for
 * `touchProfile` and `createProfile` to write back out.
 */
function readRegistry(dir: string): StoredProfile[] {
  const file = registryPath(dir)

  if (!existsSync(file)) return []

  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`Cannot read profile registry at ${file}: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Corrupt profile registry at ${file}: not valid JSON (${(err as Error).message})`)
  }

  const envelope = parseRegistryEnvelope(parsed, file)

  if (!Number.isInteger(envelope.version) || envelope.version < 1) {
    throw new Error(`Corrupt profile registry at ${file}: invalid "version" field ${JSON.stringify(envelope.version)}`)
  }

  // Checked, and thrown, BEFORE any entry is validated against this
  // version's expected shape: a registry written by a newer build may
  // contain entries this version has never seen the shape of at all, and
  // that must never be reported as "an entry is missing a required field".
  if (envelope.version > CURRENT_REGISTRY_VERSION) {
    throw new ProfileRegistryWrittenByNewerBuildError(
      `${file} was written by a newer version of Wimm: it declares registry schema version ${envelope.version}, ` +
        `but this build only understands up to version ${CURRENT_REGISTRY_VERSION}. This is not corruption -- ` +
        'the file is well-formed, just ahead of what this build can read. Update Wimm to a version that supports ' +
        'this registry to see these profiles again. Refusing to continue.',
    )
  }

  let entries: unknown[] = envelope.profiles

  // A straight-line chain, not a generic loop: there is exactly one
  // migration step today (version 1 -> version 2). The next version bump
  // adds another `if (version === 2) { ... }` block in this same shape
  // immediately below, not a rewrite of this one -- see the module doc
  // comment.
  if (envelope.version === 1) {
    entries.forEach((entry, index) => {
      if (!isValidProfileShapeV1(entry)) {
        throw new Error(`Corrupt profile registry at ${file}: entry at index ${index} is not a valid profile`)
      }
    })
    entries = (entries as StoredProfileV1[]).map(migrateProfileV1ToV2)
  }

  // `entries` is now shaped for CURRENT_REGISTRY_VERSION, whether it arrived
  // that way or was just migrated to it above -- validate that final shape
  // either way, so a bug in a migration step that produces an incomplete
  // entry is caught here rather than handed to a caller.
  entries.forEach((entry, index) => {
    if (!isValidProfileShape(entry)) {
      throw new Error(`Corrupt profile registry at ${file}: entry at index ${index} is not a valid profile`)
    }
  })

  const result = entries as StoredProfile[]

  if (envelope.version < CURRENT_REGISTRY_VERSION) {
    // Migrated forward from an older on-disk version -- rewrite atomically
    // now, through the exact same temp-then-rename path as any other write
    // (see `writeRegistry`), so every subsequent read -- by this process or
    // any other tool that inspects `profiles.json` directly -- sees the
    // current shape and this migration never has to run again for this file.
    writeRegistry(dir, result)
  }

  return result
}

/**
 * Writes `profiles` to `<dir>/profiles.json` atomically, wrapped in the
 * versioned envelope `{ version: CURRENT_REGISTRY_VERSION, profiles }`.
 *
 * The full new contents are written to a temp file in `dir` first, then
 * `renameSync`d over the registry -- mirroring `restoreSnapshot`'s
 * temp-then-rename replacement in `snapshot.ts`. A same-filesystem rename
 * cannot leave `profiles.json` half-written: it is either the previous
 * contents or the new ones, never a truncated mix of both. If writing the
 * temp file or the rename fails, the temp file is removed and the error is
 * rethrown; `profiles.json` itself is never touched until the rename, so a
 * failure at any point before it leaves the existing registry exactly as
 * it was.
 *
 * Takes whatever entries it is given and serializes them as-is. It never
 * reconstructs an entry from a `Profile`-shaped literal, so a caller that
 * passes through a `StoredProfile` carrying fields this version does not
 * recognize writes those fields back out unchanged. Every write always
 * declares the CURRENT version -- there is no code path that writes an
 * older version's envelope, including the migrate-on-read path in
 * `readRegistry`, which passes already-migrated entries here.
 *
 * **There is deliberately no file lock, and that was checked rather than
 * assumed.** Every writer of this file lives in the Electron main process --
 * `apps/desktop/src/main/local-api.ts` holds all three call sites
 * (`createProfile` once, `touchProfile` twice); the embedded API never
 * writes it. Electron enforces a single instance, so only one WIMM process
 * runs at a time, and within that process JavaScript is single-threaded and
 * these writes are synchronous, so two of them cannot interleave. A crash
 * partway through is already covered by the rename above. That leaves only a
 * human editing the file by hand in another program, which a lock would not
 * prevent either. Adding one would guard nothing.
 */
function writeRegistry(dir: string, profiles: readonly Profile[]): void {
  mkdirSync(dir, { recursive: true })

  const file = registryPath(dir)
  const tempPath = join(dir, `.${REGISTRY_FILE_NAME}.${randomBytes(8).toString('hex')}.tmp`)
  const envelope = { version: CURRENT_REGISTRY_VERSION, profiles }

  try {
    writeFileSync(tempPath, JSON.stringify(envelope, null, 2))
    renameSync(tempPath, file)
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }
}

/**
 * Lists every profile registered in `<dir>/profiles.json`.
 *
 * Returns `[]` if the registry does not exist yet (first run -- send the
 * user to onboarding). Throws, naming the file, if the registry exists but
 * is corrupt. Throws `ProfileRegistryWrittenByNewerBuildError`, distinguishable
 * from corruption by its `code`, if the registry was written by a build
 * newer than this one. See the module doc comment for why conflating any of
 * these outcomes is a mistake this function must never make. An entry
 * carrying fields this version does not recognize is not corruption --
 * see `StoredProfile` -- so it is included, extra fields and all.
 */
export function listProfiles(dir: string): Profile[] {
  return readRegistry(dir)
}

/**
 * Registers a new profile named `name` under caller-supplied `id`, persists
 * it to the registry atomically, and returns the created `Profile`.
 *
 * `id` becomes the profile's `id` -- and it is also the exact `databaseId`
 * that Phase 2's snapshot API (`snapshotDatabase` / `listSnapshots` /
 * `restoreSnapshot` in `snapshot.ts`) must be given for this profile's
 * backups. That coupling is deliberate: every profile's database file is
 * named identically (`profiles/<id>.db`), so only the caller-supplied id
 * (not the shared basename) can keep one profile's backups from being
 * listed or pruned alongside another's in one shared backup directory.
 *
 * Throws, without writing anything, if `id` already identifies a profile in
 * the registry -- silently overwriting that entry would repoint an
 * existing profile's index at a different identity, which is exactly the
 * kind of quiet data loss this whole module exists to prevent.
 *
 * Every existing profile is passed through to `writeRegistry` exactly as
 * `readRegistry` returned it (already migrated to the current version), so
 * any fields an existing entry carries that this version does not recognize
 * are written back unchanged -- only the new profile is appended.
 */
export function createProfile(dir: string, name: string, id: string, now: Date): Profile {
  const profiles = readRegistry(dir)

  if (profiles.some((profile) => profile.id === id)) {
    throw new Error(`Cannot create profile: id "${id}" already exists in the registry at ${registryPath(dir)}`)
  }

  const profile: Profile = {
    id,
    name,
    databaseFileName: `${id}.db`,
    createdAt: now.toISOString(),
    lastOpenedAt: null,
  }

  writeRegistry(dir, [...profiles, profile])

  return profile
}

/**
 * Updates `id`'s `lastOpenedAt` to `now` and persists the registry
 * atomically. Every other profile in the registry is left untouched.
 *
 * Throws if `id` does not identify a profile in the registry -- there is no
 * profile to mark as opened.
 *
 * The matching entry is updated by spreading it, not by rebuilding a fresh
 * `Profile` literal -- so a field this version does not recognize survives
 * on the very entry being touched, not just on the others. Every other
 * entry is passed through unchanged for the same reason `createProfile`
 * does: `writeRegistry` never reconstructs an entry it wasn't asked to
 * change.
 */
export function touchProfile(dir: string, id: string, now: Date): void {
  const profiles = readRegistry(dir)

  const index = profiles.findIndex((profile) => profile.id === id)
  if (index === -1) {
    throw new Error(`Cannot touch profile: id "${id}" not found in the registry at ${registryPath(dir)}`)
  }

  const updated = [...profiles]
  updated[index] = { ...updated[index], lastOpenedAt: now.toISOString() }

  writeRegistry(dir, updated)
}

/**
 * Returns the path of `profile`'s SQLite database file, at
 * `<dir>/profiles/<databaseFileName>`.
 *
 * Pure path computation only: this does not create the `profiles`
 * directory or the database file itself. That is the concern of whatever
 * actually opens the database (see `open-local-database.ts`).
 */
export function profileDatabasePath(dir: string, profile: Profile): string {
  return join(dir, DATABASES_SUBDIR, profile.databaseFileName)
}
