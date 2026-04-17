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

### Build

```bash
pnpm build
pnpm lint
```

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

MVP implementation in progress; core flows (auth, master data, imports, recurrences, reports, rules) are implemented in-repo.
