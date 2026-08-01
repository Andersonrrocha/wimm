# Phase 4c — Profile Lifecycle and Data Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who has never seen WIMM can install it, create a profile, switch between profiles, export one, and restore a backup — without any path that can silently lose or leak their financial history.

**Architecture:** Electron main owns the profile lifecycle: it resolves the profile directory, decides between onboarding / direct open / picker, and tears down and rebuilds the Nest application when the active profile changes. The API stays Electron-free; every path is injected. The compiled-in AI encryption secret is replaced by a per-profile random secret before export can carry a profile off the machine.

**Tech Stack:** Electron 43, NestJS 10, Prisma 7.7 with driver adapters, `better-sqlite3`, React 18.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scopes: `api`, `desktop`, `database`.
- User-facing strings need **both** `en` and `pt` i18n resources — those two locales only.
- **The hosted build must not change.** `route-posture.spec.ts` stays green at 40 routes.
- `apps/mobile` must not be touched.
- The API test suite stays **offline** — no PostgreSQL, no network beyond loopback, no Docker.
- **Baselines are floors, not targets:** `@wimm/api` **53 suites / 397 tests**, `@wimm/desktop` **38**, `@wimm/shared` **34**. Tests going up is a gain — **never delete passing coverage to match a number.**
- Turbo caches `build`/`lint`/`test` and silently returns 0 from cache. Any repo-wide proof must use `--force`.
- Running anything under Electron needs `npx tsx scripts/select-native-abi.ts electron`; **leave the tree on `node`**, suites green.
- Ask before adding any dependency.

## Facts established earlier — do not re-derive

1. **`ProfileModule` refuses to boot** with zero `User` rows or more than one (deliberate, Phase 3). Onboarding must guarantee that row exists *before* the module is composed.
2. **`AppLocalModule.forRoot` refuses** without a non-empty `sessionToken`.
3. **`restoreSnapshot` refuses** when it cannot get exclusive access to the target — but it only detects a connection genuinely mid-transaction, **not** an idle open handle. "Close the connection first" remains a requirement, not a suggestion.
4. **`applyPendingMigrations` refuses** a database migrated by a newer build, throwing `DatabaseMigratedByNewerBuildError` with a stable `code` (`DATABASE_MIGRATED_BY_NEWER_BUILD`). Detect by that code, never by message text.
5. **`checkDatabaseHealth(file)`** returns `{ healthy, problem }` and does not throw — it exists for a UI to display.
6. **`snapshotDatabase`** skips writing when the newest snapshot is already byte-identical, so a crash loop cannot consume the retention window.
7. **`profile-registry.ts`** provides `listProfiles`, `createProfile`, `touchProfile`, `profileDatabasePath`. A **missing** registry means "no profiles"; a **corrupt** one throws naming the file and the entry. Unknown fields on entries are preserved across writes.
8. **The IPC bridge validates in main**: path must be a same-origin absolute path, method and headers are allowlisted, the resolved origin is asserted. Renderer-side checks do not count as a boundary.
9. **`innerText` reads empty on an unpainted window.** Every DOM assertion uses `textContent`.
10. **`@CurrentUser()` throws its own 401** when `request.user` is absent. It has masked three different root causes across this project. A tokenless request proves nothing on its own.

---

## Task 1: Per-profile encryption secret

**This is the phase's blocking security item and it must land before export exists.** Retrofitting it afterwards means migrating profiles that have already left the machine.

`AI_KEY_ENCRYPTION_SECRET` in `apps/api/src/app.local.module.ts` is currently a constant compiled into every build (`LOCAL_AI_KEY_ENCRYPTION_SECRET`). Every installation shares it and anyone can extract it with `strings`. Today that is obscurity rather than a boundary — the rest of the SQLite file is plaintext. Task 4 changes that: an exported profile handed to support, a backup service, or a synced folder leaks the user's BYOK provider key.

**Files:**
- Create: `apps/api/src/prisma/local/profile-secret.ts` + spec
- Modify: `apps/api/src/app.local.module.ts` (take the secret as an option instead of the constant)
- Modify: `apps/desktop/src/main/local-api.ts` (resolve/create it per profile and pass it in)

**Design points:**
- Generate with `node:crypto`, at least 32 bytes of entropy, stored **per profile**.
- Decide deliberately **where** it lives and justify it: alongside the profile in the registry, or in a sibling file. It must travel with the profile if and only if that is what you intend for export — think this through and state the reasoning, because Task 4 will copy the database file.
- An existing profile has data encrypted with the old constant. Migrate on open: decrypt with the old constant, re-encrypt with the new secret. `AiKeyResolverService` already treats a decrypt failure as "no key", so a failed migration degrades to AI-off rather than crashing — but **do not rely on that as the plan**; migrate properly and prove it.
- Follow the house contract: verify, then refuse loudly. `open-local-database.ts` is the reference.

- [ ] **Step 1: TDD the secret's generation, persistence and retrieval.**
- [ ] **Step 2: TDD the migration path** — a profile written with the old constant must come out readable, with the key intact, and re-encrypted under the new secret.
- [ ] **Step 3: Mutation proof.** Break the migration so it silently drops the key; a test must fail. Replace the per-profile secret with a constant again; a test must fail. Revert both, verbatim output for each.
- [ ] **Step 4: Commit** — `feat(database): give each profile its own ai key encryption secret`

---

## Task 2: Onboarding and the profile picker

Today `local-api.ts` silently creates a profile behind the user's back and opens the most recently used when several exist. That is scaffolding.

**Files:**
- Modify: `apps/desktop/src/main/local-api.ts` (stop auto-creating; report the profile situation)
- Create: renderer screens for onboarding and picking
- Modify: preload + IPC to expose the profile list and the create/open actions

**Behaviour:** no profiles → onboarding creates the first one. Exactly one → open it. More than one → picker.

**Design points:**
- Fact 1 means the `User` row must exist before `ProfileModule` is composed. Decide where that happens and make it impossible to reach the module without it.
- A **corrupt** registry (fact 7) must never be shown as "no profiles yet" — that would offer a fresh-start screen to someone with years of data. Surface it as the error it is, using `checkDatabaseHealth` where a specific database is suspect.
- Profile names are user input. Decide what is allowed, and make sure a name can never influence a filesystem path — `dbFileName` derives from the caller-supplied `id`, not the name, and it must stay that way.
- The renderer talks to main over IPC (fact 8). Anything new you expose is a new boundary: validate in main.

- [ ] **Step 1: TDD main's decision logic** — zero / one / several / corrupt — as a pure function over the registry, before any UI.
- [ ] **Step 2: Build the screens**, with `en` + `pt` strings.
- [ ] **Step 3: Prove it end to end** — fresh `--user-data-dir`, packaged code under Electron, `textContent` dump to a file (fact 9): onboarding appears, creating a profile lands in the app.
- [ ] **Step 4: Mutation proof.** Make the corrupt-registry path fall through to onboarding; a test must fail. Revert. Verbatim output.
- [ ] **Step 5: Commit** — `feat(desktop): add profile onboarding and the picker`

---

## Task 3: Profile switching

**Files:**
- Modify: `apps/desktop/src/main/local-api.ts` (teardown and rebuild)
- Modify: renderer (a way to switch)

**Design points:**
- **Hard requirement (Phase 2 review):** close the connection before the file is touched. Tear down the Nest app and disconnect Prisma, then open the new profile. Fact 3 means a leaked handle turns `restoreSnapshot` into a refusal later — the teardown has to actually happen, and you must prove it does.
- The session token is per launch, not per profile. Decide whether switching rotates it and justify the answer.
- A failed switch must leave the user somewhere usable — not a blank window and not the login screen, which local mode does not have. Task 3 of Phase 4b built a `local-backend-error` surface; reuse it.

- [ ] **Step 1: TDD teardown** — prove the old database handle is genuinely released, e.g. by acquiring an exclusive lock on the old file after switching. A test that only checks a flag proves nothing.
- [ ] **Step 2: Wire the UI.**
- [ ] **Step 3: Mutation proof.** Skip the teardown; the exclusive-lock assertion must fail. Revert. Verbatim output.
- [ ] **Step 4: Commit** — `feat(desktop): switch profiles by tearing down and rebuilding the api`

---

## Task 4: Export profile and restore from backup

**Files:**
- Modify: main (export and restore actions), renderer (Settings entries)
- Modify: `apps/api/src/prisma/local/snapshot.ts` (the two carry-overs below)

**Behaviour (D8):** export copies the active profile's `.db` to a user-chosen location via `dialog.showSaveDialog`. Restore lists `userData/backups/` snapshots with timestamps and lets the user pick one.

**Fold in three recovery carry-overs — they exist to make this UI possible:**
- **Preservation copies are unreachable by any exported API.** A restore UI needs to offer them as a clearly-labelled last resort. Export a way to list them.
- **`SnapshotInfo` has no schema version.** Someone choosing among five backups cannot be told which predate the update that broke things — the only question they actually have. Add it.
- **The newer-database refusal (fact 4)** already shows a dialog. Now that restore exists, make that dialog point at it.

**Design points:**
- Restore overwrites the live database. Fact 3: close first. Reuse Task 3's teardown rather than writing a second one.
- Export copies a file containing the user's financial history **and** their BYOK key encrypted under Task 1's per-profile secret. Whether that secret travels with the export is the decision Task 1 made — honour it here and make the consequence visible to the user in the UI copy if the export is portable.

- [ ] **Step 1: TDD the snapshot API additions** (listing preservation copies, schema version).
- [ ] **Step 2: Build export**, then restore.
- [ ] **Step 3: Prove restore end to end** — write a recognisable row, snapshot, change the data, restore, confirm the original row is back. Through the real service, not a mock.
- [ ] **Step 4: Mutation proof.** Skip the teardown before restore and confirm the refusal fires rather than silent corruption. Revert. Verbatim output.
- [ ] **Step 5: Commit** — `feat(desktop): add profile export and restore from backup`

---

## Task 5: Verification

- [ ] `@wimm/api` ≥ 53 suites / 397 tests, with PostgreSQL **stopped**.
- [ ] `@wimm/desktop` ≥ 38; `@wimm/shared` ≥ 34.
- [ ] `route-posture.spec.ts` green at 40 routes; the local posture spec green at 36.
- [ ] `pnpm build --force && pnpm lint --force`; `assert:parity`.
- [ ] The packaged code, from a directory with **no ancestor `package.json`**, renders onboarding on a fresh profile.
- [ ] A full manual pass: create → switch → export → restore, each verified by `textContent`.
- [ ] Tree on the `node` ABI, clean.

## Exit criteria

- A person with no technical knowledge can create a profile, switch between two, export one, and restore a backup.
- No profile's data can be silently lost: a corrupt registry is never mistaken for a fresh start, and a restore over an open handle is refused rather than attempted.
- The AI encryption secret is per-profile and random; no build ships a shared constant.
- Every failure path lands somewhere a person can act on, never a blank window and never a login screen.

## Deferred, deliberately

Registry **schema versioning** — a future version that renames or drops a required field still bricks the whole registry for an older build. Tolerating unknown fields is done; renames are not. It needs a version field and a migration path, and it is a bigger design question than this phase should absorb. Record it, do not solve it here.
