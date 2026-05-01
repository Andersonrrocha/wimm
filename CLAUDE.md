# Claude Project Rules — WIMM

Operational rules for Claude when working on this repository. Mirrors `.cursorrules` and extends it for the `apps/mobile` (React Native) work.

When in doubt, read `ARCHITECTURE.md` first, then `packages/shared/src/index.ts`.

---

## Language

- All code, comments, docs and commits in English.
- User-facing UI strings: `en` and `pt` only, via `i18next` resources.

---

## Core Principles

- Keep it simple; avoid overengineering.
- Backend owns business logic; clients (desktop, mobile) stay thin.
- Build incrementally; ship one module at a time.
- Reuse before duplicating; abstract only on the second duplication.
- Never invent features outside what the user asked.

---

## Architecture Rules

- Domain logic lives in `apps/api` only.
- No direct DB access from any UI client.
- Shared, framework-agnostic types live in `packages/shared`.
- Respect `ARCHITECTURE.md` boundaries.
- Cross-client code must work in both desktop and mobile, or live inside its app.

---

## Monorepo Rules

- `apps/*` execute; `packages/*` are imported.
- Workspace deps via `workspace:*`.
- Do not introduce a new shared package until two apps duplicate the same code.

---

## Naming Conventions

- PascalCase: components, classes, types.
- camelCase: variables, functions.
- kebab-case: file names.

---

## Backend Rules (apps/api)

- Controllers thin; services hold business logic.
- Validate all inputs with `class-validator`.
- No raw Prisma models in responses — map to shared DTOs.
- Keep Prisma usage consistent across modules.
- Preserve the existing `ThrottlerGuard` configuration on auth endpoints.

---

## Desktop Rules (apps/desktop)

- React Query for all server state.
- A single `axios` instance with the refresh-token interceptor; do not duplicate.
- UI components in `renderer/components/ui/` are the design system — extend before creating ad-hoc styles.
- Design tokens live only in `renderer/styles/theme.css`. No hardcoded colors elsewhere.

---

## Mobile Rules (apps/mobile)

- Expo + TypeScript (managed workflow). Do not eject without explicit reason.
- Reuse `@wimm/shared` for every DTO/contract; never retype them.
- API base URL is read from env (`EXPO_PUBLIC_API_URL`); same `/api/...` paths as desktop.
- Token storage via `expo-secure-store` (Keychain / Android Keystore). Never `AsyncStorage` for tokens.
- Refresh-token flow: port the desktop single-flight + queued interceptor 1:1.
- Navigation: React Navigation (Bottom Tabs + Stack). Keep navigation lib confined to the navigation layer.
- Styling: NativeWind v4 with the same token names as desktop (`bg-surface-1`, `text-fg-muted`, …).
- Charts: Victory Native XL (Skia). Avoid unmaintained libraries.
- File picking: `expo-document-picker` + `FormData`.
- Mobile UX is not a port of desktop — adapt density: tables → cards, header nav → bottom tabs, modals → bottom sheets, ⌘K → FAB.

---

## Import Rules

- Supported formats: CSV, OFX, Banrisul credit-card PDF, Cresol statement PDF.
- Always preview before commit.
- Deduplicate via fingerprint before persistence.
- Every import linked to an `ImportBatch`.
- Parser warnings are surfaced to the user, not swallowed.

---

## Recurrence Rules

- Support indefinite and fixed recurrences.
- Generated transactions are immutable from the recurrence engine.
- Stop generation past `endDate`.

---

## Commit Scope Rules

Use domain-based scopes:

`auth`, `users`, `transactions`, `imports`, `categories`, `recurrences`, `reports`, `database`, `api`, `desktop`, `mobile`, `shared`, `workspace`, `docs`

Examples:

```
feat(mobile): bootstrap expo app with shared workspace
feat(mobile): port api-client with refresh-token interceptor
feat(transactions): add list endpoint with pagination
fix(api): correct health check response typing
```

---

## Commit Size Rules

- One commit per feature, module, or architectural change.
- Avoid per-file or per-line commits.
- Never mix refactor with feature changes.

---

## Refactoring

- Refactor only when necessary to unblock a feature.
- Don't refactor desktop just to "prepare" for mobile — port what mobile needs, extract on duplication.

---

## Agent Behavior

- Follow architecture strictly; do not invent features.
- Prefer simple solutions over clever ones.
- Ask before adding a new top-level dependency.
- Ask before introducing a new `packages/*`.

---

## Skills Playbook

Project-level skills live in `.claude/skills/`. Invoke them at the moments below.

### `frontend-design`
Invoke **before** starting any UI-heavy module to lock the visual direction.
- Mandatory before M1 (mobile theme + UI primitives).
- The established direction is *"financial terminal / editorial"* — dark, dense, tabular, single warm accent. Do not drift.

### `design-system`
Invoke **after** UI work to audit and prevent drift.
- After M1: full audit against `apps/desktop/src/renderer/styles/theme.css` to confirm token parity.
- Before each PR that touches styling: run `slop-check` mode.
- After M10: full audit across all mobile screens.

### `frontend-patterns`
Reference during any React/React Native component work.
- M3 (auth context): error boundaries, context+reducer pattern.
- M4 (transactions list): virtualization (FlashList on RN, equivalent to `useVirtualizer`).
- M5 (quick add): compound components for tabs/forms.
- Any module with forms: controlled inputs + validation pattern.

### Built-in skills
- `/simplify` — run before every commit on mobile modules.
- `/security-review` — mandatory after M3 (auth, secure storage) and M7 (file upload).
- `/fewer-permission-prompts` — run once after M2 to allowlist `pnpm`/`expo`/`eas`.
- `/review` — for every mobile PR.
