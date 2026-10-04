import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
// `@types/better-sqlite3` uses `export =`; import-equals is required for the
// runtime value to resolve, same as `local-route-posture.spec.ts`.
import Database = require('better-sqlite3')
import {
  deriveAiKeyEncryptionKey,
  encryptWithAiKey,
} from '../ai-key-crypto'
import { LocalPrismaService } from '../../prisma/local/local-prisma.service'
import { generateAiKeyEncryptionSecret } from '../../prisma/local/profile-secret'
import { PrismaService } from '../../prisma/prisma.service'
import { ChatGptConnectionStore } from './chatgpt-connection.store'
import type { ChatGptCredentials } from './chatgpt-token-exchange'

const ROOT = '/tmp/wimm-chatgpt-connection-store-spec'
const BASELINE = join(
  __dirname,
  '../../../prisma/migrations-sqlite/0000_baseline/migration.sql',
)

function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

// Sentinels that cannot occur by accident: upper-case, hyphenated, and long.
// Base64 ciphertext contains neither '-' nor a run of this length, so finding
// one on disk means plaintext, and finding one in a serialized status means a
// leak, never a coincidence with a key name or an error string.
const ACCESS = 'SENTINEL-ACCESS-TOKEN-5b1d93'
const REFRESH = 'SENTINEL-REFRESH-TOKEN-c7e402'
const ID_TOKEN = 'SENTINEL-ID-TOKEN-8a6f15'
const SCOPES = 'openid offline_access chatgpt.tokens.use.direct'

const credentials = (
  overrides: Partial<ChatGptCredentials> = {},
): ChatGptCredentials => ({
  accessToken: ACCESS,
  refreshToken: REFRESH,
  idToken: ID_TOKEN,
  expiresAt: new Date(Date.now() + 3_600_000),
  scopes: SCOPES,
  subject: 'sub-1',
  sharing: true,
  ...overrides,
})

describe('ChatGptConnectionStore', () => {
  let prisma: LocalPrismaService
  let store: ChatGptConnectionStore
  let userId: string
  // Immutable and never written to by a test, so sharing it is safe; every
  // other piece of state (database file, user, store) is rebuilt per test.
  const secret = generateAiKeyEncryptionSecret()

  async function createUser(): Promise<string> {
    const id = randomUUID()
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.com`,
        username: id,
        passwordHash: 'irrelevant-hash',
      },
    })
    return id
  }

  /**
   * The two generated Prisma clients are branded per provider, so
   * `LocalPrismaService` is not assignable to `PrismaService` even though
   * `AppLocalModule` aliases one to the other at runtime. Same seam, same
   * reason, as the `useExisting` there: this is the one place they meet.
   */
  const storeOver = (db: LocalPrismaService, withSecret: string) =>
    new ChatGptConnectionStore(db as unknown as PrismaService, withSecret)

  beforeEach(async () => {
    prisma = new LocalPrismaService(freshDatabaseFile())
    await prisma.onModuleInit()
    userId = await createUser()
    store = storeOver(prisma, secret)
  })

  afterEach(async () => {
    await prisma.onModuleDestroy()
  })

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('round-trips credentials through encryption', async () => {
    const issued = credentials()
    await store.save(userId, 'client-1', issued)
    const loaded = await store.load(userId)
    expect(loaded).toEqual(issued)
    expect(loaded?.expiresAt).toBeInstanceOf(Date)
  })

  it('writes ciphertext, never the plaintext tokens', async () => {
    await store.save(userId, 'client-1', credentials())
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.tokensEncrypted).toBeTruthy()
    expect(row!.tokensEncrypted).not.toContain(ACCESS)
    expect(row!.tokensEncrypted).not.toContain(REFRESH)
    expect(row!.tokensEncrypted).not.toContain(ID_TOKEN)
  })

  it('writes ciphertext for a pending rotation too', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(
      userId,
      credentials({
        accessToken: 'SENTINEL-ROTATED-ACCESS-2f90d1',
        refreshToken: 'SENTINEL-ROTATED-REFRESH-6e44a8',
      }),
    )
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.pendingEncrypted).toBeTruthy()
    expect(row!.pendingEncrypted).not.toContain('SENTINEL-ROTATED-ACCESS')
    expect(row!.pendingEncrypted).not.toContain('SENTINEL-ROTATED-REFRESH')
  })

  it('returns null, not a throw, when the row was encrypted under another secret', async () => {
    await store.save(userId, 'client-1', credentials())
    const foreign = storeOver(prisma, generateAiKeyEncryptionSecret())
    await expect(foreign.load(userId)).resolves.toBeNull()
    await expect(foreign.loadPending(userId)).resolves.toBeNull()
  })

  it('returns null when the blob decrypts but is not credentials', async () => {
    // Authentic ciphertext under the right secret, wrong content: this is
    // the "decrypts fine, parses fine, still not ours" case that a bare
    // JSON.parse would hand straight to a caller as if it were credentials.
    const key = deriveAiKeyEncryptionKey(secret)
    const row = await prisma.chatGptConnection.create({
      data: { userId, clientId: 'client-1', scopes: SCOPES },
    })
    for (const content of [
      'not json at all',
      JSON.stringify({ accessToken: ACCESS }),
      JSON.stringify({ ...credentials(), expiresAt: 'not a date' }),
      // A missing `refreshToken` is corruption, not "no refresh token".
      JSON.stringify(
        (({ refreshToken: _omitted, ...rest }) => rest)(credentials()),
      ),
    ]) {
      await prisma.chatGptConnection.update({
        where: { id: row.id },
        data: { tokensEncrypted: encryptWithAiKey(key, content) },
      })
      await expect(store.load(userId)).resolves.toBeNull()
    }
  })

  it('returns null for a user with no connection, and a null client id', async () => {
    await expect(store.load(userId)).resolves.toBeNull()
    await expect(store.loadPending(userId)).resolves.toBeNull()
    await expect(store.loadClientId(userId)).resolves.toBeNull()
  })

  it('refuses an unusable secret instead of deriving a key from it', () => {
    expect(() => storeOver(prisma, '')).toThrow(/usable AI key encryption secret/)
    expect(() => storeOver(prisma, '   ')).toThrow(
      /usable AI key encryption secret/,
    )
  })

  it('keeps clientId and accountLabel when tokens are cleared', async () => {
    await store.save(userId, 'client-1', credentials())
    // Nothing in this class writes the label (it is not part of a token
    // exchange), so set it the way whatever does would: directly. Without
    // this the test could not tell "retained" from "never there".
    await prisma.chatGptConnection.update({
      where: { userId },
      data: { accountLabel: 'ada@example.com' },
    })
    await store.savePending(userId, credentials({ accessToken: 'rotated' }))

    await store.clearTokens(userId)

    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.clientId).toBe('client-1')
    expect(row?.accountLabel).toBe('ada@example.com')
    expect(row?.tokensEncrypted).toBeNull()
    expect(row?.pendingEncrypted).toBeNull()
    expect(row?.sharing).toBe(false)
    expect(row?.expiresAt).toBeNull()
    await expect(store.load(userId)).resolves.toBeNull()
    await expect(store.loadPending(userId)).resolves.toBeNull()
    await expect(store.loadClientId(userId)).resolves.toBe('client-1')
  })

  it('clears only the named user', async () => {
    const other = await createUser()
    await store.save(userId, 'client-1', credentials())
    await store.save(other, 'client-2', credentials({ accessToken: 'other-access' }))

    await store.clearTokens(userId)

    await expect(store.load(userId)).resolves.toBeNull()
    expect((await store.load(other))?.accessToken).toBe('other-access')
    await expect(store.loadClientId(other)).resolves.toBe('client-2')
  })

  it('never exposes a token through status()', async () => {
    await store.save(userId, 'client-1', credentials())
    const status = await store.status(userId)
    expect(status).toMatchObject({ connected: true, sharing: true })
    // Exactly these keys: a new field would be a deliberate, reviewed change.
    expect(Object.keys(status).sort()).toEqual([
      'accountLabel',
      'connected',
      'expiresAt',
      'sharing',
    ])
    const serialized = JSON.stringify(status)
    for (const secretValue of [ACCESS, REFRESH, ID_TOKEN]) {
      expect(serialized).not.toContain(secretValue)
    }
  })

  it('reports not connected, with the retained label, after a disconnect', async () => {
    await store.save(userId, 'client-1', credentials())
    await prisma.chatGptConnection.update({
      where: { userId },
      data: { accountLabel: 'ada@example.com' },
    })
    await store.clearTokens(userId)

    await expect(store.status(userId)).resolves.toEqual({
      connected: false,
      sharing: false,
      accountLabel: 'ada@example.com',
      expiresAt: null,
    })
  })

  it('reports not connected for a user who never connected', async () => {
    await expect(store.status(userId)).resolves.toEqual({
      connected: false,
      sharing: false,
      accountLabel: null,
      expiresAt: null,
    })
  })

  it('reports not connected when the stored credentials cannot be read', async () => {
    // An exported profile opened under a different secret: the blob is
    // there, but every provider call would find nothing. "Connected" would
    // be a lie the user could not act on.
    await store.save(userId, 'client-1', credentials())
    const foreign = storeOver(prisma, generateAiKeyEncryptionSecret())
    await expect(foreign.status(userId)).resolves.toMatchObject({
      connected: false,
      sharing: false,
      expiresAt: null,
    })
  })

  it('reports the expiry and sharing of the live credential', async () => {
    const expiresAt = new Date('2031-02-03T04:05:06.000Z')
    await store.save(
      userId,
      'client-1',
      credentials({ expiresAt, sharing: false }),
    )
    await expect(store.status(userId)).resolves.toMatchObject({
      connected: true,
      sharing: false,
      expiresAt,
    })
  })

  it('promotes a pending rotation and clears the pending slot', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(
      userId,
      credentials({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }),
    )

    // Before promotion the live credential is still the old one.
    expect((await store.load(userId))?.accessToken).toBe(ACCESS)

    await store.promotePending(userId)

    const live = await store.load(userId)
    expect(live?.accessToken).toBe('rotated-access')
    expect(live?.refreshToken).toBe('rotated-refresh')
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.pendingEncrypted).toBeNull()
    await expect(store.loadPending(userId)).resolves.toBeNull()
  })

  it('carries a promoted rotation\'s scopes, sharing and expiry into the row', async () => {
    await store.save(userId, 'client-1', credentials())
    const expiresAt = new Date('2032-01-02T03:04:05.000Z')
    await store.savePending(
      userId,
      credentials({
        scopes: 'openid offline_access',
        sharing: false,
        expiresAt,
        subject: 'sub-2',
      }),
    )
    await store.promotePending(userId)

    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row).toMatchObject({
      scopes: 'openid offline_access',
      sharing: false,
      expiresAt,
      subject: 'sub-2',
      clientId: 'client-1',
    })
  })

  it('treats promotion with nothing pending as a no-op', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.promotePending(userId)
    expect((await store.load(userId))?.accessToken).toBe(ACCESS)

    // And for a user with no row at all.
    await expect(store.promotePending(await createUser())).resolves.toBeUndefined()
  })

  it('does not promote a pending value that cannot be read', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(userId, credentials({ accessToken: 'rotated-access' }))
    const foreign = storeOver(prisma, generateAiKeyEncryptionSecret())

    await foreign.promotePending(userId)

    // Live credential untouched, pending slot untouched.
    expect((await store.load(userId))?.accessToken).toBe(ACCESS)
    expect((await store.loadPending(userId))?.accessToken).toBe('rotated-access')
  })

  it('round-trips a null refresh token as null, not as an empty string', async () => {
    // Task 6 returns `refreshToken: null` when `offline_access` was not
    // granted. It must survive the JSON round trip as null: coerced to `''`
    // it would later be handed to a refresh grant as a real-looking value
    // and fail at the authorization server instead of here.
    await store.save(userId, 'client-1', credentials({ refreshToken: null }))
    const loaded = await store.load(userId)
    expect(loaded).not.toBeNull()
    expect(loaded?.refreshToken).toBeNull()
  })

  it('keeps a null refresh token null through a pending rotation and its promotion', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(userId, credentials({ refreshToken: null }))
    expect((await store.loadPending(userId))?.refreshToken).toBeNull()

    await store.promotePending(userId)

    expect((await store.load(userId))?.refreshToken).toBeNull()
  })

  it('leaves the live credential intact when a rotation is saved but not promoted', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(userId, credentials({ accessToken: 'rotated-access' }))
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.pendingEncrypted).toBeTruthy()
    expect((await store.load(userId))?.accessToken).toBe(ACCESS)
    await expect(store.loadPending(userId)).resolves.toMatchObject({
      accessToken: 'rotated-access',
    })
  })

  it('supersedes a pending rotation when a fresh sign-in is saved', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(userId, credentials({ accessToken: 'stale-rotation' }))

    await store.save(userId, 'client-1', credentials({ accessToken: 'fresh-access' }))

    expect((await store.load(userId))?.accessToken).toBe('fresh-access')
    await expect(store.loadPending(userId)).resolves.toBeNull()
  })

  it('overwrites the credentials but keeps one row and the label on a re-save', async () => {
    await store.save(userId, 'client-1', credentials())
    await prisma.chatGptConnection.update({
      where: { userId },
      data: { accountLabel: 'ada@example.com' },
    })

    await store.save(userId, 'client-1', credentials({ accessToken: 'second-access' }))

    expect(await prisma.chatGptConnection.count({ where: { userId } })).toBe(1)
    expect((await store.load(userId))?.accessToken).toBe('second-access')
    expect(
      (await prisma.chatGptConnection.findUnique({ where: { userId } }))
        ?.accountLabel,
    ).toBe('ada@example.com')
  })

  it('reconnects after a disconnect under the retained client id', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.clearTokens(userId)

    const clientId = await store.loadClientId(userId)
    expect(clientId).toBe('client-1')
    await store.save(userId, clientId!, credentials({ accessToken: 'again' }))

    expect((await store.load(userId))?.accessToken).toBe('again')
  })
})
