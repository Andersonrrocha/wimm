# WIMM — Desktop Completion Program

Written 2026-08-03, after Phase 4c closed. Branch `architecture-backend-independence-6a7d8a`, 107 commits ahead of `develop`.

**Scope: the Electron desktop app only.** `apps/mobile` is explicitly out of scope for this program and must not be touched by any task in it.

**State at the start:** `@wimm/api` 54 suites / 436 tests, `@wimm/desktop` 68, `@wimm/shared` 34 — all green, suite offline by construction (the last full run passed with Docker not even installed). The app boots its own API on loopback, creates and manages profiles, and stores everything in a local SQLite file. Phases 0 through 4c are done.

**What this program finishes:** everything remaining that does not require an Apple Developer account, plus a written-but-not-executed plan for the part that does.

---

## Sequencing, and why

The goal is friends and family installing WIMM and using it, plus a portfolio piece. That gives a clear order:

1. **Stage 1 — close the last data-loss path.** Small. Everything after this writes more data into a store whose recovery story should be finished first.
2. **Stage 2 — import coverage.** The single largest product gain left. Today's importers handle CSV, OFX, and two specific PDFs (Banrisul credit card, Cresol statement). Someone else's bank is not your bank. Unblocked.
3. **Stage 3 — AI provider contract.** Smaller, and what lets the public build ship without the hosted build's ChatGPT OAuth.
4. **Stage 4 — distribution, the unblocked half.** Package size, Windows and Linux, the CI matrix, an updater dry run.
5. **Stage 5 — signing and notarization.** **Blocked on an Apple Developer account.** Planned here, executed when that exists.

Running alongside, needing your input rather than code: reconciling this branch with the hosted database's lineage.

---

## Stage 1 — Close the last data-loss path

### 1.1 Registry schema versioning

`profile-registry.ts` tolerates *unknown* fields and preserves them across writes — that was fixed in Phase 3. It does **not** survive a **renamed or dropped required** field: an older build reading a newer registry rejects the whole file, and every profile becomes unreachable. That is the one remaining path where a user loses access to data that is still on disk.

Add a version to the registry and a migration path. Design points:
- A missing version means "version 1" — existing registries in the wild have no version field and must keep working.
- A registry from a **newer** version must fail with a message naming the situation and telling the user to update the app — not "corrupt", which sends them down the recovery path for a problem they do not have. This mirrors `DatabaseMigratedByNewerBuildError`; follow that precedent, including a stable `code` rather than message matching.
- Migrations run forward only, on read, and rewrite atomically.

**Mutation proof:** write a v2 registry, read it with v1 logic, confirm it refuses distinguishably from corrupt. Rename a required field between versions and confirm the migration carries the data across.

### 1.2 Concurrent registry access

No file locking on `profiles.json`. The single-instance lock (Phase 4b) prevents the main case, so this is second line — but export, restore and switch all write it, and a crash mid-write during a switch is reachable. Decide whether the atomic write already suffices given single-instance, and if it does, **write that reasoning down and close the item** rather than adding a lock nobody needs. If it does not, add one.

### 1.3 `foreign_key_check` at scale

The migration runner runs `PRAGMA foreign_key_check` twice inside the batch transaction, scanning every table. Never measured against a real history. It holds the boot open for its duration.

Generate a database with a plausible multi-year volume — several thousand transactions, categories, rules — and **measure**. If it is fast, record the number and close the item. If it is slow enough to matter at boot, decide what to do about it and say why.

**Commits:** scope `database`.

---

## Stage 2 — Import coverage (Phase 5)

The largest remaining product gain. **This stage gets its own detailed implementation plan**, written just-in-time at the start of the stage, because it carries real design decisions that deserve their own pass. The decisions below are my calls; they go into that plan unless you say otherwise.

### Decisions I am making, flag any you disagree with

- **A generic CSV mapper, not more bank-specific parsers.** Writing a parser per bank does not scale past the banks I can see. A mapper that lets the user say "column 3 is the date, column 5 is the amount" covers every bank that exports CSV, which is nearly all of them.
- **Mappings are saved per source and reused.** Mapping columns once per bank, not once per import, is the difference between a feature and a chore.
- **Detection proposes, the user confirms.** Auto-detect the likely mapping (date-shaped column, currency-shaped column, a header row) and present it pre-filled. Never import on a guess without showing what it understood.
- **The existing parsers stay.** OFX and the two PDF parsers keep working unchanged; the registry picks between them and the generic path. This is not a rewrite.
- **Preview before commit stays mandatory** (`CLAUDE.md`), as does fingerprint deduplication and the `ImportBatch` link. Parser warnings surface to the user rather than being swallowed.

### Shape

- **2.1 — Parser registry.** A contract every parser implements, and selection by file type plus content sniffing. Existing parsers move behind it without behaviour change, proven by their current tests still passing untouched.
- **2.2 — Generic CSV mapper, backend.** Column mapping, date-format handling, decimal-separator handling (`1.234,56` and `1,234.56` both exist and mean different things), sign conventions (a separate debit/credit column, or a negative amount, or a type column).
- **2.3 — Mapping persistence.** Saved per source, reused on the next import, editable.
- **2.4 — The mapping UI.** Column picker over a real preview of the user's actual file.
- **2.5 — Verification.** Import a real statement from a bank the app has never seen, end to end.

**Money handling is the risk in this stage.** `toCents` rejects `.5`, `5.` and a leading `+`, accepts surrounding whitespace, and every call site sits behind `@Max(21474836.47)` because the column is `int4`. A CSV mapper feeds arbitrary text into that path — every test must assert on **integer cents**, never a float, and locale-specific decimal handling needs its own test matrix.

**Commits:** scopes `imports`, `shared`, `desktop`.

---

## Stage 3 — AI provider contract (Phase 6)

BYOK is kept (your decision, 2026-07-30). Today `AiKeyResolverService` and `AiKeyCrypto` are Anthropic-shaped, and the local build carries a per-profile encryption secret because of it.

**Goal:** an `AiProvider` contract with pluggable implementations, so the hosted build can keep its ChatGPT OAuth while the public build ships without it.

**Standing constraint, from you:** the ChatGPT OAuth stays **only** in the personally-hosted version, never in the public build. The contract is what makes that a composition choice rather than a fork.

- **3.1 —** Define the contract and move the current Anthropic path behind it, with no behaviour change.
- **3.2 —** Prove the local composition can be built without any hosted-only provider compiled in — a build-level assertion, not a runtime flag.

**Commits:** scope `api`, `shared`.

---

## Stage 4 — Distribution, the unblocked half (Phase 7a)

### 4.1 Package size

483 MB, with a floor around 460: Electron Framework (275 MB) plus Prisma, `pdfjs-dist`, `pdf-parse` and `@napi-rs` (~185 MB). Every release ships this to every user through the updater.

The PDF stack is the only large piece that is not structurally required at startup. Investigate lazy-loading or replacing it. **Decide deliberately** — do not assume it can be cut, and do not break the two PDF parsers to save megabytes.

### 4.2 Windows and Linux

- The atomic-write pattern in `snapshot.ts` and `profile-registry.ts` depends on `renameSync` semantics over an existing file. **Windows differs and this is untested.** Test it, or state plainly that it is untested and what the risk is.
- The native module needs per-platform builds. `verify-dependency-graph.cjs` (Phase 4b) catches a broken bundle — but only on a machine that builds one.
- `native-abi-guard` is inert in a packaged app by design; packaged builds rely on `electron-builder`'s rebuild. Confirm that holds per platform.

### 4.3 CI build matrix

Wire per-platform packaging into CI so a broken native build fails a pull request instead of a release. Both drift guards (`assert:parity`, `assert:constraints`) are already wired; follow their pattern.

### 4.4 Updater dry run

`electron-updater` publishes to GitHub and has never been exercised. Test everything that does not require a signed build, and be explicit that the signed path stays unverified until Stage 5.

**Commits:** scope `desktop`, `workspace`.

---

## Stage 5 — Signing and notarization (Phase 7b) — BLOCKED

**Requires an Apple Developer account. Do not start without one.**

This is the only part of the project that has never been verified, and it is blocked by something no amount of care here can substitute for. The packaged `.app` does not launch on this machine: `GatekeeperPolicyScanError -67018` with a repeating `Error checking with notarization daemon: 3`, reproduced against a **stock** Electron template carrying only a large `app.asar`. That is not our code, our config, or our signature — but it is also **not proof the app works**, and it must not be recorded as such.

When the account exists:
- Real Developer ID signing, then notarization, then stapling.
- `after-sign.cjs` already refuses to clobber a real identity when auto-discovery is on (Phase 4b). **Exercise that guard, do not trust it.**
- Only then: the updater against a signed build.
- Then relaunch the packaged app and finally complete the verification that has been outstanding since Phase 4b — a real `.app`, launched as a packaged app, opening a profile and rendering data.

**Write the detailed plan for this stage during Stage 4, so it is ready the day the account exists.** Do not execute it.

---

## Running item — hosted database reconciliation (needs your input, not code)

This branch converts Postgres enums to `TEXT` + `CHECK` constraints (Phase 0) and keeps the 3-value `AiCategorizationMode` with `aiApiKeyEncrypted`. The hosted database follows `develop`'s lineage: native enums, BYOK dropped, 2-value enum.

Those two are not merely different, they are incompatible states of the same table. Merging this branch is a migration-planning exercise in its own right, independent of everything above.

Two things are needed and only you can supply them:
1. **Was `20260504150000_simplify_ai_mode_to_toggle` ever applied to the hosted database?** Docker was unavailable here, so `_prisma_migrations` could not be read. If it was, Prisma will report an applied migration with no matching folder and needs `migrate resolve` out of band.
2. **Does the hosted instance carry real data you need to keep?** That decides whether reconciliation is a migration or a rebuild.

**Do not discover this during a deploy.**

---

## Global constraints for every stage

- All code, comments, docs and commits in English (`CLAUDE.md`). User-facing strings in `en` and `pt` only.
- **`apps/mobile` must not be touched.**
- The hosted build must not change: `route-posture.spec.ts` green at 40 routes, the local posture spec at 36.
- The API suite stays **offline** — no PostgreSQL, no Docker, no network beyond loopback.
- **Baselines are floors, not targets.** `@wimm/api` 54 suites / 436 tests, `@wimm/desktop` 68, `@wimm/shared` 34. Tests going up is a gain; **never delete passing coverage to match a number.**
- Do not weaken `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, the session-token posture, or the IPC bridge's main-side validation. New IPC validates in main, behind `assertTrustedSender`.
- Turbo caches `build`/`lint`/`test` and silently returns 0 from cache. Repo-wide proofs use `--force`.
- Running under Electron needs `npx tsx scripts/select-native-abi.ts electron`; **leave the tree on `node`**, suites green, `git status` clean.
- DOM assertions use `textContent`, **never `innerText`** — it reads empty on an unpainted window and looks exactly like a broken app.
- Ask before adding any dependency.

## The method that has to survive this program

Across Phases 0–4c, **fourteen** verifications passed without being able to fail. The expensive ones: a tokenless route test cannot detect a removed guard (`@CurrentUser()` throws its own 401 — it masked three different root causes); the cascade test a plan prescribed passed with all the pragma code deleted; and `restoreSnapshot`'s exclusive-access guard was blind to the only connection that mattered, because two SQLite builds live in one process — a check **I** wrote and verified with the same build on both sides.

None was caught by reading code more carefully. Every one was caught by requiring the fix to break on purpose and confirming the check screamed.

**Every task in this program carries a mandatory mutation proof with verbatim output.** Where a claim underpins security or data integrity, the controller verifies it independently rather than accepting a report — including the negative control that separates "works" from "always refuses".
