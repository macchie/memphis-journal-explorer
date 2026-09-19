# RDB Log Explorer

> Sales Transaction Explorer for ElvisPOS `rdb_log` data.

[![Bun](https://img.shields.io/badge/Bun-1.3-000?logo=bun&logoColor=fff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)](https://vitejs.dev)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=fff)](https://svelte.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=fff)](https://tailwindcss.com)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=fff)](https://tauri.app)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

A clean web app for browsing, analyzing, and auditing point-of-sale transactions. The frontend sends
**read-only** queries to the remote lookup service and turns `rdb_log` data into a searchable ledger
and a loss-prevention view.
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
- **Direct remote lookup** — queries are built and sent by the single-page application; no local API
  process or desktop sidecar is required.
- **Shareable URLs** — filters, sort, view, and the open transaction are encoded in the address bar.
- Correct POS-local time handling; suspended and training transactions are excluded from sales figures.

## Tech stack

Bun runtime · TypeScript · Svelte 5 · Vite · Tailwind CSS · Tauri.

## Getting started

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3

```bash
make install     # install dependencies (bun install)
make dev         # run the web app (:5173)
```

Then open **http://localhost:5173**.

### Other commands

```bash
make build       # bundle the web app to dist/
make typecheck   # type-check with tsc
```

## Desktop app (Tauri)

The web UI can be packaged into a native desktop app with [Tauri](https://tauri.app). The UI runs in
the system webview and contacts the remote lookup service directly.

**Extra prerequisites:** the [Rust toolchain](https://rustup.rs) and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS
(e.g. `webkit2gtk` on Linux).

```bash
make app-dev     # run the desktop app in development
make app         # build a distributable (src-tauri/target/release/bundle/)
```

## Configuration

| Variable               | Default             | Description                                   |
| ---------------------- | ------------------- | --------------------------------------------- |
| `VITE_REMOTE_LOOKUP_SERVER` | `demo.elvispos.com` | Remote lookup host (with an optional port) |

Set `VITE_REMOTE_LOOKUP_SERVER` in a `.env` file before starting Vite to use a different server.
The remote lookup service must allow cross-origin `POST` requests from the web app. All queries are
`SELECT`-only.

## Project structure

```
src/bootstrap.ts  Svelte application entry point
src/App.svelte    Svelte application lifecycle boundary
src/main.ts       Transaction explorer controller and query logic
src-tauri/        Tauri v2 desktop shell
resources/        Database schema and project notes
```

## License

Released under the ISC License.
