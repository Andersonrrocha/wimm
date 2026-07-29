# Phase 4a — Electron Runtime Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app runs on an Electron version where `better-sqlite3` actually works, the two-ABI reality is handled automatically and fails loudly instead of silently, and native modules are packaged correctly enough that a built app can open a SQLite profile.

**Architecture:** Electron is upgraded past the version where `new Database()` segfaults. The root `better-sqlite3` (v13, N-API) then needs no rebuild at all; the copy Prisma's adapter pins (v12, pre-N-API) is compiled once per runtime, cached, and selected by a script wired into the npm lifecycle. A boot-time guard reads a marker file and refuses to continue on a mismatch, so a forgotten swap is an actionable error rather than a crash.

**Tech Stack:** Electron, electron-vite, electron-builder, `better-sqlite3`, `@prisma/adapter-better-sqlite3`, TypeScript 5.5.

## Why this phase exists — facts established by probe, do not re-derive

All of the following was measured directly on this machine. Do not re-litigate it.

1. **`better-sqlite3` 13.0.1 segfaults inside old Electron.** `require()` succeeds; `new Database(':memory:')` raises **SIGSEGV**. The process aborts, so no `try/catch` can turn it into a friendly message.

   | Electron | ABI | Result |
   |---|---|---|
   | 31.3.1 (current) | 125 | SIGSEGV |
   | 32.3.3 | 128 | SIGSEGV |
   | 34.5.8 | 132 | SIGSEGV |
   | **35.7.5** | 133 | **OK** ← floor |
   | 36.9.5 | 135 | OK |
   | 37.10.3 | 136 | OK |
   | 43.2.0 | 148 | OK |

2. **Electron renumbers its own ABI.** Electron 31 reports `node=20.15.1` but `process.versions.modules === 125`, while stock Node 20 is 115 and this machine's Node 22 is 127. Electron's ABI never equals stock Node's. Do not look for a version that matches.

3. **Two `better-sqlite3` copies exist and they behave differently.**
   - `node_modules/better-sqlite3` **13.0.1** — depends on `node-addon-api ^8`, is true N-API, ships `prebuilds/`. **ABI-portable: needs no rebuild for Electron ≥ 35.** This is what `open-local-database.ts`, `snapshot.ts` and `migration-runner.ts` use.
   - `node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3` **12.11.1** — depends on `bindings` + `prebuild-install`, **not** `node-addon-api`. Pre-N-API, built from source, tied to `NODE_MODULE_VERSION`. **Needs a rebuild per runtime.** This is what Prisma actually executes at runtime, so `LocalPrismaService` depends on it.

4. **The v12 copy cannot be eliminated.** `@prisma/adapter-better-sqlite3` hard-pins `better-sqlite3: ^12.6.0`, and **7.9.1 is the latest published adapter** — no newer version accepts v13.

5. **Both rebuild directions work and are reversible.** Verified:
   - `npx @electron/rebuild -v 37.10.3 -m apps/api -o better-sqlite3 -f` → the v12 copy loads and queries under Electron 37.
   - `npx node-gyp rebuild` inside that package directory → restores the Node build; the API suite returns to 49/344.

6. **`electron-rebuild` lies about what it touched.** It printed `✔ Rebuild Complete` while leaving the root v13 `prebuilds/` byte-identical, having silently rebuilt only the v12 copy. Never trust its summary; always verify which artifact changed.

7. **Writing our own Prisma driver adapter over v13 was considered and rejected.** The adapter is ~666 lines, much of it SQLite column-type inference. Getting that subtly wrong returns *wrong values* rather than errors — the worst failure class for financial data. Keeping Prisma's adapter is the deliberate choice.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scopes: `desktop`, `workspace`, `database`.
- **The API test suite must stay offline** — no PostgreSQL, no network, no Docker — and must keep passing at its current count. Baseline: `@wimm/api` **49 suites / 344 tests**, `@wimm/shared` **4 suites / 28 tests**, `tsc --noEmit` clean, `pnpm build --force` and `pnpm lint --force` green, both drift guards pass.
- **The hosted build's behaviour must not change.** `apps/api/src/auth/route-posture.spec.ts` must stay green at 40 routes.
- `apps/mobile` must not be touched.
- Turbo caches `build`, `lint` and `test`. **Any proof must use `--force`** or it can return 0 without executing.
- Ask before adding a top-level dependency beyond the ones this plan names explicitly (`@electron/rebuild` is approved by this plan; anything else is not).

---

## Task 1: Upgrade Electron and its toolchain

The current toolchain (`electron` 31.3.1, `electron-vite ^2.3.0`, `electron-builder ^24.13.3`, `vite ^5.4.0`) is contemporary with Electron 31. Jumping to 43 will very likely require moving `electron-vite`, `electron-builder` and `vite` too.

**Target: Electron `43.2.0`.** It is inside Electron's 3-major security-support window, which matters for a publicly distributed finance app. **Documented fallback: `37.10.3`**, which is already proven end-to-end for both native copies — if the toolchain cannot be made to work on 43 within this task, fall back to 37, say so explicitly, and record what failed. Do **not** silently settle for a lower version.

**Files:**
- Modify: `apps/desktop/package.json` (devDependencies)

- [ ] **Step 1: Upgrade and install**

Move `electron` to `43.2.0`, and `electron-vite`, `electron-builder` and `vite` to their current majors. Add `@electron/rebuild` as a devDependency of `apps/desktop` — Task 3 needs it.

- [ ] **Step 2: Prove the existing app still builds and boots**

This is the load-bearing step. Run:

```bash
pnpm --filter @wimm/desktop run build
```

Then boot the built app and confirm the main window actually renders — not merely that the process started. A blank window is a failure.

`electron-vite` and `electron-builder` majors carry breaking config changes. Read their changelogs for the versions you land on rather than guessing at config keys.

- [ ] **Step 3: Confirm nothing else regressed**

```bash
pnpm --filter @wimm/desktop run lint
pnpm build --force && pnpm lint --force
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore(desktop): upgrade electron and build toolchain"
```

**Report:** the exact versions landed on, whether 43 or the 37 fallback, what config changes each upgrade forced, and the evidence the window rendered.

---

## Task 2: Prove both native copies work inside the upgraded Electron

Task 1 proves the app boots. This task proves the thing the whole phase depends on: that a **real Prisma query** runs against SQLite **inside Electron's main process**.

**Files:**
- Create: `apps/desktop/scripts/verify-native-runtime.ts` (a checked-in diagnostic, not a throwaway)

**Interfaces:**
- Produces: a script runnable as `electron apps/desktop/scripts/verify-native-runtime.ts` that exits non-zero with a readable report on any failure.

Why checked in rather than throwaway: this is the exact check a contributor on a new platform will need, and the exact check CI will need when the native-module build matrix arrives. A throwaway script means re-deriving it under pressure.

- [ ] **Step 1: Write the verification**

It must, inside the Electron main process, in order:
1. Report `process.versions.electron` and `process.versions.modules`.
2. Load the **root v13** copy, open `:memory:`, create a table, insert, read back, close.
3. Load the **v12 copy** by absolute path (`node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3` — a bare specifier is blocked by the adapter's `exports` map), and do the same.
4. Construct `PrismaBetterSqlite3` against a temp database built from `apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql`, drive the **generated SQLite client**, `create` a `User`, `count()` it, and `$disconnect()`.

**Write results to a file, not stdout.** A SIGSEGV kills the process before stdout flushes — that is how the original bug hid. Take the path from an env var or argv.

Real values, so no turns are wasted guessing: `Source.type` ∈ `BANK_ACCOUNT | CREDIT_CARD | CASH | MANUAL`; `Transaction.kind` ∈ `INCOME | EXPENSE`; `Transaction` has **no** `status` field.

The generated client at `apps/api/src/generated/prisma-sqlite/client` is **TypeScript** — a plain `require` of that path fails with "Cannot find module". Resolve this deliberately: either point at compiled output or register a TS loader. Say which you chose.

- [ ] **Step 2: Run it and record the output**

Expect step 4 to be the one that fails first if anything is wrong. Do not stop at step 2 passing.

- [ ] **Step 3: Mutation proof**

Point the v12 require at a deliberately wrong path and confirm the script **exits non-zero** and names the failure. A diagnostic that reports success on a broken runtime is worse than none.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): add a native runtime verification script"
```

**Report:** the verbatim script output, how you resolved the TypeScript client import, and the mutation result.

---

## Task 3: Automatic, loud ABI selection

Fact 3 means the v12 artifact can exist for exactly **one** runtime at a time in a single `node_modules` tree. Tests need the Node build; the running app needs the Electron build.

The scope is narrower than it first appears: `electron-builder` rebuilds native dependencies at package time in its own staging area, so **packaged builds are already correct**. The only conflict is `electron-vite dev`.

**Files:**
- Create: `scripts/select-native-abi.ts` (repo root)
- Create: its spec
- Modify: `apps/desktop/package.json` and `apps/api/package.json` (lifecycle scripts)

**Interfaces:**
- Produces: `selectNativeAbi(target: 'node' | 'electron'): void`, plus a CLI entry point.
- Produces: a marker file recording which ABI is currently active, readable by the guard in Step 3.

- [ ] **Step 1: Build both artifacts once and cache them**

Compile the v12 copy for Node (`node-gyp rebuild`) and for Electron (`@electron/rebuild -v <version>`), storing each result outside `build/Release` so neither is destroyed by the other. Selecting an ABI is then a file copy plus a marker write — instant, not a 30-second rebuild. A mechanism slow enough to be annoying is a mechanism people work around.

Cache location must be git-ignored.

- [ ] **Step 2: Wire it into the lifecycle**

- `pretest` in `apps/api` → select `node`
- `predev` in `apps/desktop` → select `electron`

Selecting the already-active ABI must be a no-op, not a rebuild.

- [ ] **Step 3: The loud guard**

Add a guard that runs when the local runtime opens a database and, on mismatch between the marker and the current runtime, **throws a message naming the mismatch and the exact command to fix it**. Follow the tone already established in `apps/api/src/prisma/local/open-local-database.ts`: set, verify, refuse.

This guard is the actual safety net. The swap mechanism can be forgotten; the guard is what turns that from a SIGSEGV into a sentence a human can act on.

- [ ] **Step 4: Mutation proof — mandatory**

1. Select the `electron` ABI, then run the API suite. It must fail **with the guard's message**, not with a segfault or a raw `NODE_MODULE_VERSION` error.
2. Select `node`, run the suite. It must pass at 49/344.
3. Delete the marker file. The guard must refuse rather than assume a default.

Include the verbatim output of all three.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(workspace): select the native sqlite abi per runtime with a boot guard"
```

---

## Task 4: Package native modules into the built app

**Files:**
- Modify: `apps/desktop/package.json` (`build` section)

Two facts from the current config make this real work rather than a flag flip:

- `files` is `["out/**/*", "package.json"]` — **no `node_modules`**. Nothing native is packaged today because the desktop app has had no native dependency.
- `asar: true` — `.node` files cannot be loaded from inside an asar archive. They must be unpacked.

Additionally, `apps/api` is **not** a dependency of `apps/desktop`. Embedding the API means the packaged app must actually contain it. Decide how (workspace dependency, or bundling through `electron-vite`) and record the reasoning — the choice constrains Phase 4b.

- [ ] **Step 1: Update the packaging config**

Ensure the native module reaches the app and that `*.node` is unpacked from asar.

- [ ] **Step 2: Prove it with a packaged build — not a config review**

```bash
pnpm --filter @wimm/desktop run package
```

Then run the **packaged** application and have it open a SQLite database through the same path Task 2 verified. Reading the config and concluding it looks right is not proof; a `.node` inside asar fails only at runtime, on a user's machine.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(desktop): package the native sqlite module outside asar"
```

---

## Task 5: Verification

- [ ] `apps/api` 49 suites / 344 tests, with the PostgreSQL container **stopped**.
- [ ] `@wimm/shared` 4 / 28.
- [ ] `route-posture.spec.ts` green at 40 routes — the hosted build is untouched.
- [ ] `pnpm build --force && pnpm lint --force`.
- [ ] Both drift guards (`assert-schema-parity.ts`, `assert-check-constraints.ts`).
- [ ] `git diff --name-only` touches only `apps/desktop`, `scripts/`, root config, and `apps/api/package.json`. **No `apps/api/src` source file changes** beyond the guard added in Task 3.
- [ ] The Task 2 verification script passes under the upgraded Electron.
- [ ] A packaged build opens a SQLite profile.

## Exit criteria

- The desktop app runs on an Electron version where `better-sqlite3` works, and which version that is, and why, is written down.
- A real Prisma query against SQLite has run inside Electron's main process — proven by a checked-in script, not by inspection.
- Selecting the wrong ABI produces a message telling a human what to run, never a segfault.
- The API test suite still passes offline at its full count, with the ABI mechanism in place.
- A packaged build — not just a dev build — opens a SQLite database.

## Deliberately out of scope

Phase 4 as specified bundles far more than this. Split out, to keep each plan's deliverable independently working:

- **Phase 4b — Embedded API:** Nest booting in Electron main on `listen(0, '127.0.0.1')`, the per-session token, the IPC port handshake, the renderer's axios base URL and default header, and making the refresh-token interceptor a no-op in local mode. **`/security-review` gates this phase** — it introduces the network listener and a new authentication surface.
- **Phase 4c — Profile lifecycle and data safety:** onboarding when there are no profiles, the picker when there are several, teardown-and-rebuild on switch, running Phase 2's migration runner on open, and the export-profile / restore-from-backup actions from D8.

Two carry-overs from Phase 3 land in 4c and must not be lost: `ProfileModule` **fails to boot** when its database has zero `User` rows, so onboarding must guarantee that row before the module is composed; and `AI_KEY_ENCRYPTION_SECRET` is currently a compiled-in constant, which is acceptable only while the profile file never leaves the machine — the export action in 4c is exactly what changes that, so it needs a per-profile random secret.
