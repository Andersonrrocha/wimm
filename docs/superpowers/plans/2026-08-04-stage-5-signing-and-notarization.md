# Stage 5 — Signing and Notarization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **BLOCKED. Do not start this plan without an Apple Developer account.** Written 2026-08-04 during Stage 4 so it is ready the day one exists, not improvised then.

**Goal:** A person who is not you can download WIMM, open it, and have it update itself — with the operating system's own checks satisfied rather than bypassed.

**Architecture:** electron-builder signs with a real Developer ID, submits the result to Apple for notarization, and staples the ticket. Only then is the updater exercised against a signed artifact. The packaging hooks that already exist keep working, including the guard that refuses to overwrite a genuine signature.

## Why this is the last stage, and the only unverified one

Everything else in this project has been proven by running it. This has not, and it is the single largest remaining unknown.

**What is known, measured on this machine:**

- The packaged `.app` **does not launch here**: `GatekeeperPolicyScanError -67018`, with a repeating `Error checking with notarization daemon: 3` in the system log.
- That was **reproduced against a stock Electron template** carrying nothing but a large `app.asar` — so it is not WIMM's code, config, or signature.
- The packaged **code** works: pointing the dev Electron binary at the packaged `app.asar`, from a directory with **no ancestor `package.json`** (the condition a real `/Applications` install reproduces), renders the onboarding screen against a fresh profile.
- The current signature is **ad-hoc** and valid: `codesign --verify --deep --strict` passes, `Signature=adhoc`, identifier `com.wimm.desktop`, `TeamIdentifier=not set`. `spctl` rejects it, which is expected without a Developer ID.

So: the app is believed to work and cannot be shown to launch. **Both halves of that sentence must survive into this stage.** Do not let "it works" be recorded without "launching it has never been demonstrated".

## Prerequisites — the human's, not the agent's

1. An **Apple Developer Program** membership.
2. A **Developer ID Application** certificate in the login keychain.
3. An **app-specific password** or an App Store Connect API key for notarytool.
4. `appId` confirmed as `com.wimm.desktop`, and a Team ID.

**None of these can be created by an agent, and none of them should be.** They are the owner's identity. An agent's job here is to consume credentials the owner has already installed, never to obtain, store, or transmit them.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`).
- Commit scope: `desktop`.
- **`apps/mobile` must not be touched.**
- **Never weaken a macOS security setting to make something pass.** No disabling hardened runtime, no `spctl --master-disable`, no bypassing Gatekeeper, no removing the notarization step to "unblock" a build. If the only way forward is weakening one of these, that is a **stop and report**, not a fix. This is a publicly distributed application that holds people's financial records.
- **Never print, log, echo, or commit a credential.** Not a certificate, not a password, not an API key, not into a report file. If a value is needed, read it from the environment or the keychain at the moment of use.
- Do not weaken `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, the session-token posture, or the IPC bridge's main-side validation.
- **Floors, not targets:** `@wimm/api` 67 suites / 596 tests, `@wimm/desktop` 98+, `@wimm/shared` 34. Never delete passing coverage to match a number.
- Leave the tree on the `node` ABI, clean, suites green, `release/` git-ignored.

---

## Task 1: Sign with a real identity

**Files:** `apps/desktop/package.json` (`build.mac`), `apps/desktop/scripts/after-sign.cjs`.

**The guard that already exists and must be exercised, not trusted:** `after-sign.cjs` re-signs ad-hoc **only** when no real identity is configured. Phase 4b hardened it to also skip when `CSC_IDENTITY_AUTO_DISCOVERY` is not `false`, because electron-builder will discover a Developer ID from the keychain even when `mac.identity`, `CSC_NAME` and `CSC_LINK` are all unset — and without that check the hook would have replaced a genuine signature with an ad-hoc one on exactly the build where it matters.

That guard has never run against a real certificate. **This is the first task, and proving the guard is the point of it.**

- [ ] **Step 1:** Configure hardened runtime and entitlements. The app needs no unusual entitlements — it opens a loopback socket to itself and reads its own `userData`. **Start from the minimum and add only what a failure proves is needed**, documenting each addition and why. Do not paste a permissive entitlements file.
- [ ] **Step 2:** Package with a real Developer ID.
- [ ] **Step 3: Prove the guard did not clobber it.** `codesign -dv` must show a real `TeamIdentifier` and **not** `Signature=adhoc`. This is the assertion the whole hook exists for.
- [ ] **Step 4:** `codesign --verify --deep --strict` passes.
- [ ] **Step 5: Commit** — `chore(desktop): sign the packaged app with a developer id`

---

## Task 2: Notarize and staple

- [ ] **Step 1:** Submit with `notarytool`, wait for the result.
- [ ] **Step 2:** **Read the notarization log even on success.** Apple returns warnings that do not fail the submission but do predict future rejections. Record them.
- [ ] **Step 3:** Staple the ticket to the `.app`, the `.dmg` and the `.zip`.
- [ ] **Step 4:** `spctl --assess --type execute --verbose` must **accept**. That is the check that has always rejected, and turning it green is this stage's central result.
- [ ] **Step 5: Commit** — `chore(desktop): notarize and staple the packaged app`

---

## Task 3: The launch that has never happened

This is the outstanding verification from Phase 4b. It has been carried, honestly labelled unproven, through four phases.

- [ ] **Step 1:** Launch the **real packaged `.app`** by its own binary — not the dev Electron binary pointed at `app.asar`, which is the workaround used until now.
- [ ] **Step 2:** With a fresh `--user-data-dir`, it must create a profile and render the onboarding screen. Dump `document.body.textContent` to a **file** — **never `innerText`**, which reads empty on an unpainted window and looks exactly like a broken app.
- [ ] **Step 3:** Move the `.app` to a directory with **no ancestor `package.json`** and repeat. That is what `/Applications` looks like, and it is the condition that once exposed a missing transitive dependency invisible everywhere else.
- [ ] **Step 4:** Quit and relaunch against the **same** profile; the data must still be there.

**If it still does not launch after notarization, that is a finding, not a failure to hide.** Report exactly which step stalls, with the system log, and stop.

---

## Task 4: The updater, against a signed build

Stage 4.4 exercised everything that does not need a signed artifact. This is the remainder.

- [ ] **Step 1:** Publish a release to GitHub.
- [ ] **Step 2:** Install the **previous** version, then let it discover and apply the update.
- [ ] **Step 3: The part that matters for a finance app.** Create a profile with recognisable data on the old version, update, and confirm the data is intact — including that any migration ran with its pre-migration snapshot taken. `applyPendingMigrations` refuses a database written by a newer build, so an update is one-way for the data; confirm the snapshot exists and is restorable **before** trusting the upgrade path.
- [ ] **Step 4:** Confirm the update does not install while a profile database is open, per whatever Stage 4.4 decided.
- [ ] **Step 5: Commit** — `chore(desktop): verify the updater against a signed release`

---

## Task 5: Windows and Linux

macOS is the hard case because of notarization. The others still need their own signing story.

- [ ] Windows: decide about code signing. An unsigned Windows build shows a SmartScreen warning that will frighten exactly the non-technical friends and family this is for. Certificates cost money; **decide deliberately and write down the decision**, including the option of shipping unsigned with clear instructions.
- [ ] Linux: AppImage and deb, per the existing config.
- [ ] The cross-platform CI job added in Stage 4.3 packages on macOS only, because `after-pack.cjs` is hard-coded darwin-only. If Windows and Linux are to ship, that limitation has to be lifted first — and `verify-dependency-graph.cjs` must run on those platforms, since it exists to catch exactly the per-platform native-module breakage that would otherwise reach a user.

---

## Exit criteria

- `spctl --assess` accepts the packaged app.
- The real `.app` launches from a directory with no ancestor `package.json`, creates a profile, and renders real data — the verification outstanding since Phase 4b.
- An installed older version updates itself and the user's data survives, with a pre-upgrade snapshot present.
- No macOS security setting was weakened to achieve any of it.
- Windows and Linux signing decisions are written down, whichever way they went.

## A note for whoever runs this

The temptation in this stage is to make the checks pass. The checks are not the goal — a friend of the owner double-clicking an icon and seeing their money is the goal. Every one of these steps is a proxy for that, and a proxy that has been forced green is worth less than an honest red.
