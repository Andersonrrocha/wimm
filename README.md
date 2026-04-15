# WIMM

Where is your money?

---

## Overview

WIMM is a personal finance tracking application focused on understanding where your money goes.

It allows users to import financial data, categorize transactions, and analyze spending behavior.

---

## MVP Features

- CSV and OFX import
- Transaction categorization
- Manual entries
- Recurring transactions
- Monthly views
- Filters by date and category
- Table and analytics views

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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

---

## Repository layout

High-level view of the monorepo. For the full picture (including planned packages), see **[Repository layout](ARCHITECTURE.md#repository-layout)** in `ARCHITECTURE.md`.

### Today

```text
wimm/
├── apps/
│   ├── api/                 NestJS REST API (Prisma + PostgreSQL when persistence is added)
│   └── desktop/             Electron + React + TypeScript
├── packages/
│   └── shared/              Shared types and API contracts
└── docs/
    └── ARCHITECTURE.md      Link to the full architecture doc at repo root
```

### Planned

- `apps/mobile/` — React Native client  
- `packages/types`, `packages/utils`, `packages/config/` — optional split from `shared` when needed

---

## Core Concepts

- **Source:** where transactions come from
- **Transaction:** income or expense
- **Category:** classification
- **ImportBatch:** file import
- **Recurrence:** recurring rule

---

## Principles

- Keep it simple
- Build incrementally
- Avoid overengineering
- Focus on real user value

---

## Status

Planning and foundation phase
