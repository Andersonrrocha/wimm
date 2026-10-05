/**
 * The three routes, over the real local composition.
 *
 * Boots `AppLocalModule` against a real SQLite file the way
 * `local-route-posture.spec.ts` does, and overrides exactly one
 * collaborator: `ChatGptConnectFlow`, whose real `connect` opens a system
 * browser and waits for a human. Its pieces are proven in Tasks 3-8 and its
 * composition in `chatgpt-connect-flow.spec.ts`.
 *
 * `status` is deliberately NOT overridden -- it is served straight off the
 * real `ChatGptConnectionStore`, so what these tests read back is what the
 * store really reports for this profile.
 *
 * Note the **unprefixed** paths: these specs do not call `setGlobalPrefix`,
 * matching `app.local.module.spec.ts` and `local-route-posture.spec.ts`.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
// `@types/better-sqlite3` uses `export =`; import-equals is required for the
// runtime value to resolve, same as the connection store's spec.
import Database = require('better-sqlite3')
import { AppLocalModule } from '../../app.local.module'
import { LocalPrismaService } from '../../prisma/local/local-prisma.service'
import { generateAiKeyEncryptionSecret } from '../../prisma/local/profile-secret'
import {
  generateSessionToken,
  SESSION_TOKEN_HEADER,
} from '../../profile/session-token'
import {
  CHATGPT_OPEN_BROWSER,
  ChatGptConnectFlow,
  type OpenBrowser,
} from './chatgpt-connect-flow'

const ROOT = '/tmp/wimm-chatgpt-controller-spec'
const BASELINE = join(
  __dirname,
  '../../../prisma/migrations-sqlite/0000_baseline/migration.sql',
)
const SECRET_KEYS = [
  'accessToken',
  'refreshToken',
  'idToken',
  'access_token',
  'refresh_token',
  'id_token',
  'tokensEncrypted',
  'pendingEncrypted',
]

function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

async function seedUser(file: string): Promise<string> {
  const seeding = new LocalPrismaService(file)
  await seeding.onModuleInit()
  try {
    const id = randomUUID()
    await seeding.user.create({
      data: {
        id,
        email: 'chatgpt-controller-spec@example.com',
        username: 'chatgpt-controller-spec',
        passwordHash: 'irrelevant-hash',
      },
    })
    return id
  } finally {
    await seeding.onModuleDestroy()
  }
}

/** Recursively assert no credential-shaped key appears anywhere. */
function assertNoCredentialKeys(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoCredentialKeys)
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      expect(SECRET_KEYS).not.toContain(key)
      assertNoCredentialKeys(nested)
    }
  }
}

describe('ChatGpt controller (behavioral, over the real local composition)', () => {
  let app: INestApplication
  let resolved: TestingModule
  let baseUrl: string
  let userId: string
  const openBrowser: OpenBrowser = async () => undefined
  const sessionToken = generateSessionToken()
  const aiKeyEncryptionSecret = generateAiKeyEncryptionSecret()
  /**
   * The one override. `disconnect` is on the flow too -- it is the inverse of
   * connect and owns the same consent decision (see
   * `ChatGptConnectFlow`) -- so the double has to answer it; what it really
   * does to the database is pinned in `chatgpt-connect-flow.spec.ts`.
   */
  const flow = {
    connected: [] as string[],
    disconnected: [] as string[],
    async connect(id: string) {
      this.connected.push(id)
      return {
        connected: true,
        sharing: true,
        accountLabel: 'ada@example.com',
        expiresAt: null,
      }
    },
    async disconnect(id: string) {
      this.disconnected.push(id)
      return {
        connected: false,
        sharing: false,
        accountLabel: 'ada@example.com',
        expiresAt: null,
      }
    },
  }

  beforeAll(async () => {
    const file = freshDatabaseFile()
    userId = await seedUser(file)

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        AppLocalModule.forRoot({
          databaseFile: file,
          sessionToken,
          aiKeyEncryptionSecret,
          openBrowser,
        }),
      ],
    })
      // The only override: the real flow opens a system browser and waits
      // for a human. Its pieces are proven in Tasks 3-8.
      .overrideProvider(ChatGptConnectFlow)
      .useValue(flow)
      .compile()
    resolved = moduleRef

    app = moduleRef.createNestApplication({ logger: false })
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    const server = await app.listen(0, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await app.close()
    rmSync(ROOT, { recursive: true, force: true })
  })

  const call = (path: string, method = 'GET', withToken = true) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: withToken ? { [SESSION_TOKEN_HEADER]: sessionToken } : {},
    })

  it('publishes the composition’s browser opener under its own token', async () => {
    // The flow is overridden above, so this is the one thing here that can
    // show `forRoot`'s `openBrowser` option actually reaches the DI graph the
    // real flow is built from. Both sides name the same imported symbol, so
    // there is no second spelling to get wrong.
    expect(resolved.get(CHATGPT_OPEN_BROWSER)).toBe(openBrowser)
  })

  it('reports disconnected before any connection exists', async () => {
    const response = await call('/ai/chatgpt/status')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      connected: false,
      sharing: false,
    })
  })

  it('never returns a credential from status', async () => {
    const body: unknown = await (await call('/ai/chatgpt/status')).json()
    assertNoCredentialKeys(body)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|eyJ/)
  })

  it('returns exactly the four status fields, and nothing a token could ride in', async () => {
    // A floor on what `status` is ALLOWED to say, not merely on what it
    // happens to say: a field added to the response -- credential-shaped or
    // not -- fails here rather than reaching a client.
    const body = (await (await call('/ai/chatgpt/status')).json()) as object
    expect(Object.keys(body).sort()).toEqual([
      'accountLabel',
      'connected',
      'expiresAt',
      'sharing',
    ])
  })

  it('returns status only from connect, and never a credential', async () => {
    const response = await call('/ai/chatgpt/connect', 'POST')
    expect(response.status).toBeLessThan(400)
    const body: unknown = await response.json()
    expect(body).toMatchObject({ connected: true, sharing: true })
    assertNoCredentialKeys(body)
    expect(flow.connected).toEqual([userId])
  })

  it('reports disconnected after disconnect', async () => {
    expect((await call('/ai/chatgpt/disconnect', 'POST')).status).toBeLessThan(
      400,
    )
    expect(flow.disconnected).toEqual([userId])
    await expect(
      (await call('/ai/chatgpt/status')).json(),
    ).resolves.toMatchObject({
      connected: false,
    })
  })

  it('rejects every route without the session token', async () => {
    for (const [path, method] of [
      ['/ai/chatgpt/status', 'GET'],
      ['/ai/chatgpt/connect', 'POST'],
      ['/ai/chatgpt/disconnect', 'POST'],
    ] as const) {
      expect((await call(path, method, false)).status).toBe(401)
    }
  })
})
