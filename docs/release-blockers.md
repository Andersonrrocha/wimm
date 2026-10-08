# Release blockers

Work that must land **before** the next `v*` tag. `release-desktop.yml`
triggers on `v*` and `electron-updater` is wired to GitHub releases, so
anything on this list reaches an installed user's machine rather than CI.

A blocker leaves this file only when it is done or when the owner records why
it is no longer one. Nothing here is a nice-to-have.

---

## 1. The SQLite migration chain must become incremental

**Owner:** Anderson
**Raised:** 2026-10-02 (Task 1 of the ChatGPT plan-usage plan)
**Escalated to this file:** 2026-10-08, on the final review's request

### What is wrong

`apps/api/prisma/migrations-sqlite/` is a single `0000_baseline/migration.sql`,
and schema parity check 3 requires it be a **full regeneration** rather than an
incremental migration. So every schema change rewrites the baseline.

But `apps/api/src/prisma/local/migration-runner.ts` hard-fails at boot when an
already-applied migration's checksum no longer matches its file. Rewriting the
baseline changes that checksum for every profile database that already applied
the old one.

### Why it is a blocker and not a known issue

Today it costs developers a recreated profile after each schema change. That is
accepted: **no `v*` release has ever been cut** (confirmed with the owner on
2026-10-04), so no user has data on disk under an older baseline.

The moment one ships, the same mechanism fails on the user's machine, at boot,
after an auto-update — not in CI, and not anywhere we would see it. The
2026-07-28 embedded-local-runtime design states it plainly: a regenerated
baseline "works only until the first schema change ships, and then it either
wipes or breaks the database of everyone who already uses the app."

Two schema changes have already taken this path: `5581938` (CsvSourceMapping)
and the ChatGPT plan-usage chain (`ChatGptConnection`, then
`User.aiByokSource`).

### Shape of the fix

1. Freeze `0000_baseline` — it never changes again.
2. Author `0001_` onward for both dialects on every subsequent schema change,
   Postgres and SQLite alike.
3. Change parity check 3 to compare the **sum of the chain** against a
   regeneration, instead of comparing the baseline file alone. Check 3 is
   currently what forces the regeneration, so it has to move with the rest.

Its own piece of work, outside any plan that preceded it.

---

## 2. `assert:constraints` has not run since the schema gained a constraint

**Owner:** Anderson
**Raised:** 2026-10-08 (Task 15 sweep, confirmed by the final review)

`pnpm --filter @wimm/api assert:constraints` reads `DATABASE_URL` and queries
live Postgres, so it cannot run offline and was out of bounds for the whole of
the ChatGPT plan-usage plan. That plan added `User_aiByokSource_check`.

Offline we verified that the declaration
(`apps/api/src/prisma/check-constraints.ts`), the Postgres migration SQL and
the SQLite baseline agree on all five properties: constraint name, table,
column, both permitted values, and that NULL is permitted. That is
triangulation, not the assertion.

**Run it against a migrated Postgres before the tag.** It belongs in CI after
`migrate deploy`.

---

## 3. Nothing has ever run against the real OpenAI service

**Owner:** Anderson
**Raised:** 2026-10-08 (final review of the ChatGPT plan-usage branch)

The ChatGPT plan-usage feature is complete, reviewed, and fully covered by
tests that use **injected doubles for every network edge**. The packaged app
was built and its `app.asar` verified module-by-module, but never launched.

At least five assumptions fail **closed and silently** if wrong — the feature
would simply never produce a suggestion, with no error a user could act on:

- whether the live `id_token` carries `nonce` (if it does not, `verifyIdentity`
  rejects every exchange)
- the JWKS document's shape
- that `chatgpt.tokens.use.direct` is the scope actually granted
- the model id (`gpt-5-mini`)
- the real `expires_in` against `EXPIRY_SKEW_MS = 300_000` — a token whose
  lifetime is 300s or less is already expired when stored, so every call
  rotates

Also unverified: that `shell.openExternal` actually opens a browser on any
platform, and that the `subscription_sharing_*` error codes arrive in the shape
`readErrorCode` reads.

**Instrument the first live run** rather than treating a silent no-suggestion
as a bug to debug from scratch.
