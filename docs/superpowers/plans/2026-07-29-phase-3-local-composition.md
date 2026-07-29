# Phase 3 — Local Composition and Profiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second NestJS composition root that serves the same feature modules against a local SQLite database, with profiles instead of accounts and no authentication — while the hosted composition keeps behaving exactly as it does today.

**Architecture:** The JWT guard moves from eight controllers to the hosted composition root, so each root declares its own auth posture and no feature module knows which mode it is in. A `ProfileModule` supplies the active profile's user id through the same `req.user` seam the JWT strategy uses, so `CurrentUser` and every service stay untouched. A `LocalPrismaService` wraps the SQLite client and is provided under the `PrismaService` token behind one documented cast.

**Tech Stack:** TypeScript 5.5, NestJS 10, Prisma 7.7 with driver adapters, `better-sqlite3`, Jest 30.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scopes: `api`, `auth`, `database`.
- **The hosted build's behaviour must not change.** Every route protected today stays protected; the four public routes stay public.
- `apps/desktop` and `apps/mobile` must not be touched. Phase 3 stays Electron-free so it remains testable offline — the profile directory is injected, not read from `app.getPath`.
- No new dependencies.
- The API test suite stays **offline**. Temporary SQLite files are fine.
- Baseline: `@wimm/shared` 28/28, `@wimm/api` 302/302 across 41 suites, `pnpm lint --force` green, both guards pass.

## Facts established by prototype — do not re-derive

Two assumptions in the design spec were wrong. Both were caught before this plan, by experiment:

1. **The two generated Prisma clients are NOT structurally interchangeable.** Providing the SQLite client under the `PrismaService` token fails to typecheck:
   `Type 'PrismaClient' is not assignable to type 'Pick<PrismaService, "transaction" | "user" | …>'`.
   Prisma brands its generated types per provider, so identical schemas still produce distinct types.
2. **One client cannot serve both dialects.** Pairing the Postgres-generated client with the SQLite adapter is refused outright:
   `The Driver Adapter '@prisma/adapter-better-sqlite3', based on 'sqlite', is not compatible with the provider 'postgres' specified in the Prisma schema.`
   So the second client Phase 1 produced is mandatory, and a cast at the provider boundary is the honest resolution — one documented seam rather than nine services depending on a hand-maintained structural type.

3. **Every controller carries its own guard.** Eight declare `@UseGuards(AuthGuard('jwt'))` at class level; `app.controller.ts` (health) and `auth/auth.controller.ts` (register, login, refresh) do not. The spec's claim that "no feature module learns which mode it is in" is false today — Task 1 makes it true.

---

## Task 1: Move the JWT guard to the composition root

Today a new controller without `@UseGuards` is **public by default** — the failure mode is open. After this task, a new route is protected unless explicitly marked public: the failure mode becomes closed. That is a security improvement for the hosted build independent of the local one.

**Files:**
- Create: `apps/api/src/common/decorators/public.decorator.ts`
- Create: `apps/api/src/auth/jwt-auth.guard.ts` (a guard that honours `@Public`)
- Modify: `apps/api/src/app.module.ts` (register it as a second `APP_GUARD`)
- Modify: the 8 guarded controllers (remove `@UseGuards` and its imports)
- Modify: `app.controller.ts` and `auth/auth.controller.ts` (mark the 4 public routes)

**Interfaces:**
- Produces: `@Public()` and a global guard that skips routes carrying it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/jwt-auth.guard.spec.ts` proving:
- a handler **without** `@Public` delegates to the passport JWT guard;
- a handler **with** `@Public` is allowed without consulting it;
- `@Public` on the **class** exempts its handlers too (the auth controller marks routes individually, but a future contributor will reach for the class form).

Use `Reflector` with a real `ExecutionContext` double rather than mocking the decorator away — the point is that the metadata key actually matches.

- [ ] **Step 2: Run to verify it fails**, then implement the decorator and guard.

- [ ] **Step 3: Register globally and strip the controllers**

In `app.module.ts`, add the guard to `providers` alongside the existing `ThrottlerGuard`:

```ts
providers: [
  AppService,
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
],
```

Remove `@UseGuards(AuthGuard('jwt'))` and the now-unused `UseGuards` / `AuthGuard` imports from all 8 controllers. Mark `@Public()` on `app.controller.ts`'s `health` and on `auth.controller.ts`'s `register`, `login`, and `refresh`.

- [ ] **Step 4: Prove the hosted posture is unchanged — this is the step that matters**

A refactor that quietly opens a route is the worst outcome here. Enumerate every route and its protection **before and after**, and diff the two lists.

Write a throwaway script that boots the Nest application, walks the router, and for each route reports whether the global guard would demand a JWT. Run it against `HEAD~1` and against your change, and show the two outputs are identical except that nothing regressed to public.

If you cannot boot the app in a script, the fallback is a spec that instantiates each controller's metadata and asserts the expected posture per route — but say which you did.

- [ ] **Step 5: Full suite, then commit**

```bash
git add apps/api/src
git commit -m "refactor(auth): move the jwt guard to the composition root"
```

---

## Task 2: `LocalPrismaService`

**Files:**
- Create: `apps/api/src/prisma/local/local-prisma.service.ts` and its spec

**Interfaces:**
- Consumes: `openLocalDatabase` is **not** used here — Prisma owns its own connection through the adapter. See the pragma note below.
- Produces: `LocalPrismaService`, an injectable extending the SQLite `PrismaClient`, constructed with `PrismaBetterSqlite3` against a file path supplied at module registration.

**The carry-over this task closes:** Phase 2's `openLocalDatabase` pins `foreign_keys` and `journal_mode` explicitly, but **Prisma's runtime connections never pass through it** — they go through the adapter, which relies on driver defaults. That is precisely the reliance Phase 2 existed to remove, left open one layer down. Two different `better-sqlite3` builds are in play (the root `13.0.1` and the adapter's bundled `12.11.1`), and both default `foreign_keys` to 1 today.

So this service must **set and verify the pragmas on its own connection**, via `$queryRawUnsafe('PRAGMA foreign_keys = ON')` and a read-back, in `onModuleInit`. Assert, do not assume — a driver upgrade in either package must not be able to silently disable cascade behaviour in the shipping app.

Tests must prove enforcement through Prisma itself: create a parent and child, delete the parent, assert the cascade fired.

- [ ] **Steps: TDD, then commit**

```bash
git commit -m "feat(database): add the local prisma service with verified pragmas"
```

---

## Task 3: The profile registry

**Files:**
- Create: `apps/api/src/prisma/local/profile-registry.ts` and its spec

**Interfaces:**
- Produces:
  - `type Profile = { id: string; name: string; dbFileName: string; createdAt: string; lastOpenedAt: string | null }`
  - `listProfiles(dir: string): Profile[]`
  - `createProfile(dir: string, name: string, id: string, now: Date): Profile`
  - `touchProfile(dir: string, id: string, now: Date): void`
  - `profileDatabasePath(dir: string, profile: Profile): string`

**Design points:**
- The registry lives at `<dir>/profiles.json`; databases at `<dir>/profiles/<id>.db`.
- `id` is supplied by the caller, not generated internally, for the same determinism reason `now` is injected.
- Writing the registry must be **atomic** — write a temp file and rename. A truncated `profiles.json` loses the index to every profile's database, and Phase 2 already established that pattern for exactly this reason.
- A malformed or missing registry must fail loudly with a message naming the file, not silently return an empty list. An empty list means "no profiles"; a corrupt registry means "your profiles exist but I cannot find them", and conflating the two would present a first-run onboarding screen to someone who has years of data.
- The `databaseId` that Phase 2's snapshot API requires is the profile `id`. Say so in a comment — that coupling is what keeps one profile's backups from pruning another's.

- [ ] **Steps: TDD, then commit**

```bash
git commit -m "feat(database): add the local profile registry"
```

---

## Task 4: `ProfileModule` and the request seam

**Files:**
- Create: `apps/api/src/profile/profile.module.ts`, `active-profile.service.ts`, `active-profile.middleware.ts`, and specs

**Interfaces:**
- Produces: a middleware that populates `req.user` with `{ sub, email, username }` — the same `JwtPayload` shape the JWT strategy produces — sourced from the active profile's single `User` row.

**Why this shape:** `CurrentUser` (`common/decorators/current-user.decorator.ts`) reads `request.user` and is typed against `JwtPayload`. Producing the same shape means `CurrentUser`, all nine services, and every controller stay untouched. Do **not** modify the decorator.

The active profile is set once at composition time, not per request — there is one user and one database per running app instance. Switching profiles tears down and re-creates the Nest application, which Phase 4 owns.

- [ ] **Steps: TDD, then commit**

---

## Task 5: `app.local.module.ts`

**Files:**
- Create: `apps/api/src/app.local.module.ts` and its spec

It imports the same feature modules as `app.module.ts` and differs only at the edges:

| Concern | Hosted | Local |
|---|---|---|
| Identity | `AuthModule` + global `JwtAuthGuard` | `ProfileModule` + middleware |
| Persistence | `PrismaService` (Postgres) | `LocalPrismaService` (SQLite) under the `PrismaService` token |
| Rate limiting | `ThrottlerGuard` | none — there is no network surface to abuse |

**The one cast, and where it lives.** Prototype fact 1 means the SQLite client cannot be assigned to `PrismaService` structurally. Provide it as:

```ts
{
  provide: PrismaService,
  // The two generated clients are branded per provider, so TypeScript treats
  // them as distinct types even though phase 0 made the schemas identical and
  // phase 1 verified the SQLite client drives the same operations. Prisma also
  // refuses to pair a sqlite adapter with a postgres-generated client, so a
  // second client is mandatory and this is the single seam where they meet.
  useExisting: LocalPrismaService,
}
```

If `useExisting` alone does not satisfy the compiler, cast **once, here**, with that comment. Do not spread casts into services.

- [ ] **Verification for this task:** boot the local module against a temporary database created from the Phase 1 baseline, and exercise one read and one write through a real service — not a mock. If the cast is unsound at runtime, this is where it shows.

- [ ] **Commit**

```bash
git commit -m "feat(api): add the local composition root"
```

---

## Task 6: Verification

- [ ] Hosted route posture unchanged (Task 1's before/after diff, re-run).
- [ ] `git diff --name-only <base>..HEAD -- apps/api/src` touches no service, only controllers (guard removal), `common/decorators` (new `@Public`), `auth/`, `prisma/`, `profile/`, and the two module roots.
- [ ] Clients untouched.
- [ ] `pnpm build --force && pnpm lint --force`, both suites, both guards.
- [ ] The API suite passes with the PostgreSQL container **stopped**.

---

## Exit criteria

- Every route protected before this phase is still protected; the four public routes are still public; that was proven by enumeration, not inspection.
- A new controller added without any decorator is protected by default.
- The local module boots and serves a real read and write against SQLite.
- `LocalPrismaService` verifies its own pragmas rather than inheriting them.
- A corrupt `profiles.json` fails loudly and is never mistaken for "no profiles yet".
- No service file changed.
