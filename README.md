# RDB Log Explorer

> Sales Transaction Explorer for ElvisPOS `rdb_log` data.

[![Bun](https://img.shields.io/badge/Bun-1.3-000?logo=bun&logoColor=fff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=fff)](https://tailwindcss.com)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=fff)](https://tauri.app)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

A clean web app, backed by a lightweight [Bun](https://bun.sh) server, for browsing, analyzing, and
auditing point-of-sale transactions. The backend runs **read-only** queries against the PostgreSQL
`rdb_log` tables; the UI turns them into a searchable ledger and a loss-prevention view.
Runs in the browser or as a native **desktop app** via [Tauri](https://tauri.app).

## Features

- **Transactions** — filter and sort by date, amount, store, terminal, and operator; full-text search
  across articles, references, and transaction numbers; paginated results with live totals and one-click
  **CSV export**.
- **Detail drawer** — line items, payments, discounts, and tax with per-section totals, plus a
  printable **receipt** view.
- **Exceptions** — a loss-prevention radar that ranks voids, refunds, heavy discounts, item overrides,
  tender issues, POS alerts, loyalty activity, and unusually long transactions by explainable risk signals,
  with an operator risk leaderboard.
- **Multiple servers** — save named database servers (host or IP) and switch between them from the
  toolbar; the desktop app persists them per user, the browser build uses `localStorage`.
- **Shareable URLs** — filters, sort, view, and the open transaction are encoded in the address bar.
- Correct POS-local time handling; suspended and training transactions are excluded from sales figures.

## Tech stack

Bun runtime · TypeScript · Vite · Tailwind CSS — no frontend framework, no heavy dependencies.

## Getting started

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3

```bash
make install     # install dependencies (bun install)
make dev         # run the API (:3000) and the web app (:5173) together
```

Then open **http://localhost:5173**.

### Other commands

```bash
make build       # bundle the web app to dist/
make typecheck   # type-check with tsc
make start       # run the production API server
```

## Desktop app (Tauri)

The web UI and the Bun backend can be packaged into a single native desktop app with
[Tauri](https://tauri.app). The backend is compiled to a standalone binary and shipped as a **sidecar**
that the app launches on startup; the UI runs in the system webview.

**Extra prerequisites:** the [Rust toolchain](https://rustup.rs) and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS
(e.g. `webkit2gtk` on Linux).

```bash
make app-dev     # run the desktop app in development
make app         # build a distributable (src-tauri/target/release/bundle/)
```

Both targets first compile the backend into a sidecar via `make sidecar`.

## Configuration

| Variable               | Default             | Description                                   |
| ---------------------- | ------------------- | --------------------------------------------- |
| `PORT`                 | `3000`              | API server port                               |
| `REMOTE_LOOKUP_SERVER` | `demo.elvispos.com` | Default remote database host (fallback)       |

The active database host is chosen at runtime from the toolbar and can be changed with
`POST /api/server`. Saved servers are stored per user: the desktop app writes `servers.json` to the
OS config directory (e.g. `~/.config/com.elvispos.rdblog-explorer/` on Linux,
`~/Library/Application Support/…` on macOS, `%APPDATA%\…` on Windows); the browser build uses
`localStorage`. All queries are `SELECT`-only.

## API

| Endpoint                   | Description                                        |
| -------------------------- | ------------------------------------------------- |
| `GET/POST /api/server`     | Read or switch the active database host           |
| `GET /api/transactions`    | Paginated list with summary totals                |
| `GET /api/transactions.csv`| Export the filtered result set as CSV             |
| `GET /api/transactions/:key`| Detail: items, payments, discounts, tax          |
| `GET /api/facets`          | Distinct stores, terminals, and operators         |
| `GET /api/exceptions`      | Flagged transactions and operator risk            |
| `GET /api/health`          | Health check                                      |

## Project structure

```
server/index.ts   Bun API — read-only PostgreSQL proxy
src/main.ts       Frontend app — vanilla TypeScript + Tailwind
src-tauri/        Tauri v2 desktop shell (spawns the API as a sidecar)
scripts/          Dev orchestration and sidecar build
resources/        Database schema and project notes
```

## License

Released under the ISC License.
