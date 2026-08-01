/**
 * Per-profile secret for `AiKeyCrypto` (`ai/ai-key-crypto.ts`), which
 * encrypts the user's BYOK provider API key at rest in the profile's SQLite
 * file.
 *
 * **Why this cannot live inside the database file, or anywhere Task 4's
 * export copies from.** Task 4 (see the phase 4c plan) adds an export
 * action that copies a profile's `.db` file to wherever the user chooses --
 * a support ticket attachment, a synced folder, an email. A secret stored
 * *inside* that file, or in any other file export also copies, would travel
 * with the ciphertext it protects: whoever receives the export could
 * decrypt the BYOK key with the same file that contains it. That defeats
 * the entire point of moving off the old compiled-in constant -- it would
 * only have replaced "one secret shared by every installation" with "one
 * secret shared by every *recipient* of this file", which is not a security
 * boundary at all.
 *
 * So this secret lives in a sibling file, `<profileDir>/secrets/<id>.key`,
 * deliberately *outside* `<profileDir>/profiles/`, the one subdirectory
 * Task 4's export reads from (see `profile-registry.ts`'s
 * `profileDatabasePath`, which resolves strictly inside `profiles/`).
 * Exporting `profiles/<id>.db` alone -- which is what Task 4 does -- can
 * never carry `secrets/<id>.key` along with it. The direct consequence: a
 * profile exported to another machine (or handed to anyone) has a BYOK key
 * that is unreadable there. `AiKeyResolverService.resolveForUser` already
 * treats a decrypt failure as "no key" (see its catch block), so that
 * profile just opens with AI off instead of crashing -- the user re-enters
 * their key. That degradation is the intended, accepted trade-off, not an
 * oversight; Task 4's UI needs to say so.
 *
 * The file name is derived from the caller-supplied `profileId`, never from
 * the profile's user-chosen `name` -- the same rule `profileDatabasePath`
 * follows for `.db` files, for the same reason: a name is untrusted input
 * and must never influence a filesystem path.
 *
 * **Missing vs corrupt, exactly like `profile-registry.ts`.** A missing
 * secret file means "this profile has never had a per-profile secret
 * (either brand new, or written before this feature existed)" -- handled by
 * generating one and, if needed, migrating (see `migrateAiKeyEncryptionSecret`
 * and `resolveProfileAiKeyEncryptionSecret` below). A secret file that
 * *exists* but fails `assertUsableAiKeyEncryptionSecret` (empty,
 * whitespace-only, unreadable as a string) is corruption and must never be
 * silently treated as "doesn't exist yet": regenerating in that case would
 * re-run the legacy-secret migration against a database that may already be
 * encrypted under a secret this function no longer has, permanently losing
 * any BYOK key encrypted under it. Refuse loudly instead -- the same
 * set-verify-refuse contract `open-local-database.ts` uses.
 */
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { decryptWithAiKey, deriveAiKeyEncryptionKey, encryptWithAiKey } from '../../ai/ai-key-crypto'
import { openLocalDatabase } from './open-local-database'

/**
 * **Legacy-migration-only. Do not use this for anything else.**
 *
 * This is the fixed, compiled-in secret every build shared before this
 * module existed (`LOCAL_AI_KEY_ENCRYPTION_SECRET`, formerly in
 * `app.local.module.ts`). A profile written before this migration existed
 * has its BYOK key encrypted under exactly this value. It is kept here,
 * and only here, purely so `migrateAiKeyEncryptionSecret` can decrypt that
 * value once in order to re-encrypt it under the profile's own new secret.
 *
 * Never read as a live encryption secret anywhere else in the app: nothing
 * outside this file's migration path should import it, and
 * `AppLocalModule.forRoot` no longer accepts it as a fallback -- see that
 * file's `AppLocalModuleOptions.aiKeyEncryptionSecret`, which is mandatory
 * and always per-profile. Do not remove this constant until every profile
 * that could still be carrying data encrypted under it has had a chance to
 * be opened (and therefore migrated) by a build that includes this
 * migration -- that is a product/release decision, not something this file
 * can determine on its own.
 */
export const LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET =
  'wimm-local-build-fixed-ai-key-encryption-secret-v1'

/** Bytes of entropy `generateAiKeyEncryptionSecret` draws from `node:crypto`'s CSPRNG -- 32 bytes (256 bits), the task's stated floor. Hex-encoded, mirroring `generateSessionToken` (`profile/session-token.ts`). */
const SECRET_BYTES = 32

/** Subdirectory (relative to the profiles directory) that holds each profile's AI key encryption secret. Deliberately a sibling of, not nested inside, `profiles/` -- see the module doc comment. */
const SECRETS_SUBDIR = 'secrets'

/**
 * Generates a fresh, cryptographically random AI key encryption secret for
 * one profile: 32 random bytes (256 bits) from `node:crypto`'s CSPRNG,
 * hex-encoded. Never derived from anything about the profile itself (its
 * id, its name, its creation time) -- an attacker who already knows all of
 * that must learn nothing about the secret from it.
 */
export function generateAiKeyEncryptionSecret(): string {
  return randomBytes(SECRET_BYTES).toString('hex')
}

/**
 * Throws unless `secret` is usable as a profile's AI key encryption secret:
 * a string that is not empty and not entirely whitespace.
 *
 * **Follows `assertUsableSessionToken`'s precedent exactly** (see
 * `profile/session-token.ts` for the full reasoning, which applies here
 * unchanged): no minimum length, because length alone cannot distinguish a
 * strong secret from a weak one and this function can only meaningfully
 * reject "obviously not a secret", not judge how good a supplied string is;
 * no silent trimming, because a value that *needed* trimming to be
 * meaningful is a caller bug this function must not paper over; and the
 * received value is never included in the thrown message, only its type or
 * the fact that it was empty/whitespace. Real strength is
 * `generateAiKeyEncryptionSecret`'s job (32 random bytes), not this
 * function's -- `AiKeyCrypto`'s own constructor additionally floors any
 * secret it receives at 16 characters, which is defense-in-depth this
 * function does not need to duplicate.
 *
 * Takes `unknown`, not `string`, for the same reason
 * `assertUsableSessionToken` does: `AppLocalModuleOptions.aiKeyEncryptionSecret`
 * is typed `string`, but nothing at runtime enforces that against a caller
 * that ignores or casts around the type checker.
 */
export function assertUsableAiKeyEncryptionSecret(secret: unknown): asserts secret is string {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    const description =
      typeof secret !== 'string'
        ? `a ${secret === null ? 'null' : typeof secret} value`
        : 'an empty or whitespace-only string'

    throw new Error(
      'AppLocalModule.forRoot: refusing to compose the local API without a usable AI key encryption secret -- ' +
        `aiKeyEncryptionSecret must be a non-empty, non-whitespace string, but received ${description}. ` +
        'Resolve one per profile with resolveProfileAiKeyEncryptionSecret() (prisma/local/profile-secret.ts) ' +
        'and pass it through -- never hardcode it or share it across profiles.',
    )
  }
}

/** Path of `profileId`'s AI key encryption secret file, at `<profileDir>/secrets/<profileId>.key`. Pure path computation, like `profileDatabasePath` -- does not create the directory or the file. */
export function profileSecretFilePath(profileDir: string, profileId: string): string {
  return join(profileDir, SECRETS_SUBDIR, `${profileId}.key`)
}

/**
 * Writes `secret` to `path` atomically: the full value is written to a temp
 * file in the same directory and then `renameSync`d over `path` --
 * mirroring `profile-registry.ts`'s `writeRegistry` and `snapshot.ts`'s
 * restore, so a crash or a full disk mid-write can never leave a truncated
 * secret behind for a later read to trust. Readable only by the owning user
 * (`mode: 0o600`) on platforms that honor POSIX file modes; Windows ACLs
 * are inherited from the containing directory instead, which is Electron's
 * own `userData` directory (already user-scoped by the OS).
 */
function writeSecretFileAtomic(path: string, secret: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${randomBytes(8).toString('hex')}.tmp`

  try {
    writeFileSync(tempPath, secret, { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, path)
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }
}

/** Row shape read from `"User"` for migration -- only the two columns this needs. */
interface EncryptedUserRow {
  id: string
  aiApiKeyEncrypted: string
}

export interface MigrateAiKeyEncryptionSecretResult {
  /** User ids whose `aiApiKeyEncrypted` was successfully decrypted under `oldSecret` and re-encrypted under `newSecret`. */
  migratedUserIds: string[]
  /**
   * User ids with a non-null `aiApiKeyEncrypted` that could NOT be
   * decrypted under `oldSecret`, left byte-for-byte untouched. This is not
   * expected on the normal migration path (a profile written before this
   * feature existed always has its key under `LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET`)
   * -- it only happens if a previous migration attempt for this exact
   * profile committed this re-encryption and then crashed before its new
   * secret could be persisted to `secrets/<id>.key` (see
   * `resolveProfileAiKeyEncryptionSecret`'s doc comment for that narrow
   * window), or if the stored value is genuinely corrupt. Either way,
   * guessing would risk destroying the only remaining copy of the key, so
   * this function leaves it exactly as found and reports it here instead
   * of throwing or silently discarding it -- the caller decides whether and
   * how to surface it. `AiKeyResolverService` already treats a decrypt
   * failure at request time as "no key", so the affected profile still
   * opens; it degrades to AI-off for that one user until they re-paste
   * their key.
   */
  leftUntouchedUserIds: string[]
}

/**
 * Re-encrypts every non-null `"User"."aiApiKeyEncrypted"` value in `file`
 * from `oldSecret` to `newSecret`, in a single SQLite transaction (all rows
 * migrate together, or none do -- see `migration-runner.ts` for the same
 * all-or-nothing reasoning applied to schema migrations).
 *
 * A profile with no BYOK key set (the common case: `aiCategorizationMode`
 * defaults to `OFF`, and a freshly created profile's single seeded `User`
 * row never has `aiApiKeyEncrypted` set) is a no-op: the `SELECT` finds
 * nothing, the transaction commits empty, and both result arrays are `[]`.
 *
 * Opens its own connection via `openLocalDatabase` (never `LocalPrismaService`
 * or Nest DI) -- this runs before `AppLocalModule` composes, the same reason
 * `migration-runner.ts` uses a raw connection for schema migrations.
 */
export function migrateAiKeyEncryptionSecret(
  file: string,
  oldSecret: string,
  newSecret: string,
): MigrateAiKeyEncryptionSecretResult {
  const oldKey = deriveAiKeyEncryptionKey(oldSecret)
  const newKey = deriveAiKeyEncryptionKey(newSecret)

  const db = openLocalDatabase(file)
  try {
    const rows = db
      .prepare('SELECT "id" AS id, "aiApiKeyEncrypted" AS aiApiKeyEncrypted FROM "User" WHERE "aiApiKeyEncrypted" IS NOT NULL')
      .all() as EncryptedUserRow[]

    const migratedUserIds: string[] = []
    const leftUntouchedUserIds: string[] = []

    if (rows.length > 0) {
      const update = db.prepare('UPDATE "User" SET "aiApiKeyEncrypted" = ? WHERE "id" = ?')

      const runMigration = db.transaction(() => {
        for (const row of rows) {
          let plaintext: string
          try {
            plaintext = decryptWithAiKey(oldKey, row.aiApiKeyEncrypted)
          } catch {
            leftUntouchedUserIds.push(row.id)
            continue
          }
          update.run(encryptWithAiKey(newKey, plaintext), row.id)
          migratedUserIds.push(row.id)
        }
      })
      runMigration()
    }

    return { migratedUserIds, leftUntouchedUserIds }
  } finally {
    db.close()
  }
}

export interface ResolvedProfileSecret {
  /** The profile's AI key encryption secret -- pass this straight through as `AppLocalModuleOptions.aiKeyEncryptionSecret`. */
  secret: string
  /**
   * `null` when `secrets/<id>.key` already existed: this profile already
   * had a per-profile secret (created by an earlier launch, itself already
   * migrated), so no migration was attempted this time. Otherwise, the
   * result of the migration that ran before this secret was persisted --
   * always present, even when it migrated nothing (a brand new profile).
   */
  migration: MigrateAiKeyEncryptionSecretResult | null
}

/**
 * Resolves `profileId`'s AI key encryption secret, creating and migrating
 * it on first use.
 *
 * - If `secrets/<profileId>.key` already exists: read it, verify it with
 *   `assertUsableAiKeyEncryptionSecret`, and return it. No migration is
 *   attempted -- an existing secret file means this profile's data is
 *   already encrypted under it (see below for why).
 * - Otherwise: generate a new secret, migrate `databaseFile` from
 *   `LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET` to it (`migrateAiKeyEncryptionSecret`),
 *   persist the new secret to `secrets/<profileId>.key` atomically, verify
 *   the write by reading it back, and return it.
 *
 * **Ordering, and the one crash window this cannot close.** The database
 * migration runs, and its transaction commits, BEFORE the new secret is
 * written to disk -- never the other way around. If the process is killed
 * between those two steps, the next launch finds no secret file (so it
 * looks exactly like "never migrated"), generates ANOTHER new secret, and
 * retries the migration: every row already re-encrypted under the lost
 * secret from the crashed attempt now fails to decrypt under
 * `LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET` (it is no longer encrypted with
 * that secret) and is reported in `leftUntouchedUserIds` rather than
 * guessed at. That is an honest, narrow trade-off: this specific BYOK key
 * is unrecoverable after such a crash, but nothing else is -- the
 * transaction's all-or-nothing guarantee means every *other* row (and every
 * other table in the database) is exactly as it was, and the profile still
 * opens (`AiKeyResolverService` degrades to "no key" for the affected
 * user). The alternative order (write the secret file first, migrate
 * second) trades this for the same class of failure in the opposite
 * direction -- a secret persisted before the data it is meant to protect is
 * actually re-encrypted under it -- so there is no ordering that removes
 * the window entirely; this one was chosen because "migration verified
 * safe, then commit the pointer to it" mirrors how `migrateAiKeyEncryptionSecret`
 * itself treats its own transaction, and every recovery primitive elsewhere
 * in this package (`snapshot.ts`, `profile-registry.ts`) follows the same
 * "durable state first, pointer to it second" shape.
 */
export function resolveProfileAiKeyEncryptionSecret(options: {
  profileDir: string
  profileId: string
  databaseFile: string
}): ResolvedProfileSecret {
  const { profileDir, profileId, databaseFile } = options
  const secretPath = profileSecretFilePath(profileDir, profileId)

  if (existsSync(secretPath)) {
    const secret = readFileSync(secretPath, 'utf8')
    assertUsableAiKeyEncryptionSecret(secret)
    return { secret, migration: null }
  }

  const newSecret = generateAiKeyEncryptionSecret()
  const migration = migrateAiKeyEncryptionSecret(databaseFile, LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET, newSecret)

  writeSecretFileAtomic(secretPath, newSecret)

  const readBack = readFileSync(secretPath, 'utf8')
  if (readBack !== newSecret) {
    throw new Error(
      `resolveProfileAiKeyEncryptionSecret: refusing to use ${secretPath} -- the value read back after writing ` +
        'did not match what was written. Refusing rather than proceeding with an unverified secret.',
    )
  }

  return { secret: newSecret, migration }
}
