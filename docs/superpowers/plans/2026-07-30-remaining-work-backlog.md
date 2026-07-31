# WIMM — Remaining Work and Sequenced Plan

Written 2026-07-30, after Phase 4b closed. Branch `architecture-backend-independence-6a7d8a`, 96 commits ahead of `develop`.

**State today:** `@wimm/api` 53 suites / 397 tests (green with PostgreSQL stopped), `@wimm/desktop` 38, `@wimm/shared` 28. The packaged app boots its embedded API, creates a profile, and renders real data — verified from a directory with no ancestor `package.json`, which is what a real `/Applications` install looks like.

**The goal this plan serves:** friends and family can install WIMM and use it, and it stands up as a portfolio piece. Everything below is ordered by what that goal actually requires, not by what is technically interesting.

---

## The critical path, in one line

**4c** (a person can create and manage a profile) → **7** (a person can install it at all) → **5** (a person's own bank statements import) → **6** (AI is pluggable). Everything else is debt that gets folded into whichever of these touches its code.

---

## Phase 4c — Profile lifecycle and data safety

**Why first:** without it there is no onboarding, no way to choose or switch a profile, and no way to get your data out. The app works only because a headless bootstrap silently creates a profile behind your back. That is scaffolding, not a product.

**Contains the one blocking security item.**

### 4c.1 — Per-profile encryption secret *(blocking, do before export ships)*
`AI_KEY_ENCRYPTION_SECRET` in `app.local.module.ts` is a constant compiled into every build. Today it protects nothing — it is obscurity against a glance, and the rest of the SQLite file is plaintext anyway. The security review classified it Informational **for now** and blocking for this phase, and that is right: export is what lets the profile file leave the machine. Handed to support, a backup service, or a synced folder, it leaks the user's BYOK provider key to anyone who runs `strings` on the app.

Generate a random secret per profile, store it with the profile, and migrate any existing profile on open. A wrong secret already degrades gracefully to "AI off" (`AiKeyResolverService` treats a decrypt failure as no key), so the migration path is forgiving.

### 4c.2 — Onboarding and the profile picker
No profiles → onboarding creates one. Exactly one → open it. More than one → picker. Replaces the headless bootstrap in `local-api.ts`, which currently opens the most recently used and leaves a comment saying this phase owns it.

**Precondition from Phase 3:** `ProfileModule` refuses to boot with zero `User` rows or more than one. Onboarding must guarantee that row exists *before* the module is composed, or the app fails to boot with no UI to explain it.

### 4c.3 — Profile switching
Tear down the Nest app and re-instantiate against the new file. **Hard requirement from the Phase 2 review:** close the connection before restoring or switching — overwriting a SQLite file under an open handle is undefined. `restoreSnapshot` now refuses when it cannot get an exclusive lock, so a leaked handle turns into a refusal rather than corruption, but the teardown still has to actually happen.

### 4c.4 — Export profile and restore from backup (D8)
Two Settings actions through main: `dialog.showSaveDialog` then copy the profile's `.db`; and listing `userData/backups/` snapshots by timestamp for restore. This is what makes `userData/profiles/` an acceptable storage location for a non-technical user.

**Fold in three recovery-path carry-overs here** — they exist precisely to make this UI possible, and building the UI without them means building it twice:
- **Preservation copies are unreachable by any exported API.** A restore UI needs to offer them as a clearly-labelled last resort.
- **`SnapshotInfo` has no schema version.** Someone choosing among five backups cannot be told which predate the update that broke things — which is the only question they actually have.
- **Silent downgrade acceptance.** An older app over a newer database now refuses (`DATABASE_MIGRATED_BY_NEWER_BUILD`), and main shows a dialog. Verify that dialog actually names restore-from-backup as the way out, now that restore exists.

**Done when:** a person with no technical knowledge can create a profile, switch between two, export one to their Desktop, and restore a backup — and none of those paths can corrupt the file.

---

## Phase 7 — Distribution

**Why second:** until this is done, nobody but you can run WIMM. It is the difference between "works on my machine" and "friends and family can use it".

### 7.1 — Real signing and notarization
The `.app` cannot be launched on this machine at all: `GatekeeperPolicyScanError -67018`, repeating `Error checking with notarization daemon: 3`, reproduced against a **stock** Electron template carrying only a large `app.asar`. Not our code, not our config, not our signature — but also **unproven end to end**, and it stays unproven until a Developer ID certificate and real notarization exist.

This is the single largest remaining unknown in the project. Everything else has been verified; this has not.

`after-sign.cjs` already refuses to clobber a real identity when auto-discovery is on — that guard was added for exactly this moment and should be exercised, not trusted.

### 7.2 — Package size
483 MB. The floor is ~460 MB: Electron Framework (275 MB) plus Prisma, `pdfjs-dist`, `pdf-parse` and `@napi-rs` (~185 MB) — all genuine runtime dependencies. For an auto-updating app this ships on every release.

Worth investigating whether the PDF stack can be loaded lazily or replaced, since it is the only large piece that is not structurally required. Decide deliberately; do not assume it can be cut.

### 7.3 — Updater
`electron-updater` is already a dependency and publishes to GitHub. Untested against a real signed build. Test it *after* 7.1, since an updater that installs an unsignable build is worse than none.

### 7.4 — Windows and Linux
`renameSync` atomicity over an existing file has different semantics on Windows, and the atomic-write pattern in `snapshot.ts` and `profile-registry.ts` depends on it. Untested. The native module also needs per-platform builds — the `verify-dependency-graph` check added in 4b will catch a broken bundle, but only on a machine that builds one.

**Done when:** you can send a friend a link, they install it, it opens, and it updates itself.

---

## Phase 5 — Parser registry and generic CSV mapper

**Why third:** the moment someone else uses WIMM, their bank is not your bank. Today the importers cover CSV, OFX, Banrisul credit-card PDF and Cresol statement PDF. A generic CSV column-mapper is what turns "works for Anderson" into "works for whoever shows up".

Highest product leverage per unit of effort of anything left, but it is worth nothing until 4c and 7 let someone open the app.

---

## Phase 6 — `AiProvider` contract

BYOK is staying (your decision). Making the provider pluggable behind a contract is what lets the hosted build keep its ChatGPT OAuth while the public build ships without it.

Note the standing constraint: ChatGPT OAuth stays **only** in the personally-hosted version, never in the public build.

---

## Standing debt, folded into whichever phase touches it

Not scheduled on its own — each item is cheapest to fix while already in that code.

| Item | Fold into | Why it matters |
|---|---|---|
| Registry has no schema version — renaming or dropping a required field bricks every profile for an older build | **4c** (touching the registry anyway) | The one unfixed data-loss path. Tolerating unknown fields is done; renames are not. |
| No file locking on `profiles.json` | **4c.3** (switching is when concurrency appears) | Two instances are already prevented by the single-instance lock, so this is second-line. |
| `foreign_key_check` full-scans every table inside the batch transaction, never measured against a multi-year history | **7** (real-world data volumes) | It holds the boot open for its duration. Measure before someone with 5 years of transactions finds out. |
| `@CurrentUser()` throws its own 401, masking guard and middleware failures | Documented; **no fix** | Appeared **three times** masking three different root causes. Its behaviour is correct; the trap is in tests. Anyone editing `current-user.decorator.ts` must know. |
| No throttler on the local composition | Accepted | An unauthenticated caller can spin the body parser and a SHA-256 per request. Rejected as not worth the complexity for a loopback listener behind a token. |

---

## Repository hygiene — do these whenever, they are cheap

1. **Branch divergence, needs your decision.** `develop` carries `a099e7e` "drop byok", and you chose to keep BYOK. A naive merge produces a half-removed BYOK. Someone must explicitly revert that commit on `develop` or drop BYOK here. It will not resolve itself.
2. **Merge target is `develop`, not `main`.** `main` is an Initial commit with one file.
3. **The Vercel plugin hooks fire constantly on false positives** — `apps/api/**` matches "vercel-functions" and "next-forge", the word "vite" inside prose matched a Next.js skill, "sandbox" matched another. They inject "MANDATORY: read these docs" into nearly every operation in this repo. Worth disabling for this project.
4. **The "small items batch"** you mentioned before Phases 3 and 4 — I never enumerated it and do not have a definition of what it contained. If you still want it, tell me what was on it.

---

## What I would actually do next

Start **4c.1** — the per-profile secret. It is small, it is the only item the security review classified as blocking, and it must land before export exists rather than after, because retrofitting it means migrating profiles that already leaked.

Then **4c.2 → 4c.3 → 4c.4** in order, since each depends on the previous, folding in the three recovery-path carry-overs when 4c.4 builds the restore UI.

Then stop and reassess before Phase 7. Signing and notarization is the one place where I cannot verify the result myself, and it needs a real Apple Developer account before it is worth planning in detail.

---

## A note on method, from the sessions that produced this

Thirteen times across Phases 0–4b a verification passed without being able to fail. The expensive ones: a tokenless route test cannot detect a removed guard; the cascade test the plan prescribed passed with all the pragma code deleted; and the security review demolished a property I had asserted confidently, because I had designed a boundary and then verified the wrong side of it.

Every one was caught the same way — by requiring each fix to break on purpose and confirming the check screamed. None was caught by reading code more carefully.

Keep the mutation-proof requirement in every task brief.
