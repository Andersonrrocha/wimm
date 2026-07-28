# Standalone Local Architecture — Design

**Date:** 2026-07-28
**Status:** Draft, pending review

---

## 1. Context

WIMM today depends entirely on hosted infrastructure: a NestJS API, PostgreSQL, and JWT-based
multi-tenant auth. Every client is thin and every operation crosses the network.

The project is being repositioned. It is no longer aimed at competing with the crowded personal
finance SaaS market. Its two actual purposes are:

1. Something the author and their friends and family can install and use.
2. A portfolio and case-study artifact, published openly.

This makes per-user hosting cost the binding constraint. The public distribution must cost the
author nothing to operate, and must be installable by people who will never open a terminal,
create an account, or paste an API key.

Alongside the public build, the author will keep running a **private hosted instance** for
personal use and a few close friends, with desktop and mobile in sync against their own server.
That instance is the application exactly as it exists today.

The two modes are **disjoint**. No data is ever synchronized between a local install and the
hosted instance. A one-time export/import is the only bridge, and only if someone moves from one
to the other.

---

## 2. Goals

- A public desktop build that runs with **zero infrastructure**: no account, no server, no
  configuration, no API key required for core functionality.
- Data stored locally, in a file the user owns and can copy.
- Multiple local profiles on the same machine.
- The private hosted build keeps working exactly as it does today.
- A single repository and a single domain implementation serving both.
- Import coverage that does not depend on the author having seen a given bank's statement format.

## 3. Non-goals

- Sync between local and hosted. Explicitly out of scope, in this spec and in the roadmap.
- Mobile in local mode. Expo has no Node runtime, so the embedded API cannot run there. Mobile
  remains hosted-only, and is deferred entirely.
- Paid tiers, subscriptions, or monetization. The existing `SubscriptionStatus` /
  `SubscriptionPlan` scaffolding is frozen, not extended. It is not deleted.
- Multi-user collaboration or shared accounts.
- Self-hosting as a supported, documented path for third parties. The `docker-compose.yml` stays
  for development, but "run your own server" is not a distribution the project supports.

---

## 4. Decisions

Each decision records what was chosen, why, and what was rejected. The rationale matters more
than the conclusion — several of these reversed during design as constraints clarified.

### D1 — Single repository with two composition roots, not a fork

**Chosen:** one monorepo. The divergence between local and hosted lives in two NestJS composition
roots, not in flags scattered through business code.

**Why:** the API is 10,334 LOC. Measured by module:

| Module | LOC | Differs between modes? |
|---|---:|---|
| `imports/` | 6,022 | no |
| `reports/` | 811 | no |
| `transactions/` | 777 | no |
| `recurrences/` | 597 | no |
| `categorization-rules/` | 471 | no |
| `categories/` | 418 | no |
| `auth/` | 362 | **yes** |
| `ai/` | 299 | contract shared; one provider implementation differs (see D7) |
| `sources/` | 267 | no |
| `users/` | 167 | **partially** |
| `prisma/` | 32 | **yes** (adapter only) |
| `common/` | 17 | no |

Roughly **550 LOC (~5%) genuinely diverges**. The other 94% is identical. A fork would duplicate
the 6,022 LOC of bank statement parsers — the fiddliest, most edge-case-ridden, most actively
changing code in the project — to avoid conditional wiring in ~550 lines.

Parsers are also the code most likely to need ongoing fixes, since every bank layout change
breaks one. Under a fork, each fix must be applied twice, to two codebases that have already
drifted apart. In practice one side rots, and it is usually the one with fewer users.

**Rejected:**
- *Two repositories (hard fork).* Cleaner per-repo code, permanent duplication of the shared 94%.
- *Monorepo plus `packages/core` extraction.* Architecturally cleanest, but a large refactor
  blocking all feature work. Revisit only if the two composition roots prove insufficient.
- *Fork with parsers published as a shared npm package.* Solves the worst duplication but adds
  solo-maintained package versioning and release overhead.

### D2 — SQLite for local storage, via the official Prisma adapter

**Chosen:** `@prisma/adapter-better-sqlite3`.

**Why:** the selection criterion is long-term durability and the lowest chance of failing on a
stranger's Mac or Windows machine — machines that cannot be debugged and whose users will report
nothing more specific than "it doesn't open."

The two candidates fail in different places:

- **SQLite fails at build time.** A native module must match Electron ABI × platform × arch. When
  that is wrong, it is wrong in CI, before shipping, and deterministically — if it compiles for
  Windows x64 it works on every Windows x64.
- **PGlite fails at runtime on someone else's machine.** WASM plus a custom VFS plus asar plus
  Windows filesystem semantics plus abrupt shutdown is a surface with far less mileage inside
  Electron.

SQLite has been shipped by thousands of Electron applications for over a decade, has a
compatibility commitment through 2050, and is a Library of Congress recommended archival format.
For a file holding a decade of someone's financial history, that outweighs schema elegance.

Supply chain also favours SQLite: `@prisma/adapter-better-sqlite3` is official (163k downloads/wk).
The PGlite Prisma adapters are community-maintained with a bus factor of one
(`pglite-prisma-adapter`, 76k/wk, single maintainer; `prisma-pglite`, 1k/wk).

**Rejected:** PGlite (Postgres compiled to WASM). It was the recommendation for two rounds of this
design, on the strength of preserving `Decimal`, preserving enums, and keeping one schema. Those
advantages are real but are all *maintenance* advantages. They lose to a *reliability* criterion.

**Accepted cost:** perfect parity between modes is given up. Every new feature needs a migration in
both trails, and a class of bug will exist that only appears in one dialect.

### D3 — Enums become `String` in both schemas

**Chosen:** all 12 enums (`TransactionKind`, `SourceType`, `CategoryType`, `RecurrenceFrequency`,
`RecurrenceEndMode`, `CategorizationMatchType`, `ImportBatchFormat`, `ImportBatchStatus`,
`ChartDateMode`, `AiCategorizationMode`, `SubscriptionStatus`, `SubscriptionPlan`) become `String`
in **both** the Postgres and SQLite schemas.

**Why:** this is the decision that makes D2 survivable, and it removes the single largest technical
risk in the design.

SQLite does not support Prisma enums. If Postgres keeps `TransactionKind` as an enum and SQLite
represents it as `String`, the two generated Prisma clients expose **different types for the same
field**, and no feature service can typecheck against both. That would force either a full
mapping layer or two divergent service implementations — reintroducing the fork by the back door.

Standardizing on `String` means the two schema files differ **only in the `datasource` block**,
which a small build script can generate from a single source.

Validation is not lost: values are already typed in `@wimm/shared` and already validated on input
by `class-validator`. Database-level guarantees can be restored on the hosted side with `CHECK`
constraints written as raw SQL in a migration.

**Cost:** one migration against the hosted database.

### D4 — Money becomes integer cents in both modes

**Chosen:** the three `@db.Decimal(14, 2)` fields — `Transaction.amount`, `Recurrence.amount`,
and `amountEach` on installments — become `Int`, storing cents.

**Why:** SQLite has no decimal type. Prisma exposes `Decimal` but the underlying storage is
float-backed, and this application aggregates repeatedly (category reports, statement totals,
installment splits), which is exactly where float error accumulates.

This was initially framed as a cost of D2. It is not. Integer cents is the standard representation
for money in financial software and is more robust regardless of database. It improves the hosted
version too. Treat it as a correction that D2 forced, not a concession.

Combined with D3, `Decimal` and `@db.*` native attributes disappear from the schema entirely,
which is what reduces the schema transform to a `datasource` swap.

### D5 — Local mode has no login, with multiple file-isolated profiles

**Chosen:** no authentication in the public build. Profiles are listed in
`userData/profiles.json`; each profile is a separate database file at
`userData/profiles/<id>.db`.

**Why:** an account creation screen in an offline application is exactly the friction this project
exists to remove. File isolation makes backup and export explainable to a non-technical user —
"your data is this file" — and a corrupted profile cannot take the others down.

Each profile database contains exactly **one** `User` row. Every existing `userId` scope in every
service therefore continues to work untouched.

Profiles are organizational, **not private**. There is no per-profile password and no encryption.
Anyone with access to the machine can open any profile. This is a deliberate scope decision, not
an oversight.

**Rejected:**
- *Keep JWT auth against the local database.* Smallest diff, worst UX.
- *Single profile, no switcher.* Simpler, but shared-machine use is a stated need.
- *Per-profile passphrase with an encrypted database (SQLCipher).* Real privacy between household
  members, at the cost of unrecoverable data on a forgotten password plus an added native
  dependency. Deferred, not rejected permanently — file isolation is a compatible stepping stone.

### D6 — Build-time mode selection, not a runtime toggle

**Chosen:** two build targets from one codebase. Public embeds the API and SQLite and contains no
concept of a server or a login. Personal points at the author's server and contains no profile
switcher or embedded database.

**Why:** a runtime toggle was recommended earlier in this design and is withdrawn. Because the
modes are disjoint (§1), a toggle would put a "server URL" field in front of users who must never
see one. Hiding confusing configuration from non-technical users is the project's premise.

### D7 — AI providers behind a contract; OAuth stays out of the public build

**Chosen:** `ai/` (299 LOC, currently coupled to `@anthropic-ai/sdk`) is refactored to an
`AiProvider` contract with pluggable implementations: Anthropic BYOK, OpenAI BYOK, and a local
model via Ollama. AI is never required — deterministic rules carry the application.

ChatGPT-subscription-backed OAuth is **excluded from the public build** and available only in the
private hosted build.

**Why:** research (2026-07-28) established that OpenAI is genuinely more permissive here than
Anthropic — Anthropic blocked third-party tools from Pro/Max subscription OAuth in early 2026,
while Codex OAuth in third-party applications still functions. But three distinct things are
called "OpenAI OAuth":

1. Identity SSO ("Sign in with ChatGPT"). Legitimate, documented, pays for no inference.
2. Subscription-backed inference through OpenAI's **partner program**. Real, but access is by
   application via a developer interest form.
3. Reusing the Codex first-party client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) against
   `chatgpt.com/backend-api/codex` to obtain (2) without being a partner. This is what community
   libraries do, and they disclaim it themselves as unofficial with the user assuming all terms
   risk.

The decisive argument is not terms-of-service compliance in the abstract. It is that under
enforcement, the banned account belongs to **the user**, not the author. Shipping that exposure to
family in a free application is a poor trade — especially because the existing suggest-then-save-
as-rule flow means AI usage **decays toward zero** as rules accumulate. The inference volume of a
personal finance application is tiny; BYOK genuinely costs a user cents per year.

**Implementation note (assumption, flag on review):** since the repository is public, excluding
OAuth from the public *build* does not exclude it from the public *code* — including the reused
client ID, which is precisely the kind of string that gets a repository flagged. The proposal is
that the `AiProvider` **contract** is public while the OAuth **implementation** lives in a private
package consumed only by the personal build. This does not contradict D1: there the shared surface
was 94%, here it is 0%.

The alternative — keeping everything public and disabled behind a flag — is simpler and acceptable
if the author prefers it.

### D8 — Import coverage comes from a generic CSV mapper, not more parsers

**Chosen:** the answer to "how do we support banks whose format we have never seen" is a generic
column mapper plus hardened OFX, not an ever-growing set of bank-specific parsers.

**Why:** bank-specific parsers do not scale to a public audience and PDF statements have no
standard at all. A mapping UI converts N unknown formats into one 30-second user action, works
offline, and requires no AI.

---

## 5. Architecture

### 5.1 Composition roots

`app.module.ts` remains the hosted composition, unchanged.

`app.local.module.ts` is new. It imports **the same feature modules** and replaces only the edges:

| Concern | Hosted | Local |
|---|---|---|
| Identity | `AuthModule` (JWT + refresh) | `ProfileModule` (active profile) |
| Persistence | `@prisma/adapter-pg` | `@prisma/adapter-better-sqlite3` |
| Rate limiting | `ThrottlerGuard` on auth | none (no network surface) |

`common/decorators` is untouched. Where the JWT strategy populates `req.user` in hosted mode, a
local middleware populates it from the active profile. `TransactionsService` receives a `userId`
and never learns where it came from. **No feature module contains a mode conditional.**

### 5.2 Persistence

`prisma/schema.prisma` (Postgres) stays the single source of truth. A build script emits
`prisma/schema.sqlite.prisma`, rewriting the `datasource` block. After D3 and D4, that is the only
transformation required.

Two clients are generated into separate output directories. The composition root selects one.
Because enum and money representations are now identical across both, the generated types are
structurally compatible and services compile against either.

The local database lives at `app.getPath('userData')/profiles/<id>.db`.

### 5.3 Profiles

`userData/profiles.json` holds the registry: `{ id, name, dbFileName, createdAt, lastOpenedAt }`.

Startup behaviour:

- no profiles → onboarding creates the first one
- exactly one → open it directly
- more than one → profile picker

Each profile database is seeded with a single `User` row whose id is the profile id. Switching
profiles tears down the Nest application and Prisma client and re-instantiates against the new
file.

### 5.4 Embedded API

The Electron main process boots Nest with `NestFactory.create(AppLocalModule)` and
`listen(0, '127.0.0.1')`, letting the OS assign a free port. The port is passed to the renderer
over IPC, which sets the axios base URL. The renderer's data layer is otherwise unchanged —
React Query and the existing API client keep calling the same `/api/...` paths.

Two security requirements, both non-negotiable:

1. **Bind explicitly to `127.0.0.1`, never `0.0.0.0`.** Binding to all interfaces would expose a
   user's complete financial history to any device on the same network.
2. **Require a per-session random token header.** Any local process — including any web page open
   in the user's browser — can reach `localhost`. Without an unguessable token, a malicious page
   could read the entire database. Origin checking alone is insufficient.

The refresh-token interceptor is a no-op in local mode; there are no tokens to refresh.

### 5.5 Migrations and backup

Migration `.sql` files ship as a packaged asset. On startup the app reads `_prisma_migrations`
from the profile database and applies anything pending inside a transaction. The Prisma CLI is
**not** shipped — `prisma migrate deploy` is not viable inside a packaged Electron application, so
a minimal runner is required.

**Before applying any migration, the profile file is copied to `userData/backups/`**, retaining
the last 5 snapshots per profile. A failed migration must leave a recoverable file.

Settings exposes manual export and import (file copy in and out).

In hosted mode, backup remains an infrastructure responsibility. In local mode it becomes an
application responsibility, and it is a hard requirement rather than a refinement.

### 5.6 Distribution

Two `electron-builder` targets from one codebase:

| | Public | Personal |
|---|---|---|
| API | embedded | remote |
| Database | SQLite, local | Postgres, hosted |
| Login | none | JWT |
| Profile switcher | yes | no |
| AI OAuth | no | yes |
| Mobile counterpart | none | yes |

Both use `electron-updater` against GitHub releases. macOS notarization (~USD 99/year) becomes the
only recurring cost. Windows without an EV certificate produces a SmartScreen warning; accepted
initially.

### 5.7 Import coverage

`imports/parsers/` becomes a **registry with a contract**:

```
detect(file) -> confidence
parse(file)  -> NormalizedRow[]
```

Import orchestration iterates the registry and picks the highest-confidence parser. Adding a
format becomes adding a file, with no change to orchestration. The existing Banrisul and Cresol
parsers become reference implementations of the contract rather than the strategy itself.

**Generic CSV mapper.** For any unrecognized CSV, a mapping screen asks which column is date,
amount, description, and type, with pickers for date format and decimal separator. The mapping is
saved as an `ImportProfile` bound to a `Source` and reused automatically on subsequent imports.

**OFX is the highest-leverage format.** Nearly every Brazilian bank exports OFX from internet
banking. Hardening the generic OFX parser covers more ground than any number of PDF parsers.

**PDF stays opt-in per bank.** The honest public message is: export CSV or OFX; PDF is supported
for specific banks.

AI may propose a column mapping for the user to confirm, but the manual mapper must work
completely without it.

### 5.8 AI provider

```
AiProvider {
  suggestCategories(input) -> Suggestion[]
}
```

Implementations: Anthropic BYOK, OpenAI BYOK, Ollama (local). Absent a configured provider, the
application is fully functional through deterministic categorization rules. Suggestions accepted
by the user are saved as rules, so provider usage decays over time.

---

## 6. Delivery phases

This design is **too large for a single implementation plan**. It decomposes into seven phases,
each of which gets its own plan and its own review cycle.

Phases 0, 5 and 6 improve the hosted application as well and can ship independently, before any
local-mode work completes. That ordering is deliberate: value lands early, and the riskiest work
(Electron embedding) starts on a schema that has already been corrected and proven in production.

| Phase | Scope | Depends on | Also benefits hosted |
|---|---|---|---|
| 0 | Enums to `String`, money to integer cents (D3, D4) | — | yes |
| 1 | SQLite schema generation, second Prisma client, drift test (D2) | 0 | no |
| 2 | Migration runner and pre-migration backup (§5.5) | 1 | no |
| 3 | `app.local.module.ts`, `ProfileModule`, profile registry (D1, D5) | 1 | no |
| 4 | Embedded API in Electron main, IPC port, session token (§5.4) | 2, 3 | no |
| 5 | Parser registry and generic CSV mapper (D8) | 0 | yes |
| 6 | `AiProvider` contract and pluggable implementations (D7) | — | yes |
| 7 | Two build targets, updater, notarization (D6) | 4 | no |

Phase 4 requires a `/security-review` pass before release, per the project skills playbook — it
introduces a network listener and a new authentication surface.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Native module ABI mismatch in packaged builds | high | per-platform CI matrix; verified in CI, never reaching users |
| Migration corrupts a user's only copy of their data | high | mandatory pre-migration snapshot; transactional apply; retained backups |
| Localhost API reachable by a malicious web page | high | `127.0.0.1` bind plus per-session token header |
| Schema drift between the two trails | medium | generated SQLite schema plus a CI drift test |
| Dialect-specific bugs appearing in only one mode | medium | accepted cost of D2; test suite runs against both |
| Unsigned Windows build deters installation | medium | accepted initially; revisit if adoption is blocked |
| Parser contributions require real financial fixtures | medium | anonymization tooling is a prerequisite before accepting PRs |

---

## 8. Roadmap (explicitly out of scope here)

- **Community-contributed parsers.** The D8 registry enables this, but accepting PRs requires
  fixture anonymization tooling first, since statement fixtures are real financial data.
- **Apply to OpenAI's "Sign in with ChatGPT" partner program.** An open-source finance application
  with a real user base fits the stated applicant profile. This is the legitimate route to
  subscription-backed inference, and would supersede D7's exclusion if granted.
- **Per-profile encryption.** File isolation (D5) is a compatible stepping stone.
- **Mobile.** Hosted-only for now. Local mobile would require extracting the domain into a package
  that runs outside Node, which is the `packages/core` refactor rejected in D1.
- **Sync.** Explicitly not planned.

---

## 9. Open questions for review

1. **D7 implementation note** — private package for the OAuth provider, or everything public and
   disabled by flag?
2. **CSV mapper scope** — minimal (manual mapping only) or complete (automatic date-format and
   separator detection) in the first pass?
3. **`CHECK` constraints on the hosted database** (D3) — worth the raw-SQL migration, or is
   `class-validator` sufficient?
