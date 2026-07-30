/**
 * Behavioral proof that `SessionTokenGuard` actually protects the **local**
 * composition root once it is registered as `APP_GUARD` in
 * `app.local.module.ts` -- not just that the guard's own decision logic is
 * correct in isolation (`session-token.guard.spec.ts` covers that, cheaply,
 * with a fabricated `ExecutionContext`). This spec boots the real
 * `AppLocalModule`, listens on a real socket, and walks the real Express
 * router, mirroring exactly what `auth/route-posture.spec.ts` already does
 * for the hosted build.
 *
 * **Why a tokenless-only check is not proof, restated for this
 * composition specifically.** `auth/route-posture.spec.ts` explains the
 * hosted-build version of this trap: every protected handler takes
 * `@CurrentUser()`, which throws its own `UnauthorizedException` (401)
 * whenever `request.user` is unset -- identical to what the guard itself
 * throws, so a tokenless request cannot tell "the guard rejected me" apart
 * from "the guard never ran, and `@CurrentUser()`'s own null-check caught
 * it instead".
 *
 * The local composition inverts that trap in a way worth naming
 * explicitly, because it changes what a missing guard actually looks like
 * here. `ProfileModule`'s `ActiveProfileMiddleware` sets `request.user`
 * *unconditionally*, for every request, regardless of any guard's
 * decision -- that is the exact gap `SessionTokenGuard` exists to close
 * (see its doc comment). So if this guard were never wired into
 * `AppLocalModule`, `@CurrentUser()` would never 401 either: every route
 * would simply succeed for a tokenless caller. A tokenless-only assertion
 * here would not "accidentally still pass" the way the hosted-build trap
 * does -- it would fail loudly (nothing would be 401), which is a
 * different, weaker guarantee than it looks like at first glance. Either
 * way, only the second assertion below -- a *correct* token must never be
 * rejected -- proves the guard is the thing actually being exercised on
 * every route, rather than something else (or nothing) producing the same
 * status code by coincidence. See this task's report for the mutation
 * proof that pins this down with real, captured Jest output.
 *
 * Route discovery walks the live Express router instead of hardcoding a
 * route list, exactly like `route-posture.spec.ts`, so a controller added
 * to `AppLocalModule` later is automatically covered here too.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
// `@types/better-sqlite3` uses `export =`, same reasoning as
// `app.local.module.spec.ts`: import-equals is required for the runtime
// value (not just the type) to resolve.
import Database = require('better-sqlite3')
import { AppLocalModule } from '../app.local.module'
import { LocalPrismaService } from '../prisma/local/local-prisma.service'
import { generateSessionToken, SESSION_TOKEN_HEADER } from './session-token'

interface DiscoveredRoute {
  method: string
  path: string
}

interface ExpressRouteLayer {
  route?: {
    path: string
    methods: Record<string, boolean>
  }
}

const ROOT = '/tmp/wimm-local-route-posture-spec'
const BASELINE = join(__dirname, '../../prisma/migrations-sqlite/0000_baseline/migration.sql')

/** Builds a fresh SQLite file with the real, committed Phase 1 baseline
 * applied. Duplicated from `app.local.module.spec.ts`'s identical helper
 * rather than extracted to a shared module: this task's scope keeps
 * changes confined to `profile/`, and the two specs live in different
 * directories, so sharing would mean adding a new file outside that scope
 * for a few lines used in exactly two places. */
function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

/** Inserts the single `User` row `ActiveProfileService` requires (see
 * `ActiveProfileService`'s doc comment: zero rows is a hard boot failure).
 * Through Prisma itself, same as `app.local.module.spec.ts`. */
async function seedUser(file: string): Promise<void> {
  const seeding = new LocalPrismaService(file)
  await seeding.onModuleInit()
  try {
    await seeding.user.create({
      data: {
        id: randomUUID(),
        email: 'local-route-posture-spec@example.com',
        username: 'local-route-posture-spec',
        passwordHash: 'irrelevant-hash',
      },
    })
  } finally {
    await seeding.onModuleDestroy()
  }
}

/** Discovers every route Express actually bound, straight off the live
 * router -- no hardcoded per-controller list. Identical technique to
 * `auth/route-posture.spec.ts`. */
function discoverRoutes(app: INestApplication): DiscoveredRoute[] {
  // Express does not expose `_router` in its public types; this is the
  // standard (if private) way to walk bound routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = app.getHttpAdapter().getInstance() as any
  const stack: ExpressRouteLayer[] = instance._router?.stack ?? []
  const routes: DiscoveredRoute[] = []

  for (const layer of stack) {
    if (!layer.route) continue
    const path = layer.route.path
    for (const method of Object.keys(layer.route.methods)) {
      if (method === '_all') continue
      routes.push({ method: method.toUpperCase(), path })
    }
  }

  return routes
}

/** Path params never reach the handler when the guard rejects first -- any
 * syntactically valid placeholder works, it is never inspected. */
function toRequestPath(routePath: string): string {
  return routePath.replace(/:[A-Za-z0-9_]+/g, 'placeholder')
}

describe('local composition route posture (behavioral)', () => {
  let app: INestApplication
  let baseUrl: string
  let routes: DiscoveredRoute[]
  // The real generator this task builds, not a hand-picked literal --
  // matches how a real launch would supply this value to `forRoot`.
  const sessionToken = generateSessionToken()

  beforeAll(async () => {
    const file = freshDatabaseFile()
    await seedUser(file)

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppLocalModule.forRoot({ databaseFile: file, sessionToken })],
    }).compile()

    // `logger: false` only silences Nest's console noise from expected
    // downstream failures (validation errors, routes with no body) that
    // requests below deliberately trigger past the guard -- it has no
    // effect on guard or exception-handling behavior.
    app = moduleRef.createNestApplication({ logger: false })

    // No `setGlobalPrefix` here -- `app.local.module.spec.ts` boots this
    // same module the same way (unprefixed routes like `/sources`), and
    // this spec mirrors that rather than assuming a prefix a future
    // `main.local.ts` may or may not add.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )

    const server = await app.listen(0, '127.0.0.1')
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`

    routes = discoverRoutes(app)
  })

  afterAll(async () => {
    await app.close()
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('discovers a non-trivial set of routes across the local composition', () => {
    // Not a route list -- a floor. Catches route discovery silently
    // returning nothing (wrong adapter API, etc.), which would otherwise
    // make the assertions below pass vacuously against an empty set. 36
    // routes are bound today (Users, Sources, Categories,
    // CategorizationRules, Transactions, Imports, Recurrences, Reports);
    // this only asserts comfortably below that so a future controller
    // addition/removal does not require touching this spec.
    expect(routes.length).toBeGreaterThan(10)
  })

  it('rejects every route with no token', async () => {
    const mismatches: Array<{ route: string; status: number }> = []

    for (const route of routes) {
      const res = await fetch(`${baseUrl}${toRequestPath(route.path)}`, {
        method: route.method,
      })
      if (res.status !== 401) {
        mismatches.push({ route: `${route.method} ${route.path}`, status: res.status })
      }
    }

    expect(mismatches).toEqual([])
  })

  it('rejects every route with a wrong token', async () => {
    const mismatches: Array<{ route: string; status: number }> = []

    for (const route of routes) {
      const res = await fetch(`${baseUrl}${toRequestPath(route.path)}`, {
        method: route.method,
        headers: { [SESSION_TOKEN_HEADER]: 'definitely-not-the-right-token' },
      })
      if (res.status !== 401) {
        mismatches.push({ route: `${route.method} ${route.path}`, status: res.status })
      }
    }

    expect(mismatches).toEqual([])
  })

  it('never rejects a route with the correct token with a 401 (the assertion with teeth)', async () => {
    // See the file-level comment: this is the assertion that actually
    // proves the guard is wired in and consulted on every route, not just
    // that *something* returns 401 for a bad caller. Downstream failures
    // (validation 400s, or errors from real Prisma calls against an
    // otherwise-empty database) are expected and irrelevant here; only 401
    // signals the guard itself rejected a correct token.
    const falsePositives: Array<{ route: string; status: number }> = []

    for (const route of routes) {
      const res = await fetch(`${baseUrl}${toRequestPath(route.path)}`, {
        method: route.method,
        headers: { [SESSION_TOKEN_HEADER]: sessionToken },
      })
      if (res.status === 401) {
        falsePositives.push({ route: `${route.method} ${route.path}`, status: res.status })
      }
    }

    expect(falsePositives).toEqual([])
  })
})
