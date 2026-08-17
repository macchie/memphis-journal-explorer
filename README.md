# RDB Log Explorer

> Sales Transaction Explorer for ElvisPOS `rdb_log` data.

[![Bun](https://img.shields.io/badge/Bun-1.3-000?logo=bun&logoColor=fff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=fff)](https://tailwindcss.com)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

A clean web app, backed by a lightweight [Bun](https://bun.sh) server, for browsing, analyzing, and
auditing point-of-sale transactions. The backend runs **read-only** queries against the PostgreSQL
`rdb_log` tables; the UI turns them into a searchable ledger, sales analytics, and a loss-prevention view.

## Features

- **Transactions** — filter and sort by date, amount, store, terminal, and operator; full-text search
  across articles, references, and transaction numbers; paginated results with live totals and one-click
  **CSV export**.
- **Detail drawer** — line items, payments, discounts, and tax with per-section totals, plus a
  printable **receipt** view.
- **Insights** — revenue by day, hour, store, and operator, and top-selling products.
- **Exceptions** — a loss-prevention radar that flags voids, refunds, and heavy discounts, ranked by
  risk, with an operator risk leaderboard.
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

## Configuration

| Variable            | Default | Description                     |
| ------------------- | ------- | ------------------------------- |
| `PORT`              | `3000`  | API server port                 |

The remote database endpoint is defined by `REMOTE_LOOKUP_URL` in [`server/index.ts`](server/index.ts).
All queries are `SELECT`-only.

## API

| Endpoint                   | Description                                        |
| -------------------------- | ------------------------------------------------- |
| `GET /api/transactions`    | Paginated list with summary totals                |
| `GET /api/transactions.csv`| Export the filtered result set as CSV             |
| `GET /api/transactions/:key`| Detail: items, payments, discounts, tax          |
| `GET /api/facets`          | Distinct stores, terminals, and operators         |
| `GET /api/insights`        | Aggregates by day, hour, store, operator, product |
| `GET /api/exceptions`      | Flagged transactions and operator risk            |
| `GET /api/health`          | Health check                                      |

## Project structure

```
server/index.ts   Bun API — read-only PostgreSQL proxy
src/main.ts       Frontend app — vanilla TypeScript + Tailwind
resources/        Database schema and project notes
```

## License

Released under the ISC License.
