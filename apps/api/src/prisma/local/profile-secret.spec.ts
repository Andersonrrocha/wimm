import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, sep } from 'path'
import { decryptWithAiKey, deriveAiKeyEncryptionKey, encryptWithAiKey } from '../../ai/ai-key-crypto'
import { openLocalDatabase } from './open-local-database'
import {
  LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET,
  assertUsableAiKeyEncryptionSecret,
  generateAiKeyEncryptionSecret,
  migrateAiKeyEncryptionSecret,
  profileSecretFilePath,
  resolveProfileAiKeyEncryptionSecret,
} from './profile-secret'

const ROOT = '/tmp/wimm-profile-secret-spec'

/** The real, committed baseline migration -- exercised deliberately, not replaced by a fixture. */
const BASELINE = join(__dirname, '../../../prisma/migrations-sqlite/0000_baseline/migration.sql')

/** Builds a fresh SQLite file with the real, committed baseline schema applied. */
function freshDatabaseFile(subdir: string): string {
  const dir = join(ROOT, subdir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.db`)
  const db = openLocalDatabase(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

/**
 * Inserts a `User` row directly via raw SQL (not Prisma) -- this suite is
 * about `profile-secret.ts`'s own fs/SQLite behaviour, not the ORM layer,
 * and `migrateAiKeyEncryptionSecret` itself reads/writes this table with
 * the same raw `better-sqlite3` connection style, so exercising it the same
 * way here matches what production code actually does.
 */
function insertUser(file: string, aiApiKeyEncrypted: string | null): string {
  const db = openLocalDatabase(file)
  const id = randomUUID()
  db.prepare(
    `INSERT INTO "User" ("id", "email", "username", "passwordHash", "aiCategorizationMode", "aiApiKeyEncrypted", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `${id}@example.com`, id, 'irrelevant-hash', 'BYOK', aiApiKeyEncrypted, new Date().toISOString())
  db.close()
  return id
}

function readAiApiKeyEncrypted(file: string, userId: string): string | null {
  const db = openLocalDatabase(file, { readonly: true })
  const row = db.prepare('SELECT "aiApiKeyEncrypted" AS aiApiKeyEncrypted FROM "User" WHERE "id" = ?').get(userId) as
    | { aiApiKeyEncrypted: string | null }
    | undefined
  db.close()
  return row?.aiApiKeyEncrypted ?? null
}

/** Encrypts `plaintext` under `secret`, exactly the format `AiKeyCrypto` produces -- used to seed a "pre-existing" encrypted value in tests without depending on Nest DI. */
function encryptUnder(secret: string, plaintext: string): string {
  return encryptWithAiKey(deriveAiKeyEncryptionKey(secret), plaintext)
}

/** Decrypts `payload` under `secret` -- the inverse of `encryptUnder`, used to assert what a resolved secret can actually read back. */
function decryptUnder(secret: string, payload: string): string {
  return decryptWithAiKey(deriveAiKeyEncryptionKey(secret), payload)
}

describe('profile-secret', () => {
  beforeEach(() => {
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  describe('generateAiKeyEncryptionSecret', () => {
    it('returns a hex string encoding at least 32 bytes of entropy', () => {
      const secret = generateAiKeyEncryptionSecret()

      expect(typeof secret).toBe('string')
      expect(/^[0-9a-f]+$/.test(secret)).toBe(true)
      // Hex-encoded: 2 characters per byte. 32 bytes -> 64 hex characters.
      expect(secret.length).toBeGreaterThanOrEqual(64)
      expect(Buffer.from(secret, 'hex').length).toBeGreaterThanOrEqual(32)
    })

    it('never returns the same value twice', () => {
      const secrets = new Set(Array.from({ length: 20 }, () => generateAiKeyEncryptionSecret()))
      expect(secrets.size).toBe(20)
    })
  })

  describe('assertUsableAiKeyEncryptionSecret -- mirrors assertUsableSessionToken exactly', () => {
    it('throws on an empty string', () => {
      expect(() => assertUsableAiKeyEncryptionSecret('')).toThrow(/AI key encryption secret/)
    })

    it('throws on a whitespace-only string', () => {
      expect(() => assertUsableAiKeyEncryptionSecret('   ')).toThrow(/AI key encryption secret/)
    })

    it('throws on undefined', () => {
      expect(() => assertUsableAiKeyEncryptionSecret(undefined)).toThrow(/AI key encryption secret/)
    })

    it('throws on null, describing it as "a null value"', () => {
      expect(() => assertUsableAiKeyEncryptionSecret(null)).toThrow(/a null value/)
    })

    it('throws on a non-string value, naming its type but never echoing it', () => {
      let thrown: Error | undefined
      try {
        assertUsableAiKeyEncryptionSecret(123456789)
      } catch (error) {
        thrown = error as Error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(thrown?.message).not.toContain('123456789')
    })

    it('does not throw on a usable secret', () => {
      expect(() => assertUsableAiKeyEncryptionSecret(generateAiKeyEncryptionSecret())).not.toThrow()
    })
  })

  describe('profileSecretFilePath', () => {
    it('resolves under secrets/, a sibling of (never nested inside) profiles/', () => {
      const path = profileSecretFilePath(ROOT, 'profile-id')

      expect(path).toBe(join(ROOT, 'secrets', 'profile-id.key'))
      expect(path).not.toContain(`${sep}profiles${sep}`)
    })

    it('is derived from the profile id, not any name -- there is no name parameter to accidentally use', () => {
      // profileSecretFilePath's signature itself is the proof: it takes
      // (profileDir, profileId) only. This test documents that contract so
      // a future edit adding a `name` parameter has to consciously break
      // this assertion's premise, not just slip past unnoticed.
      expect(profileSecretFilePath.length).toBe(2)
    })
  })

  describe('resolveProfileAiKeyEncryptionSecret -- generation, persistence and retrieval', () => {
    it('creates secrets/<id>.key on first resolve for a profile with no encrypted key, and returns a usable secret', () => {
      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('fresh-profile')
      const secretPath = profileSecretFilePath(ROOT, profileId)

      expect(existsSync(secretPath)).toBe(false)

      const result = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })

      expect(existsSync(secretPath)).toBe(true)
      expect(() => assertUsableAiKeyEncryptionSecret(result.secret)).not.toThrow()
      expect(readFileSync(secretPath, 'utf8')).toBe(result.secret)
      // Nothing to migrate for a brand new profile -- the migration still
      // ran (it is not skipped based on "newness"), it just found no rows.
      expect(result.migration).toEqual({ migratedUserIds: [], leftUntouchedUserIds: [] })
    })

    it('returns the exact same secret on a second resolve for the same profile (persistence)', () => {
      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('persisted-profile')

      const first = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })
      const second = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })

      expect(second.secret).toBe(first.secret)
      // The second call found an existing secret file -- no migration attempt.
      expect(second.migration).toBeNull()
    })

    it('gives two different profiles two different secrets under the same profileDir', () => {
      const profileAId = randomUUID()
      const profileBId = randomUUID()
      const databaseFileA = freshDatabaseFile('profile-a')
      const databaseFileB = freshDatabaseFile('profile-b')

      const a = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId: profileAId, databaseFile: databaseFileA })
      const b = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId: profileBId, databaseFile: databaseFileB })

      expect(a.secret).not.toBe(b.secret)
    })

    it('writes the secret file readable only by the owning user', () => {
      if (process.platform === 'win32') return // POSIX file modes are not meaningful on Windows.

      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('mode-check')
      const secretPath = profileSecretFilePath(ROOT, profileId)

      resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })

      const mode = statSync(secretPath).mode & 0o777
      expect(mode).toBe(0o600)
    })

    it('refuses (throws), never silently regenerates, when secrets/<id>.key exists but is corrupt (empty)', () => {
      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('corrupt-secret')
      const secretPath = profileSecretFilePath(ROOT, profileId)
      mkdirSync(join(ROOT, 'secrets'), { recursive: true })
      writeFileSync(secretPath, '')

      expect(() => resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })).toThrow(
        /AI key encryption secret/,
      )
    })
  })

  describe('resolveProfileAiKeyEncryptionSecret -- migrating an existing profile from the legacy shared secret', () => {
    it('migrates a BYOK key encrypted under the legacy constant: decryptable under the new secret, matching the original plaintext', () => {
      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('legacy-profile')
      const plaintext = 'sk-ant-a-real-looking-anthropic-key-1234567890'
      const userId = insertUser(databaseFile, encryptUnder(LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET, plaintext))

      const result = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })

      expect(result.migration).toEqual({ migratedUserIds: [userId], leftUntouchedUserIds: [] })

      // The key survives: what's on disk now decrypts, under the NEW
      // per-profile secret, back to the exact original plaintext.
      const stored = readAiApiKeyEncrypted(databaseFile, userId)
      expect(stored).not.toBeNull()
      expect(decryptUnder(result.secret, stored as string)).toBe(plaintext)

      // And it is genuinely re-encrypted, not left under the legacy secret:
      // the legacy secret can no longer decrypt what is stored now.
      expect(() => decryptUnder(LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET, stored as string)).toThrow()
    })

    it('is a no-op migration for a profile whose User row has no aiApiKeyEncrypted set', () => {
      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('no-key-profile')
      insertUser(databaseFile, null)

      const result = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })

      expect(result.migration).toEqual({ migratedUserIds: [], leftUntouchedUserIds: [] })
    })

    it('does not re-attempt migration on a later resolve once the secret file exists', () => {
      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('migrate-once')
      const plaintext = 'sk-ant-another-key'
      insertUser(databaseFile, encryptUnder(LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET, plaintext))

      const first = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })
      expect(first.migration?.migratedUserIds).toHaveLength(1)

      const second = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })
      expect(second.migration).toBeNull()
      expect(second.secret).toBe(first.secret)
    })
  })

  describe('migrateAiKeyEncryptionSecret (standalone)', () => {
    it('re-encrypts every non-null aiApiKeyEncrypted row from the old secret to the new one', () => {
      const databaseFile = freshDatabaseFile('standalone-migrate')
      const oldSecret = 'old-secret-value-at-least-16-chars'
      const newSecret = generateAiKeyEncryptionSecret()
      const plaintextA = 'sk-ant-key-for-user-a'
      const plaintextB = 'sk-ant-key-for-user-b'
      const userA = insertUser(databaseFile, encryptUnder(oldSecret, plaintextA))
      const userB = insertUser(databaseFile, encryptUnder(oldSecret, plaintextB))

      const result = migrateAiKeyEncryptionSecret(databaseFile, oldSecret, newSecret)

      expect(new Set(result.migratedUserIds)).toEqual(new Set([userA, userB]))
      expect(result.leftUntouchedUserIds).toEqual([])
      expect(decryptUnder(newSecret, readAiApiKeyEncrypted(databaseFile, userA) as string)).toBe(plaintextA)
      expect(decryptUnder(newSecret, readAiApiKeyEncrypted(databaseFile, userB) as string)).toBe(plaintextB)
    })

    it('is a no-op when no row has a non-null aiApiKeyEncrypted value', () => {
      const databaseFile = freshDatabaseFile('standalone-noop')
      insertUser(databaseFile, null)

      const result = migrateAiKeyEncryptionSecret(
        databaseFile,
        'old-secret-value-at-least-16-chars',
        generateAiKeyEncryptionSecret(),
      )

      expect(result).toEqual({ migratedUserIds: [], leftUntouchedUserIds: [] })
    })

    it('leaves a row it cannot decrypt under the old secret byte-for-byte untouched, and reports it', () => {
      const databaseFile = freshDatabaseFile('undecryptable-row')
      const foreignSecret = 'a-completely-different-secret-value'
      const undecryptable = encryptUnder(foreignSecret, 'sk-ant-orphaned-key')
      const userId = insertUser(databaseFile, undecryptable)

      const result = migrateAiKeyEncryptionSecret(
        databaseFile,
        'old-secret-value-at-least-16-chars',
        generateAiKeyEncryptionSecret(),
      )

      expect(result).toEqual({ migratedUserIds: [], leftUntouchedUserIds: [userId] })
      expect(readAiApiKeyEncrypted(databaseFile, userId)).toBe(undecryptable)
    })
  })

  describe('export safety: the artefact Task 4\'s export copies never contains the secret', () => {
    // Task 4 (phase 4c) exports a profile by copying its `.db` file alone
    // (see the plan's "Behaviour (D8)": `dialog.showSaveDialog` copies
    // `profiles/<id>.db`, nothing else). This is the direct proof the whole
    // design in this file exists for: produce that exact artefact, and show
    // the secret that decrypts the BYOK key ciphertext living inside it is
    // not itself inside it -- anywhere, not just in the one column that
    // happens to hold the ciphertext. A recipient of the exported file gets
    // the ciphertext and nothing that can decrypt it.
    it('the .db file contains the BYOK ciphertext but not the secret that decrypts it; the secret lives only in the sibling secrets/ file', () => {
      const profileId = randomUUID()
      const databaseFile = freshDatabaseFile('export-safety')
      const plaintext = 'sk-ant-the-users-real-byok-key-do-not-leak-me'
      const userId = insertUser(databaseFile, encryptUnder(LEGACY_SHARED_AI_KEY_ENCRYPTION_SECRET, plaintext))

      const { secret } = resolveProfileAiKeyEncryptionSecret({ profileDir: ROOT, profileId, databaseFile })

      // Sanity: the secret genuinely decrypts what's stored now (proves
      // this is testing the real post-migration state, not a no-op).
      const storedCiphertext = readAiApiKeyEncrypted(databaseFile, userId) as string
      expect(decryptUnder(secret, storedCiphertext)).toBe(plaintext)

      // This is exactly the artefact `dialog.showSaveDialog`-based export
      // (Task 4) copies: the profile's .db file, read as raw bytes, nothing
      // else -- no wrapping, no extra metadata.
      const exportedArtefact = readFileSync(databaseFile)

      // The BYOK ciphertext is genuinely inside the exported bytes --
      // otherwise this proof would be checking nothing.
      expect(exportedArtefact.includes(Buffer.from(storedCiphertext, 'utf8'))).toBe(true)

      // The secret that decrypts it is NOT inside the exported bytes, in
      // any encoding this suite can construct it in: not as the hex string
      // itself, and not as the raw bytes it decodes to.
      expect(exportedArtefact.includes(Buffer.from(secret, 'utf8'))).toBe(false)
      expect(exportedArtefact.includes(Buffer.from(secret, 'hex'))).toBe(false)

      // And structurally: the secret lives in a file the export never
      // touches -- a sibling of, not nested inside, profiles/.
      const secretPath = profileSecretFilePath(ROOT, profileId)
      expect(secretPath).not.toBe(databaseFile)
      expect(existsSync(secretPath)).toBe(true)
      expect(readFileSync(secretPath, 'utf8')).toBe(secret)
    })
  })
})
