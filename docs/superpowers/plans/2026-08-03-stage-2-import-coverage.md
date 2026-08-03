# Stage 2 — Import Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WIMM imports a statement from a bank it has never seen, without anyone writing a parser for it — and never silently records the wrong number.

**Architecture:** The existing parsers keep working unchanged behind a registry that selects between them. A new generic CSV path lets the user map columns once per source and reuses that mapping. Ambiguous number and date formats are captured in the mapping rather than guessed, because guessing wrong is silent.

**Tech Stack:** NestJS 10, TypeScript 5.5, React 18, Prisma 7.7.

## What already exists — this is not a rewrite

- `ParsedLedgerRow` (`apps/api/src/imports/parsers/csv-parser.ts`) is already the common shape every parser produces.
- `detectImportFormat` (`apps/api/src/imports/import-format.ts`) is already the dispatch point, selecting by file extension plus PDF layout guards.
- `parseCsvBuffer` already auto-detects columns by **header name**, with Portuguese and English sets (`DATE_KEYS`, `AMOUNT_KEYS`, `DESC_KEYS`).
- OFX and the two PDF parsers (Banrisul credit card, Cresol statement) work and are covered by tests.

The gap is a CSV whose headers are not in those sets, or that has no headers, or whose number and date formats are ambiguous.

## The evidence that shapes this plan — measured, not assumed

I ran the current `parseFlexibleAmount` and `parseFlexibleDate` (`apps/api/src/imports/parsers/amount-date.ts`) directly. Between them they carry **five test cases total**.

| Input | Current result | What it should be |
|---|---|---|
| `1.234` | `1.234` | `1234` for a Brazilian bank — a **1000× error** |
| `1,234` | `1.234` | `1234` for an American bank — the same wrong answer, opposite convention |
| `1.234,56` | `1234.56` | correct |
| `1,234.56` | `1234.56` | correct |
| `123,45-` | `123.45` | **the trailing minus is silently dropped — a debit becomes a credit** |
| `R$ 1.234,56` | throws | should parse |
| `(123,45)` | throws | parenthesised negative, common in statements |
| `03/04/2026` | 3 April | 4 March for a `mm/dd` bank — wrong by up to 11 months |

Two conclusions follow, and they are the spine of this plan:

1. **`123,45-` is a live defect**, not a future concern. Any user whose bank exports that format is recording credits as debits today, silently. It is fixed in Task 1, independently of everything else.
2. **`1.234` and `01/02/2026` cannot be resolved by inspection.** They are genuinely ambiguous, and the wrong answer is off by 1000× or by months, with no error. So the mapping must **capture** decimal separator, date order and sign convention explicitly. Auto-detection proposes; it never decides silently.

## Global Constraints

- All code, comments, docs and commits in English (`CLAUDE.md`). User-facing strings in `en` and `pt` only.
- **`apps/mobile` must not be touched.**
- `CLAUDE.md` import rules stand: preview before commit is mandatory, deduplicate by fingerprint before persistence, every import links to an `ImportBatch`, and parser warnings are surfaced to the user rather than swallowed.
- **Money is integer cents.** Every assertion about an amount is on cents, never a float. `toCents` rejects `.5`, `5.` and a leading `+`, accepts surrounding whitespace, and every call site sits behind `@Max(21474836.47)` because the column is `int4`.
- The hosted build must not change: `route-posture.spec.ts` green at 40 routes, local posture at 36.
- Suite stays **offline**: no PostgreSQL, no Docker, no network beyond loopback.
- **Baselines are floors, not targets:** `@wimm/api` 54 suites / 445 tests, `@wimm/desktop` 71, `@wimm/shared` 34. Tests going up is a gain; **never delete passing coverage to match a number.**
- Turbo caches `build`/`lint`/`test`; repo-wide proofs use `--force`.
- Leave the tree on the `node` ABI, clean, suites green.
- Ask before adding any dependency.

---

## Task 1: Fix and harden amount and date normalization

Do this first and alone. Everything downstream feeds it a wider input space, so it has to be right before the space widens.

**Files:** `apps/api/src/imports/parsers/amount-date.ts` and its spec.

- [ ] **Step 1: The live defect.** `123,45-` must not silently drop its sign. Decide whether trailing minus is accepted (and negative) or rejected — either is defensible, **silently positive is not**.
- [ ] **Step 2: Explicit format, not guessing.** Give both functions a way for the caller to state the decimal separator and the date order, with today's heuristic as the default when nothing is stated. The heuristic stays for the existing callers; the new mapper will always pass explicit values.
- [ ] **Step 3: Widen what parses.** Currency symbols (`R$`, `$`) and parenthesised negatives are ordinary in real statements. Add them, and decide deliberately about a leading `+`.
- [ ] **Step 4: A real test matrix.** Both conventions, both date orders, both negative notations, currency symbols, zero, and the ambiguous cases asserting the *stated* convention wins over the heuristic. Assert amounts in **cents** wherever the value crosses into domain code.
- [ ] **Step 5: Mutation proof.** Restore the dropped trailing minus; a test must fail. Make an explicit separator be ignored in favour of the heuristic; a test must fail. Verbatim output for both.
- [ ] **Step 6: Commit** — `fix(imports): stop dropping a trailing minus and let callers state number and date format`

---

## Task 2: Parser registry

**Files:** `apps/api/src/imports/import-format.ts`, a new registry module, and specs.

Turn the existing extension-plus-layout-guard dispatch into a registry: a contract each parser implements, and selection by file type plus content sniffing.

- [ ] **Step 1:** Define the contract from what the existing parsers already do — do not invent a shape they must be bent into.
- [ ] **Step 2:** Move OFX, Banrisul and Cresol behind it. **Their existing tests must pass untouched** — that is the proof this is a refactor and not a rewrite. If a test needs changing, the contract is wrong.
- [ ] **Step 3: Mutation proof.** Unregister a parser; the test that imports that format must fail. Verbatim output.
- [ ] **Step 4: Commit** — `refactor(imports): select parsers through a registry`

---

## Task 3: Generic CSV mapping, backend

**Files:** new mapper module under `apps/api/src/imports/parsers/`, plus specs.

A mapping says: which column is the date, the description, the amount; the decimal separator; the date order; and how sign is expressed.

**Sign conventions that exist in the wild** — support all three, and make the mapping say which:
- a single signed amount column,
- separate debit and credit columns,
- an amount plus a type column (`D`/`C`, `DEBIT`/`CREDIT`).

Also handle: a header row or none; a delimiter that is `,` or `;` (Brazilian exports frequently use `;` precisely because `,` is the decimal separator); and encodings — Latin-1 is still common in Brazilian bank exports and will mangle accented descriptions if assumed UTF-8.

- [ ] **Step 1: TDD the mapper** against fixture CSVs covering each sign convention, both delimiters, both decimal conventions, headers and headerless.
- [ ] **Step 2: Detection that proposes.** Infer a likely mapping — date-shaped column, currency-shaped column, a header row — and return it **as a proposal with a confidence signal**, never applied silently.
- [ ] **Step 3: Mutation proof.** Feed a `;`-delimited pt-BR file with a mapping that states `.` as decimal; the result must be visibly wrong or rejected, never silently plausible. Then state the correct separator and confirm the cents are exact. Verbatim output for both.
- [ ] **Step 4: Commit** — `feat(imports): add a generic csv mapper`

---

## Task 4: Mapping persistence

**Files:** Prisma schema (a new model), a migration, and service code.

Mapping columns once per bank rather than once per import is the difference between a feature and a chore.

**This touches the schema, so it touches both chains.** A migration here needs its SQLite counterpart and the derived baseline regenerated; `assert:parity` is the guard and it runs in CI. Check the highest existing migration timestamp before choosing one — an earlier timestamp sorts wrong and, as this project already learned the hard way, produces a migration that can never run.

- [ ] **Step 1:** Model the mapping, keyed per source.
- [ ] **Step 2:** Reuse it on the next import from the same source; let the user edit it.
- [ ] **Step 3: Verify both chains** — `assert:parity` and `assert:constraints` green.
- [ ] **Step 4: Commit** — `feat(imports): remember a source's csv mapping`

---

## Task 5: The mapping UI

**Files:** `apps/desktop/src/renderer/`.

A column picker over a **real preview of the user's actual file** — not an abstract form. Show the first rows as parsed under the current mapping, so a wrong separator is visible as a wrong number before anything is imported.

- [ ] **Step 1:** Build it, `en` and `pt`.
- [ ] **Step 2:** Prove end to end with a real statement from a bank the app has never seen. `textContent`, never `innerText`.
- [ ] **Step 3: Commit** — `feat(desktop): add the csv column mapping screen`

---

## Task 6: Verification

- [ ] Both suites at or above floor, offline.
- [ ] `assert:parity`, `assert:constraints`, both posture specs.
- [ ] `pnpm build --force && pnpm lint --force`.
- [ ] An unknown-bank CSV imported end to end in the packaged app, with the amounts correct **to the cent**.
- [ ] The existing OFX and PDF imports still work, their tests unchanged.

## Exit criteria

- A statement from a bank nobody wrote a parser for imports correctly.
- The mapping is remembered per source.
- No ambiguous number or date format is ever resolved silently — the mapping states it, and the preview shows the consequence before import.
- `123,45-` no longer records a debit as a credit.
