import { Controller, Get, INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import type { AddressInfo } from 'node:net'
import { join } from 'path'
// `@types/better-sqlite3` uses `export =`, same reasoning as
// open-local-database.ts: import-equals is required for the runtime value
// (not just the type) to resolve.
import Database = require('better-sqlite3')
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { LocalPrismaService } from '../prisma/local/local-prisma.service'
import { ProfileModule } from './profile.module'

/**
 * Behavioral proof that `ActiveProfileMiddleware` is actually wired into the
 * request pipeline by `ProfileModule`, applied to the routes that need it,
 * and that `@CurrentUser()` reads back exactly what it wrote.
 *
 * A unit test that calls the middleware's `.use()` directly (see
 * `active-profile.middleware.spec.ts`) only proves the function body -- it
 * would still pass even if `ProfileModule.configure()` never called
 * `consumer.apply(...)` at all. This spec instead builds a tiny real module
 * around `ProfileModule.forRoot(...)`, a controller that does nothing but
 * return `@CurrentUser()`, boots it with `@nestjs/testing` (same
 * boot-and-request pattern as `auth/route-posture.spec.ts`), and issues a
 * real, tokenless HTTP request against a real listening server -- there is
 * no accounts system in the local build, so unlike the hosted build's
 * posture spec, no Authorization header is ever sent here, and success
 * (200, not 401) is itself part of what is being proven.
 */

const ROOT = '/tmp/wimm-profile-request-seam-spec'
const BASELINE = join(__dirname, '../../prisma/migrations-sqlite/0000_baseline/migration.sql')

/** Builds a fresh SQLite file with the real, committed Phase 1 baseline applied. */
function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

/** Inserts a single `User` row through Prisma itself (a throwaway
 * `LocalPrismaService` connection, connected and disconnected within this
 * call), so `createdAt`/`updatedAt` -- which Prisma manages client-side, not
 * as SQL column defaults -- are populated the same way the real application
 * would, before the module under test opens its own connection to the file. */
async function seedUser(
  file: string,
  email: string,
  username: string,
): Promise<{ id: string; email: string; username: string }> {
  const seeding = new LocalPrismaService(file)
  await seeding.onModuleInit()
  try {
    const id = randomUUID()
    await seeding.user.create({ data: { id, email, username, passwordHash: 'irrelevant-hash' } })
    return { id, email, username }
  } finally {
    await seeding.onModuleDestroy()
  }
}

/** Minimal controller whose only job is to hand back whatever
 * `@CurrentUser()` resolves to, so the HTTP response body is a direct,
 * end-to-end observation of what the middleware put on `request.user`. */
@Controller('whoami')
class WhoAmIController {
  @Get()
  whoAmI(@CurrentUser() user: JwtPayload): JwtPayload {
    return user
  }
}

function buildTestModule(databaseFile: string): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [ProfileModule.forRoot({ databaseFile })],
    controllers: [WhoAmIController],
  }).compile()
}

describe('the request seam: ActiveProfileMiddleware -> req.user -> @CurrentUser() (behavioral, through a real Nest app)', () => {
  let app: INestApplication
  let baseUrl: string
  let expectedUser: JwtPayload

  beforeAll(async () => {
    const file = freshDatabaseFile()
    const seeded = await seedUser(file, 'bob@example.com', 'bob')
    expectedUser = { sub: seeded.id, email: seeded.email, username: seeded.username }

    const moduleRef = await buildTestModule(file)
    app = moduleRef.createNestApplication({ logger: false })
    await app.init()

    const server = await app.listen(0, '127.0.0.1')
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await app.close()
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('a real, tokenless HTTP request reaches a handler whose @CurrentUser() carries the active profile user, every field correct', async () => {
    // Deliberately no Authorization header -- there is no accounts system to
    // authenticate against in the local build. Getting a 200 back with the
    // right body IS the proof that the seam supplies identity without one.
    const res = await fetch(`${baseUrl}/whoami`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(expectedUser)
  })
})

