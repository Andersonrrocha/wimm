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
 * Two design decisions follow directly from that:
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
  dbFileName: string
  createdAt: string
  lastOpenedAt: string | null
}

/** Name of the registry file, relative to the profiles directory. */
const REGISTRY_FILE_NAME = 'profiles.json'

/** Subdirectory (relative to the profiles directory) that holds the actual `.db` files. */
const DATABASES_SUBDIR = 'profiles'

function registryPath(dir: string): string {
  return join(dir, REGISTRY_FILE_NAME)
}

function isValidProfileShape(entry: unknown): entry is Profile {
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
 * Reads and parses the registry at `<dir>/profiles.json`.
 *
 * Returns `[]` if the file does not exist yet -- see the module doc
 * comment for why that is "no profiles" and not an error. Throws, naming
 * the file, for every other way the registry can fail to be read: it is
 * not valid JSON, it does not parse to an array, or an entry in it does
 * not have the shape of a `Profile`. All of those are corruption, and must
 * never be silently downgraded to "no profiles".
 */
function readRegistry(dir: string): Profile[] {
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

  if (!Array.isArray(parsed)) {
    throw new Error(`Corrupt profile registry at ${file}: expected a JSON array, got ${typeof parsed}`)
  }

  parsed.forEach((entry, index) => {
    if (!isValidProfileShape(entry)) {
      throw new Error(`Corrupt profile registry at ${file}: entry at index ${index} is not a valid profile`)
    }
  })

  return parsed as Profile[]
}

/**
 * Writes `profiles` to `<dir>/profiles.json` atomically.
 *
 * The full contents are written to a temp file in `dir` first, then
 * `renameSync`d over the registry -- mirroring `restoreSnapshot`'s
 * temp-then-rename replacement in `snapshot.ts`. A same-filesystem rename
 * cannot leave `profiles.json` half-written: it is either the previous
 * contents or the new ones, never a truncated mix of both. If writing the
 * temp file or the rename fails, the temp file is removed and the error is
 * rethrown; `profiles.json` itself is never touched until the rename, so a
 * failure at any point before it leaves the existing registry exactly as
 * it was.
 */
function writeRegistry(dir: string, profiles: Profile[]): void {
  mkdirSync(dir, { recursive: true })

  const file = registryPath(dir)
  const tempPath = join(dir, `.${REGISTRY_FILE_NAME}.${randomBytes(8).toString('hex')}.tmp`)

  try {
    writeFileSync(tempPath, JSON.stringify(profiles, null, 2))
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
 * is corrupt. See the module doc comment for why conflating these two
 * outcomes is the one mistake this function must never make.
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
 */
export function createProfile(dir: string, name: string, id: string, now: Date): Profile {
  const profiles = readRegistry(dir)

  if (profiles.some((profile) => profile.id === id)) {
    throw new Error(`Cannot create profile: id "${id}" already exists in the registry at ${registryPath(dir)}`)
  }

  const profile: Profile = {
    id,
    name,
    dbFileName: `${id}.db`,
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
 * `<dir>/profiles/<dbFileName>`.
 *
 * Pure path computation only: this does not create the `profiles`
 * directory or the database file itself. That is the concern of whatever
 * actually opens the database (see `open-local-database.ts`).
 */
export function profileDatabasePath(dir: string, profile: Profile): string {
  return join(dir, DATABASES_SUBDIR, profile.dbFileName)
}
