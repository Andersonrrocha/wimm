# Embedded Local Runtime (Phases 1–4) — Design

**Date:** 2026-07-28
**Status:** Draft, pending review
**Follows:** [Phase 0 — Standalone Local Architecture](2026-07-28-standalone-local-architecture-design.md) · [Enum Integrity and CI](2026-07-28-enum-integrity-and-ci-design.md)

---

## 1. Context

Phase 0 made the Prisma schema dialect-portable. I verified that claim directly for this spec rather than inheriting it:

- Swapping `provider = "postgresql"` to `"sqlite"` produces a **one-line diff** and `prisma validate` accepts it.
- `prisma migrate diff --from-empty --to-schema <sqlite schema> --script` emits **238 lines of clean SQLite DDL across 10 tables**, with no `::` casts, no `USING`, no `DROP TYPE`, no `SERIAL`, no `jsonb`.
- That DDL contains **zero `CHECK` constraints** — the known gap, now confirmed first-hand.

This spec covers the four phases that turn that portable schema into a desktop app a non-technical person can install and use with no infrastructure:

| Phase | Delivers |
|---|---|
| 1 | SQLite schema, second Prisma client, own migration chain, `CHECK` injection, drift guard |
| 2 | Migration runner with mandatory pre-migration backup |
| 3 | `app.local.module.ts`, profiles, no login |
| 4 | Nest embedded in the Electron main process |

At the end of Phase 4 the public build runs, stores data locally, and never contacts a server.

## 2. Goals

- A SQLite database whose enum columns carry the same 14 `CHECK` constraints PostgreSQL has.
- A user's local database survives every app update, from the first release onward.
- No migration can destroy data without a recoverable snapshot existing first.
- The app opens with no account, no server URL, and no configuration.
- The embedded API is unreachable from anywhere but the app itself.

## 3. Non-goals

- Sync between local and hosted. Still explicitly out of scope.
- Mobile. Expo has no Node runtime; mobile stays hosted-only.
- The parser registry, the CSV mapper, and the `AiProvider` contract (phases 5–6).
- Two build targets, signing, notarization (phase 7).
- Encryption at rest. File-per-profile isolation is the agreed stopping point; a passphrase remains a compatible later step.

---

## 4. Decisions

### D1 — The SQLite schema is derived, not maintained

**Chosen:** a build script produces `prisma/schema.sqlite.prisma` from `prisma/schema.prisma` by rewriting the `datasource` block, and nothing else. CI fails if the generated file differs from the committed one.

**Why:** verified above — the two schemas differ by exactly one line. A derived file cannot drift; a hand-maintained one silently will, and the drift would surface as a divergence between what the hosted build and the desktop build believe the data looks like.

The generated file **is committed**, so the SQLite migration chain and the client generation have a stable input and reviewers can see it in diffs.

### D2 — SQLite gets its own migration chain, from the first release

**Chosen:** `apps/api/prisma/migrations-sqlite/`, starting with a baseline, and every future schema change authors a migration for **both** dialects.

**Why:** the existing PostgreSQL migrations cannot be replayed on SQLite — they use `ALTER COLUMN ... TYPE`, `DROP TYPE`, and `::INTEGER` casts, none of which exist there. So SQLite needs its own history regardless.

The question was whether that history starts now or later. It starts now, because `electron-updater` is already wired to GitHub releases: users **will** update with data on disk. A regenerated-baseline approach works only until the first schema change ships, and then it either wipes or breaks the database of everyone who already uses the app. The recurring cost of two chains is the price of never having that conversation with a friend whose data is gone.

**Accepted cost:** every schema change is two migrations. A drift guard (D5) makes forgetting one a build failure rather than a runtime surprise.

### D3 — `CHECK` constraints are injected after generation

**Chosen:** a script post-processes generated SQLite DDL to add the 14 `CHECK` constraints into their `CREATE TABLE` statements, sourced from a single shared definition.

**Why:** Prisma does not model `CHECK`, and SQLite has no `ALTER TABLE ADD CONSTRAINT` — a constraint must exist at table creation or the table must be rebuilt. Injection at generation time is the only point where both are true.

The 14 definitions currently live in `apps/api/prisma/migrations/20260729120000_enums_to_text/migration.sql` and are duplicated in `apps/api/scripts/assert-check-constraints.ts`. This spec makes a **single TypeScript module** the source of truth, consumed by the injector, the assertion script, and the drift guard. Three copies of a security-relevant list is two too many.

**Why it matters more here than on PostgreSQL:** the hosted database is reachable only through the API. A local SQLite file sits on the user's disk, openable by any tool. The constraint is the only thing standing between a hand-edited file and corrupt values reaching the domain layer — where, as the enum-integrity work established, `parseEnum` will at least fail loudly rather than silently.

### D4 — Two generated clients, selected at composition time

**Chosen:** the SQLite schema generates a second client to its own output directory. `PrismaService` stays as-is for hosted; a new `LocalPrismaService` constructs the SQLite client with `@prisma/adapter-better-sqlite3`.

**New dependencies required — approval needed:** `@prisma/adapter-better-sqlite3` and `better-sqlite3`. Per `CLAUDE.md` these need explicit sign-off. `better-sqlite3` is a native module and will need per-platform rebuilds in the packaging step (phase 7); the Phase 0 design accepted that cost deliberately when choosing SQLite over PGlite.

### D5 — One drift guard, three things it checks

**Chosen:** a single script, run in CI, asserting:

1. `schema.sqlite.prisma` matches what regenerating it from `schema.prisma` would produce.
2. The PostgreSQL migration chain and the SQLite migration chain converge on the same models (via `prisma migrate diff` between each chain and its schema, expecting empty).
3. The injected `CHECK` list matches the shared definition module.

**Why one script and not three:** they fail for the same reason — someone changed the schema and updated only one side. A single failure message that says which of the three diverged is more useful than three separate red steps.

### D6 — Profiles: one file each, no login, no passphrase

**Chosen:** as agreed in Phase 0. `userData/profiles.json` holds `{id, name, dbFileName, createdAt, lastOpenedAt}`; each profile is `userData/profiles/<id>.db` containing exactly one `User` row whose id is the profile id.

**Why one `User` row rather than removing the concept:** every service already scopes by `userId`, and every query, index, and unique constraint depends on it. Keeping the column and seeding one row is a smaller, safer change than removing multi-tenancy — and it leaves sync and multi-profile-in-one-file possible later without a migration.

### D7 — Nest runs in the Electron main process, bound to loopback, behind a token

**Chosen:** `NestFactory.create(AppLocalModule)` inside `main`, `listen(0, '127.0.0.1')`, port handed to the renderer over IPC, and a per-session random token required on every request.

**Why in-process rather than a child process:** a child process needs its own lifecycle management, crash supervision, and a second Node runtime in the bundle. In-process, Electron's `main` already owns the lifecycle.

**Why the token is not optional:** binding to `127.0.0.1` stops other machines, not other processes. Any local process — including any web page open in the user's browser — can issue requests to `http://127.0.0.1:<port>`. Without an unguessable token, a visited web page could read the user's complete financial history. Origin checks alone do not stop this.

---

## 5. Architecture

### 5.1 Phase 1 — Schema, client, chain, constraints

```
apps/api/prisma/
  schema.prisma                  PostgreSQL, the source of truth
  schema.sqlite.prisma           generated, committed
  migrations/                    PostgreSQL chain (existing)
  migrations-sqlite/             SQLite chain (new)
    0000_baseline/migration.sql  generated, then CHECK-injected
apps/api/src/prisma/
  check-constraints.ts           the 14 definitions, single source of truth
apps/api/scripts/
  generate-sqlite-schema.ts      datasource rewrite
  inject-check-constraints.ts    CHECK injection into generated DDL
  assert-schema-parity.ts        the D5 drift guard
```

The baseline is produced by `prisma migrate diff --from-empty --to-schema prisma/schema.sqlite.prisma --script`, then piped through the injector. Regenerating it must be **deterministic** — same inputs, byte-identical output — or the drift guard is unusable.

### 5.2 Phase 2 — Migration runner and backup

At boot, for the active profile: read `_prisma_migrations`, compare against the shipped `migrations-sqlite/`, apply what is pending inside a transaction.

**Before applying anything, copy the profile's `.db` to `userData/backups/<profile>-<timestamp>.db`, keeping the last 5.** A failed migration must leave a file the user can go back to. This is the requirement Phase 0 recorded as non-negotiable, and it is the single most important line in this spec: on the hosted side a bad migration is recoverable from infrastructure backups, and here there is no infrastructure.

The Prisma CLI is **not** shipped — `prisma migrate deploy` is not viable inside a packaged app — so this is a small hand-written runner over the shipped `.sql` files.

### 5.3 Phase 3 — Local composition and profiles

`app.local.module.ts` imports the same feature modules as `app.module.ts` and replaces only the edges: `AuthModule` → `ProfileModule`, `PrismaService` → `LocalPrismaService`, no JWT, no throttler.

`common/decorators` is untouched: where the JWT strategy populates `req.user` in hosted mode, a local middleware populates it from the active profile. No feature module learns which mode it is in.

Boot: no profiles → onboarding creates one; exactly one → open it; more than one → picker. Switching profiles tears down the Nest application and re-instantiates it against the new file.

### 5.4 Phase 4 — Embedding

The Electron `main` process boots Nest on `listen(0, '127.0.0.1')` and passes the port and session token to the renderer over IPC. The renderer sets its axios base URL and a default header; the rest of its data layer is unchanged, still calling the same `/api/...` paths.

The refresh-token interceptor becomes a no-op in local mode — there are no tokens to refresh.

**Phase 4 requires a `/security-review` pass before it is considered done**, per the project skills playbook. It introduces a network listener and a new authentication surface.

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A migration corrupts a user's only copy of their data | **highest** | mandatory pre-migration snapshot; transactional apply; 5 retained backups |
| The two migration chains diverge unnoticed | high | D5 drift guard in CI; a schema change that updates one chain fails the build |
| Baseline regeneration is non-deterministic, making the drift guard flap | high | pin generation to a single documented command; the guard compares bytes |
| The localhost API is reached by a malicious web page | high | loopback bind plus per-session token; `/security-review` gate on phase 4 |
| `better-sqlite3` native module fails on a user's platform | medium | per-platform CI build matrix; deferred to phase 7 but must not be discovered there |
| Injected `CHECK` list drifts from the PostgreSQL one | medium | single shared definition module consumed by injector, assertion script, and guard |

---

## 7. Resolved questions

1. **Dependencies approved and installed** (`035fff9`): `@prisma/adapter-better-sqlite3` and `better-sqlite3`. The native module compiled on this machine.
2. **Profiles stay in `userData/profiles/`**, *and* the app gains an **export-profile action** so a non-technical user never has to find that path. This is the better answer than moving storage to a visible folder: it keeps the file out of accidental-deletion range while removing the technical step that made a visible folder tempting. See D8.
3. **The profile picker ships in phase 3**, not later — "better than leaving pendencies". Deferring it would mean a migration for single-profile installs that already exist.

## 8. D8 — Export profile, and restore from backup

**Chosen:** two Settings actions, both going through the Electron main process:

- **Export profile** — `dialog.showSaveDialog`, then copy the active profile's `.db` to wherever the user chooses. This is what makes `userData/profiles/` an acceptable location.
- **Restore from backup** — list the snapshots in `userData/backups/` with their timestamps and let the user pick one.

**Why restore is in scope even though only export was asked for:** phase 2 writes automatic snapshots before every migration. A backup a non-technical user cannot restore is theatre — it converts "your data is gone" into "your data is technically on disk somewhere". Restore is what makes the phase-2 requirement real, so it belongs with it.

Import-from-arbitrary-file (the inverse of export, for moving between machines) is **not** in scope here. It needs validation of an untrusted SQLite file, which is a bigger question than restoring a snapshot the app itself wrote.

## 9. Verified before writing this spec

I built a throwaway end-to-end prototype rather than trusting the design. All artifacts were removed afterwards.

**Proven working:** generated the SQLite schema by provider swap, generated a second Prisma client, created a real `.db` from the 236-line baseline DDL with `CHECK` constraints injected, drove it through Prisma with the adapter, created a `User` (default `chartDateMode: BILLING_CYCLE` applied) and a `Transaction` (`amountCents: 15045`), and **confirmed the injected `CHECK` rejected `kind: 'GARBAGE'`**. The whole thesis holds on real SQLite.

**Three facts the prototype corrected, which the implementation must respect:**

1. The adapter's export is **`PrismaBetterSqlite3`**, not `PrismaBetterSQLite3`. An easy silent-looking `is not a constructor` failure.
2. **`CHECK` injection must be scoped per `CREATE TABLE` block.** The string `"kind" TEXT NOT NULL,` appears **three times** in the generated DDL — `Transaction`, `Recurrence`, and `SystemCategorizationRule`. A global regex would inject the wrong constraint into the wrong table, and two of the three would be silently wrong rather than failing.
3. A generator's `output` is resolved **relative to the schema file**, and the generated client must live **inside the workspace** — it imports `@prisma/client/runtime/client`, which only resolves from within the repo's `node_modules` tree. The SQLite schema therefore lives in `apps/api/prisma/` and its client in `apps/api/src/generated/`.
