# WIMM

Where is your money?

---

## Overview

WIMM is a personal finance tracking application focused on understanding where your money goes.

It allows users to import financial data, categorize transactions, and analyze spending behavior.

---

## MVP Features

- CSV and OFX import (preview, dedupe, commit)
- Categorization rules (pattern → category) applied on import
- Manual entries
- Recurring transactions (materialize through a date)
- Reports (summary + by category) and dashboard charts
- Filters by date and category on transactions (API + list UI)

---

## Tech Stack

### Backend

- NestJS
- Prisma
- PostgreSQL

### Desktop

- Electron
- React
- TypeScript

### Future

- React Native

---

## Architecture

- Backend is the source of truth
- Desktop is a UI client
- Mobile will reuse backend

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (optional, for local PostgreSQL — see `docker-compose.yml`)

### Setup

```bash
pnpm install
```

### Database

Create `apps/api/.env` from `apps/api/.env.example` and set `DATABASE_URL`, JWT secrets, etc.

Start PostgreSQL (example):

```bash
pnpm db:up
pnpm --filter @wimm/api exec prisma migrate deploy
pnpm --filter @wimm/api exec prisma generate
```

### Run

From the repository root, start API and desktop (Turbo runs both):

```bash
pnpm dev
```

- API: `http://localhost:3000/api` (or `PORT` from `.env`)
- Desktop: Electron window (Vite dev server for renderer)

Configure the desktop with `apps/desktop/.env` from `.env.example` (`VITE_API_URL`).

### Environment variables

| Location | Variable | Purpose |
|----------|----------|---------|
| `apps/api/.env` | `DATABASE_URL` | PostgreSQL connection string |
| `apps/api/.env` | `JWT_ACCESS_SECRET` | Secret for signing access tokens |
| `apps/api/.env` | `JWT_ACCESS_EXPIRES_SEC` | Access token lifetime (seconds) |
| `apps/api/.env` | `REFRESH_TOKEN_EXPIRES_DAYS` | Refresh token lifetime (whole days) |
| `apps/api/.env` | `PORT` | API port (default `3000`) |
| `apps/desktop/.env` | `VITE_API_URL` | API base URL for the renderer (e.g. `http://localhost:3000/api`). **Baked in at build time** for packaged builds — set it before running `pnpm package:desktop` if the app should talk to a non-default API. |

See `apps/api/.env.example` and `apps/desktop/.env.example`. A root `.env.example` lists the same keys for quick reference.

### Build

```bash
pnpm build
pnpm lint
```

### Desktop release (packaged app)

Build installable artifacts with [electron-builder](https://www.electron.build/) (output under `apps/desktop/release/`):

```bash
pnpm package:desktop
```

Equivalent via Turbo (builds workspace dependencies first):

```bash
pnpm turbo run package --filter=@wimm/desktop
```

**Artifacts (examples):** macOS — `Wimm-*-arm64.dmg` / `.zip`; Windows — NSIS installer and `.zip`; Linux — `.AppImage` / `.deb` (targets are defined in `apps/desktop/package.json` under `build`).

**Checklist for a real release**

1. Run `pnpm build` and `pnpm lint` at the repo root.
2. Ensure the API is deployed and reachable; set `apps/desktop/.env` with the correct `VITE_API_URL`, then run `pnpm package:desktop`.
3. **macOS:** Without an Apple Developer ID certificate, the app is unsigned — users may need to open it via *System Settings → Privacy & Security* or `xattr`. For distribution outside the team, plan code signing and notarization separately.
4. **Windows / Linux:** Run `pnpm package:desktop` on the target OS (or a CI matrix) so native targets build correctly.

---

## Repository layout

High-level view of the monorepo. For the full picture, see **[Repository layout](ARCHITECTURE.md#repository-layout)** in `ARCHITECTURE.md`.

```text
wimm/
├── apps/
│   ├── api/                 NestJS REST API (Prisma + PostgreSQL)
│   └── desktop/             Electron + React + TypeScript
├── packages/
│   └── shared/              Shared types and API contracts
├── docker-compose.yml       Local PostgreSQL for development
├── ARCHITECTURE.md
└── README.md
```

---

## Core Concepts

- **Source:** where transactions come from
- **Transaction:** income or expense
- **Category:** classification
- **ImportBatch:** file import
- **Recurrence:** recurring rule
- **Categorization rule:** match text in description → assign category

---

## Principles

- Keep it simple
- Build incrementally
- Avoid overengineering
- Focus on real user value

---

## Status

MVP core flows (auth, master data, imports, recurrences, reports, rules) and a **desktop packaging** path (`pnpm package:desktop`) are implemented in-repo. Production signing, notarization, and CI for releases are optional next steps outside this MVP scope.
