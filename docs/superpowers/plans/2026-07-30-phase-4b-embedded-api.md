# Phase 4b — Embedded API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app boots the Nest local composition inside its own main process, on an ephemeral loopback port protected by a per-launch token, and the renderer talks to it over the same `/api/...` paths it already uses — with a packaged build proving it, not just a dev build.

**Architecture:** Electron `main` creates a profile directory, ensures one profile database exists, boots `AppLocalModule` with `listen(0, '127.0.0.1')`, and hands the renderer the port and a per-launch token over IPC. A global guard on the local composition rejects any request without that token, so the listener is not merely obscure but actually closed. The renderer learns its mode from main: local mode sets the axios base URL and default header and makes the refresh-token interceptor inert; hosted mode is untouched.

**Tech Stack:** Electron 43.2.0, NestJS 10, Prisma 7.7 with driver adapters, `better-sqlite3`, electron-vite 5, electron-builder 26.

**`/security-review` gates this phase.** It introduces a network listener and a new authentication surface. It is not done until that review has run and its findings are resolved or explicitly accepted.

## Facts established in earlier phases — do not re-derive

1. **Electron is 43.2.0** (`process.versions.modules === 148`). Electron ≥ 35 is required: below that, `new Database()` in `better-sqlite3` 13 raises **SIGSEGV**, uncatchably.
2. **Two `better-sqlite3` copies.** The root v13 is N-API and portable. The copy `@prisma/adapter-better-sqlite3` pins (v12.11.1, pre-N-API) must be built per runtime; `npx tsx scripts/select-native-abi.ts <node|electron>` selects it, and `apps/api/src/prisma/local/native-abi-guard.ts` refuses on a mismatch. **That guard is deliberately inert when no `pnpm-workspace.yaml` is found at the computed repo root** — i.e. in a packaged app, where `electron-builder` has already rebuilt the module correctly.
3. **A real Prisma query already runs inside Electron main**, proven end to end through `LocalPrismaService` by `apps/desktop/scripts/verify-native-runtime.ts`. Run it (`--out=<file>`, ABI set to `electron`) whenever you suspect the runtime rather than your own code.
4. **`ProfileModule` refuses to boot** when its database has zero `User` rows, or more than one — a deliberate loud failure from Phase 3. So *something* must create a profile and its single user before the module is composed. This phase provides that headlessly; the UI for it is Phase 4c.
5. **`app.local.module.ts` provides `PrismaService` via `useExisting`, which Nest types as `any`.** The compiler checks nothing at that seam; `app.local.module.spec.ts` is the only thing standing behind it.
6. **The profile directory is injected, never read from `app.getPath` inside `apps/api`.** Phase 3 kept the API Electron-free and that still holds: `main` resolves the path and passes it in.
7. **BYOK is kept** (user decision). `AI_KEY_ENCRYPTION_SECRET` in the local composition is therefore still a compiled-in constant — shared by every install, trivially extractable. Feed this to `/security-review`. It is tolerable only while the profile file never leaves the machine; Phase 4c's export action changes that and must replace it with a per-profile secret.

## The landmine that will cost you a day if you ignore it

**`electron-vite` bundles the main process with esbuild/rollup, and esbuild does not emit decorator metadata.** NestJS dependency injection is built entirely on `emitDecoratorMetadata`. Bundling `AppLocalModule` through the default main-process pipeline will produce an app that builds cleanly and then fails at runtime with unresolvable dependencies — this exact failure was already hit in Phase 3 when booting Nest under `tsx`.

Therefore: **do not bundle the API.** Treat `@wimm/api` as external to the main-process bundle and ship the `tsc`-emitted output (which does emit metadata), loading it at runtime. Task 2 owns this decision; get it right there and Task 4's packaging follows from it.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scopes: `api`, `desktop`, `workspace`.
- **The hosted build must not change.** `apps/api/src/auth/route-posture.spec.ts` must stay green at 40 routes; the hosted renderer path must keep working.
- `apps/mobile` must not be touched.
- The API test suite stays **offline** — no PostgreSQL, no network, no Docker.
- **Baselines are floors, not targets.** `@wimm/api` **50 suites / 356 tests**, `@wimm/shared` **4 / 28**, `tsc --noEmit` clean, `pnpm build --force` and `pnpm lint --force` green, both drift guards pass, API suite green with PostgreSQL stopped. If your work adds tests the count going up is a gain — **never delete passing coverage to match a number.**
- Turbo caches `build`/`lint`/`test` and silently returns 0 from cache. Any repo-wide proof must use `--force`.
- Leave the tree on the **`node`** ABI, suite green.
- Ask before adding any top-level dependency.

---

## Task 1: The per-launch session token and the local auth guard

Right now the local composition has **no** authentication: `ProfileModule`'s middleware populates `req.user` unconditionally. Once that composition listens on a socket, every process on the machine — and every web page the user visits, via requests to `127.0.0.1` — can reach it. Loopback binding is not access control.

**Files:**
- Create: `apps/api/src/profile/session-token.ts` and its spec
- Create: `apps/api/src/profile/session-token.guard.ts` and its spec
- Modify: `apps/api/src/app.local.module.ts` (register the guard as `APP_GUARD`)

**Interfaces:**
- Produces: `generateSessionToken(): string` — cryptographically random, from `node:crypto`, never persisted to disk.
- Produces: `SessionTokenGuard`, registered as a global `APP_GUARD` on the local composition only.
- Consumes: the token value, supplied at module registration alongside `databaseFile`.

**Requirements:**

- Compare with a **timing-safe** comparison (`crypto.timingSafeEqual`), guarding against length mismatch throwing.
- Read the token from a **header**, never a query parameter. Query strings land in logs, in `Referer`, and in crash reports.
- **Never log the token**, and never include it in an error message.
- Reject with 401 when the header is missing, empty, or wrong.
- **Fail closed:** a route with no explicit exemption is protected. Follow the `@Public()` precedent in `apps/api/src/common/decorators/public.decorator.ts` if any local route genuinely needs exemption — and justify each one in the report rather than adding them for convenience.

- [ ] **Step 1: TDD the token and the guard**

- [ ] **Step 2: Register it and prove the local composition's posture**

Phase 3 established that inspecting decorators is not proof, and that a **tokenless** request cannot distinguish "the guard rejected me" from "`@CurrentUser()` threw its own 401". Both produce an identical 401.

So enumerate the **local** composition's routes the way `apps/api/src/auth/route-posture.spec.ts` does for the hosted one: boot `AppLocalModule`, `listen(0, '127.0.0.1')`, walk the router, and for every route assert **both**:
- no token → **401**
- correct token → **not 401**

The second assertion is the one with teeth. Without it the test passes even if the guard is not wired at all.

- [ ] **Step 3: Mutation proof — mandatory**

1. Unregister the guard. The correct-token assertion must fail, naming routes.
2. Replace the timing-safe comparison with `===`. A test must fail — if none does, you have not tested the comparison.
3. Revert both. Include verbatim output for each.

- [ ] **Step 4: Commit** — `feat(api): protect the local composition with a per-launch session token`

---

## Task 2: Boot the API inside Electron main

**Files:**
- Create: `apps/desktop/src/main/local-api.ts` and its spec
- Modify: the main-process entry to start it
- Modify: `apps/desktop/electron.vite.config.*` (keep the API external — see the landmine section)
- Modify: `apps/desktop/package.json` (depend on `@wimm/api` with `workspace:*` if that is the route chosen)

**Interfaces:**
- Produces: `startLocalApi(options: { profileDir: string }): Promise<{ port: number; token: string; close(): Promise<void> }>`

**Requirements:**

- `listen(0, '127.0.0.1')` — ephemeral port, loopback only. **Never `0.0.0.0`**, and never a fixed port.
- Read the actual assigned port off the server; do not assume.
- Generate the token per launch via Task 1's function; hold it in memory only.
- Resolve the profile directory in **main** (`app.getPath('userData')` + `profiles/`) and pass it in. `apps/api` must not import `electron`.
- **Ensure a profile exists before composing the module** — fact 4 means zero `User` rows is a hard boot failure. Use Phase 3's `profile-registry.ts` (`listProfiles`, `createProfile`, `profileDatabasePath`) and create the single `User` row. This is headless bootstrap only; the picker and onboarding UI are Phase 4c. If more than one profile exists, open the most recently used and record that Phase 4c will replace this with a picker.
- Apply the same migrations discipline the runner already provides: Phase 2's `migration-runner.ts` takes a pre-migration snapshot and applies transactionally. Wire it on open — a database opened by a newer build without migrating is how data gets corrupted.
- Close the server and disconnect Prisma on app quit. A leaked SQLite handle blocks the profile switch Phase 4c needs.

- [ ] **Step 1: Prove the bind is loopback-only — do not take it on faith**

`listen(0, '127.0.0.1')` is easy to write and easy to get wrong (a stray `0.0.0.0`, a framework default). Assert it: read the bound address from the server and confirm it is `127.0.0.1`, **and** attempt a connection to the same port on a non-loopback address of this machine and assert it is refused. A test that only checks the string you passed in proves nothing about what the kernel bound.

- [ ] **Step 2: TDD `startLocalApi`, then wire it into the main entry**

- [ ] **Step 3: Mutation proof — mandatory**

Change the bind to `0.0.0.0`. The loopback test must fail. Revert; include verbatim output.

- [ ] **Step 4: Commit** — `feat(desktop): boot the local api on an ephemeral loopback port`

---

## Task 3: Renderer wiring

**Files:**
- Modify: the preload script (expose the handshake)
- Modify: the renderer's axios instance
- Modify: the refresh-token interceptor

**Requirements:**

- **Mode comes from main**, over IPC — not from an env var the renderer reads, and not guessed. If main booted an embedded API it reports `{ mode: 'local', port, token }`; otherwise `{ mode: 'hosted' }` and the existing configured base URL is used unchanged.
- Expose the handshake through the **preload** with `contextIsolation` intact. Do not enable `nodeIntegration` in the renderer to make this easier — that would hand any rendered content full Node access, which is a far larger hole than the one the token closes.
- Set the axios base URL to `http://127.0.0.1:<port>` and the token as a default header. **The rest of the data layer must not change** — the same `/api/...` paths, the same React Query usage.
- The refresh-token interceptor becomes **inert** in local mode: there are no tokens to refresh, and a 401 there means a real bug, not an expired session. Do not let it retry or redirect to a login screen that local mode does not have.
- `CLAUDE.md` requires a **single** axios instance with the refresh interceptor. Do not add a second one — extend the existing instance.

- [ ] **Step 1: TDD the mode handling**, including that hosted mode is untouched.

- [ ] **Step 2: Prove it end to end**

Boot the packaged-or-built app in local mode and confirm the renderer actually loads data from the embedded API — with the layout-independent DOM check Phase 4a established (`textContent`, not `innerText`: `innerText` reads **empty** on an unpainted window and will look like a broken app).

- [ ] **Step 3: Mutation proof** — force the token header off and confirm the renderer surfaces a real failure rather than silently rendering empty state. Verbatim output.

- [ ] **Step 4: Commit** — `feat(desktop): point the renderer at the embedded api in local mode`

---

## Task 4: Package it (moved here from Phase 4a)

Two facts from the current `apps/desktop/package.json` `build` block make this real work rather than a flag flip:

- `files` is `["out/**/*", "package.json"]` — **no `node_modules`**. Nothing native is packaged today.
- `asar: true` — a `.node` file **cannot be loaded from inside an asar archive**. It must be unpacked.

Plus `apps/api` must actually reach the bundle, as `tsc` output rather than a rollup bundle (the landmine section).

- [ ] **Step 1: Update `files`, add `asarUnpack` for `*.node`, and include the API's built output.**

- [ ] **Step 2: Prove it by running a packaged build — a config review is not proof**

```bash
pnpm --filter @wimm/desktop run package
```

Then launch the **packaged** application and confirm it opens a SQLite profile and the renderer loads data. A `.node` inside asar, or missing decorator metadata, fails only at runtime — on a user's machine.

Note that `native-abi-guard` is inert in a packaged app by design (fact 2), so the packaged app relies on `electron-builder`'s own native rebuild. **Verify that actually happened** rather than assuming: confirm the shipped `.node` loads under the packaged Electron.

- [ ] **Step 3: Commit** — `chore(desktop): package the api and native sqlite module`

---

## Task 5: Verification and security review

- [ ] `@wimm/api` ≥ 50 suites / 356 tests, with PostgreSQL **stopped**.
- [ ] `@wimm/shared` ≥ 4 / 28.
- [ ] `route-posture.spec.ts` green at 40 routes — hosted build untouched.
- [ ] The **local** composition's posture proven: every route 401s without the token and does not 401 with it.
- [ ] The listener is bound to `127.0.0.1` and refused on a non-loopback address — proven by connection attempt.
- [ ] `pnpm build --force && pnpm lint --force`; both drift guards.
- [ ] `apps/desktop/scripts/verify-native-runtime.ts` passes under Electron.
- [ ] A **packaged** build opens a profile and loads data in the renderer.
- [ ] Tree on the `node` ABI, suite green, `git status` clean.

- [ ] **Run `/security-review` over the phase's changes.** Surface every finding to the user with your assessment; do not silently accept or silently fix. Give it at minimum:
  - the compiled-in `AI_KEY_ENCRYPTION_SECRET` (fact 7),
  - the loopback listener and the token scheme,
  - DNS-rebinding exposure: a web page can resolve a hostname it controls to `127.0.0.1` and issue requests. Reason about whether the token, the `Host` header, and the CORS configuration actually close that, and state the conclusion rather than assuming the token is sufficient,
  - the preload surface and `contextIsolation`,
  - whether the token can reach a log, a crash report, or a URL.

## Exit criteria

- The desktop app boots its own API on an ephemeral loopback port and the renderer uses it over the existing `/api/...` paths.
- Every local route rejects a tokenless request and accepts a correctly-tokened one — proven by enumeration against a booted server, not by inspection.
- The listener is provably unreachable off loopback.
- A packaged build — not only a dev build — opens a profile and renders real data.
- The hosted build is unchanged.
- `/security-review` has run and every finding is resolved or explicitly accepted by the user.

## Deferred to Phase 4c

Onboarding and the profile picker UI, teardown-and-rebuild on profile switch, export-profile and restore-from-backup (D8), and — **blocking for 4c** — replacing the compiled-in `AI_KEY_ENCRYPTION_SECRET` with a per-profile random secret, since export is what lets the profile file leave the machine.
