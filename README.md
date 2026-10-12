# RDB Log Explorer

> Sales Transaction Explorer for ElvisPOS `rdb_log` data.

[![Bun](https://img.shields.io/badge/Bun-1.3-000?logo=bun&logoColor=fff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)](https://vitejs.dev)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=fff)](https://svelte.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=fff)](https://tailwindcss.com)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

A single-page **web app** for browsing, analysing, and auditing point-of-sale transactions. The
frontend sends **read-only** queries to the remote lookup service and turns `rdb_log` data into a
searchable ledger and a loss-prevention view. The interface is **touch-first** (sized for 1024×768
and larger displays) and available in **Italian and English**.

## Features

- **Transactions** — filter by date range, type (sales / refunds / voided), payment method, loyalty
  card, and amount range; full-text search across article descriptions, item references, transaction
  numbers, and store numbers; sort by date, operator, amount, or discount; paginated results (25 per
  page) with live totals (transactions, sales total, average sale, discounts, refunds, voids).
- **Detail drawer** — line items, payments, discounts, and tax shown with per-section tables, plus a
  printable **receipt** view.
- **Exceptions** — a loss-prevention view that flags voided transactions, refunds, non-positive
  amounts, and heavy discounts with explainable reasons, alongside an **operator risk leaderboard**
  ranked by void/refund rate.
- **Direct remote lookup** — queries are built and sent by the single-page app; no local API process
  is required. All queries are `SELECT`-only.
- **Shareable URLs** — language, filters, sort, view, and the open transaction are encoded in the
  address bar.
- **Localised** — Italian (default) and English, selectable via the `?lang=` URL parameter, with
  locale-aware date and currency formatting.
- Correct POS-local time handling; suspended and training transactions are excluded from sales figures.

## Tech stack

Bun runtime · TypeScript · Svelte 5 · Vite · Tailwind CSS 4 · Flowbite Svelte. Internationalisation
is a lightweight, dependency-free store-based layer (see [`src/i18n/`](src/i18n)).

## Getting started

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3

```bash
make install     # install dependencies (bun install)
make dev         # run the web app (:5173)
```

Then open **http://localhost:5173**.

### Other commands

```bash
make build       # type-check and bundle the web app to dist/
make typecheck   # type-check with tsc + svelte-check
```

## Localisation

The UI ships with Italian (default) and English. The active language is resolved **once on load**
from the `lang` URL parameter:

- `?lang=it` — Italian (also the default when the parameter is absent or unrecognised)
- `?lang=en` — English

The chosen language is preserved in the address bar as you filter and navigate, so links remain
shareable. Dates and currency are formatted for the active locale (`it-IT` / `en-GB`, EUR).

To add or edit copy, update the matching keys in [`src/i18n/it.ts`](src/i18n/it.ts) and
[`src/i18n/en.ts`](src/i18n/en.ts); both dictionaries share the same set of keys.

## Configuration

| Variable                    | Default             | Description                                |
| --------------------------- | ------------------- | ------------------------------------------ |
| `VITE_REMOTE_LOOKUP_SERVER` | `demo.elvispos.com` | Remote lookup host (with an optional port) |

Set `VITE_REMOTE_LOOKUP_SERVER` in a `.env` file before starting Vite to use a different server.
The remote lookup service must allow cross-origin `POST` requests from the web app. All queries are
`SELECT`-only.

## Project structure

```
src/bootstrap.ts   Application entry point (initialises the locale, mounts the app)
src/App.svelte     Application lifecycle boundary
src/main.ts        Transaction explorer controller and query logic
src/components/    Svelte UI components (header, filters, views, detail drawer)
src/i18n/          Locale dictionaries (it, en) and the translator / formatters
src/style.css      Design system and Tailwind setup
resources/         Database schema and project notes
```

## License

Released under the ISC License.
