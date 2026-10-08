import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Behavioral proof that the global `JwtAuthGuard` (registered as `APP_GUARD`
 * in `AppModule`, see commit 88cc380) actually rejects unauthenticated
 * callers.
 *
 * This is deliberately different from `jwt-auth.guard.spec.ts` (unit-level:
 * does the guard's `canActivate` return the right boolean for a given
 * metadata shape) and from the structural boot-and-walk verification done
 * for 88cc380 (metadata/provider/route-binding diff before vs. after). Both
 * of those prove the wiring is unchanged; neither sends an HTTP request or
 * observes a response. Only a real request against a real bound route
 * proves the property anyone actually cares about: does an unauthenticated
 * caller get rejected, and does a legitimately authenticated one not.
 *
 * Route discovery walks the live Express router instead of hardcoding a
 * route list, so a new controller added later is automatically covered by
 * this spec without anyone remembering to update it here.
 *
 * IMPORTANT, discovered while building the mutation proof for this spec:
 * every protected handler in this codebase takes `@CurrentUser()` as its
 * first parameter (see common/decorators/current-user.decorator.ts), which
 * itself throws `UnauthorizedException` (401) when `request.user` is
 * unset. That is a deliberate second line of defense -- but it means a
 * *bare, tokenless* request cannot tell "the guard correctly rejected me"
 * apart from "the guard was bypassed (e.g. a stray `@Public()`) and the
 * handler's own null-check caught it instead": both produce a
 * byte-for-byte identical 401. A tokenless-only check would pass even if
 * the global guard were completely disabled, for every route that happens
 * to use `@CurrentUser()` -- which is every one of them. The second check
 * below (a validly signed token for a route the guard should still accept)
 * closes that gap: if the guard is doing its job, a well-formed token gets
 * past it and the request fails downstream (validation, or the stubbed
 * Prisma) for reasons that are never 401; if the guard has been bypassed
 * for that route, the token is never inspected at all and `@CurrentUser()`
 * still throws 401. That asymmetry is what makes a stray `@Public()`
 * observable.
 */

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

// The only 4 routes intentionally exempted from the global guard (see
// `@Public()` usage in app.controller.ts and auth.controller.ts). Everything
// else the router has bound must require a valid JWT. This is not "the
// route list" the enumeration exists to avoid hardcoding -- it is the fixed,
// small set of documented exceptions, checked against reality below rather
// than assumed.
const PUBLIC_ROUTES = new Set<string>([
  'GET /api/health',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
])

/** Discovers every route Express actually bound, straight off the live
 * router. No hardcoded per-controller list -- a controller added after this
 * spec was written is picked up automatically. */
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

describe('route posture (behavioral)', () => {
  let app: INestApplication
  let baseUrl: string
  let routes: DiscoveredRoute[]
  let validToken: string

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Keeps the suite offline: the real PrismaService connects to
      // Postgres from `onModuleInit` (see prisma.service.ts), and it is the
      // only provider anywhere in this module graph that touches a network
      // resource during boot. Overriding the provider does not touch guard
      // wiring -- APP_GUARD registration lives in AppModule's `providers`
      // array, untouched by this override -- so the posture measured below
      // is the real one. Confirmed, not assumed: this whole suite (and the
      // full `pnpm --filter @wimm/api test` run) passes with PostgreSQL
      // stopped.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile()

    // `logger: false` only silences Nest's console noise from the
    // expected downstream errors (stubbed Prisma, missing bodies) that the
    // requests below deliberately trigger past the guard -- it has no
    // effect on the guard/exception-handling behavior itself.
    app = moduleRef.createNestApplication({ logger: false })

    // Mirrors main.ts: the global prefix and pipes are applied by bootstrap
    // code that `createNestApplication()` alone does not run. The prefix
    // matters most here -- routes bind under the prefix at init() time, so
    // every path this spec requests must include it or every request 404s
    // and the assertions below would pass vacuously against nothing.
    app.setGlobalPrefix('api')
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

    // Pulled from the real DI graph (AuthModule re-exports JwtModule), so
    // this signs with the exact secret the running app verifies against --
    // not a value this spec assumes or duplicates.
    const jwtService = moduleRef.get(JwtService, { strict: false })
    validToken = jwtService.sign({
      sub: 'route-posture-spec-fake-user',
      email: 'route-posture-spec@example.com',
      username: 'route-posture-spec',
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('discovers the known public routes plus a non-trivial set of others', () => {
    // Not a route list -- a floor. Catches route discovery silently
    // returning nothing (wrong adapter API, prefix applied too late, etc.),
    // which would otherwise make the main assertion below pass vacuously.
    expect(routes.length).toBeGreaterThanOrEqual(36 + PUBLIC_ROUTES.size)

    const discoveredKeys = new Set(
      routes.map((r) => `${r.method} ${r.path}`),
    )
    for (const publicRoute of PUBLIC_ROUTES) {
      expect(discoveredKeys.has(publicRoute)).toBe(true)
    }
  })

  it('rejects every protected route and admits every public route with an unauthenticated request', async () => {
    const mismatches: Array<{
      route: string
      expected: 'public' | 'protected'
      status: number
    }> = []

    // One real HTTP request per discovered route, unauthenticated (no
    // Authorization header). Each (controller, handler) pair has its own
    // throttler bucket -- @nestjs/throttler's generateKey hashes class name
    // + handler name + IP, so hits to different routes never share a
    // counter -- and the tightest configured limit anywhere is 5/hour on
    // register. A single hit per route is nowhere near any configured
    // limit, so this cannot flake into a 429.
    for (const route of routes) {
      const routeKey = `${route.method} ${route.path}`
      const expectPublic = PUBLIC_ROUTES.has(routeKey)

      const res = await fetch(`${baseUrl}${toRequestPath(route.path)}`, {
        method: route.method,
      })

      const isUnauthorized = res.status === 401
      const isMismatch = expectPublic === isUnauthorized
      if (isMismatch) {
        mismatches.push({
          route: routeKey,
          expected: expectPublic ? 'public' : 'protected',
          status: res.status,
        })
      }
    }

    expect(mismatches).toEqual([])
  })

  it('lets a validly signed token reach every protected route (i.e. the guard is truly consulted, not incidentally satisfied)', async () => {
    // See the file-level comment: a tokenless request alone cannot tell
    // "the guard rejected me" apart from "the guard was bypassed but
    // `@CurrentUser()`'s own null-check caught it", because both yield an
    // identical 401. This closes that gap. A well-formed, correctly signed
    // token must never be rejected with 401 on a protected route -- if it
    // is, either the guard is misconfigured, or (the case this exists to
    // catch) the route was never actually reaching the guard's real
    // passport check in the first place. Downstream failures (validation
    // 400s, or 500s from the stubbed Prisma) are expected and irrelevant
    // here; only 401 signals the guard itself rejected a valid token.
    const falsePositives: Array<{ route: string; status: number }> = []

    for (const route of routes) {
      const routeKey = `${route.method} ${route.path}`
      if (PUBLIC_ROUTES.has(routeKey)) continue

      const res = await fetch(`${baseUrl}${toRequestPath(route.path)}`, {
        method: route.method,
        headers: { Authorization: `Bearer ${validToken}` },
      })

      if (res.status === 401) {
        falsePositives.push({ route: routeKey, status: res.status })
      }
    }

    expect(falsePositives).toEqual([])
  })
})
