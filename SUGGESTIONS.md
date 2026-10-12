# PostgreSQL optimization suggestions

Candidate schema/index changes that **may** speed up the queries this app issues against the
`rdb_log` family of tables. Every query the frontend sends is `SELECT`-only and lives in
[`src/main.ts`](src/main.ts) — the main list (`listSelect` + `transactionWhere`), the summary and
discount aggregates (`fetchTransactions`), the exceptions scan (`fetchExceptions`), the detail
drawer (`fetchDetails`), and the filter facets (`loadFacets`).

> **These are hypotheses, not guarantees.** Measure each one on real data before and after with
> `EXPLAIN (ANALYZE, BUFFERS)` and keep only the changes that actually help. They are DBA-side
> changes applied on the PostgreSQL server (the app has no schema access). Create indexes with
> `CREATE INDEX CONCURRENTLY` to avoid locking a live POS database, and remember every extra index
> slows down the constant POS `INSERT` traffic and uses disk — add them selectively.

Schema reference: [`resources/schema.md`](resources/schema.md). The logical join key across all
tables is `(dt_time_stamp[_st], n0_unique_str_no, n0_terminal_no, n0_xact_no)`.

---

## 0. Measure first

```sql
-- See where time actually goes for a representative query
EXPLAIN (ANALYZE, BUFFERS) /* paste a real query from main.ts here */;

-- Find the heaviest statements over time
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT query, calls, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Confirm which queries dominate before adding indexes; the suggestions below are ordered by
expected impact for the access patterns in the code, but your data distribution decides.

---

## 1. Child-table lookup indexes — highest impact

**Problem.** The detail drawer (`fetchDetails`) and the `EXISTS` / correlated subqueries in
`transactionWhere` and `DISCOUNT_TOTAL` match the child tables on:

```
n0_unique_str_no = … AND n0_terminal_no = … AND n0_xact_no = … AND dt_time_stamp (= or day-range)
```

But each child table's primary key **leads with `dt_time_stamp, n0_operator_no, n0_sequence_no`**
(see `resources/schema.md`) — columns the app never constrains, placed *before* the store/terminal/
transaction columns it does. So:

- For the detail drawer, `dt_time_stamp` is used as a **day range** (`fetchDetails` only keeps the
  date: `date = parsed.timestamp.slice(0,10)`), so the PK's leading `dt_time_stamp` can only
  range-scan a whole day of rows and then filter the rest — potentially thousands of rows read to
  return one transaction's lines.
- `rdb_log_alert` has **no primary key and no index at all** — every drawer open triggers a full
  sequential scan of the entire alert table.

**Suggestion.** Add one composite index per child table that leads with the equality columns and
ends with the range/order column, so three equalities make the lookup immediately selective:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_item_key
  ON public.rdb_log_item     (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp, n0_sequence_no);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tender_key
  ON public.rdb_log_tender   (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp, n0_sequence_no);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_vat_key
  ON public.rdb_log_vat      (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp, n0_sequence_no);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_info_key
  ON public.rdb_log_info     (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp, n0_sequence_no);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_cust_key
  ON public.rdb_log_cust_account (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp, n0_sequence_no);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_receipt_key
  ON public.rdb_log_receipt  (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp);

-- rdb_log_alert currently has NO index — this is likely the single biggest win:
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_alert_key
  ON public.rdb_log_alert    (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp);
```

The same index serves both access patterns: the `EXISTS` subqueries match `dt_time_stamp` by
equality (= the header's exact timestamp), while the drawer matches it by day-range — leading with
the store/terminal/transaction equalities keeps both selective. Trailing `n0_sequence_no` also lets
the `ORDER BY n0_sequence_no` in `fetchDetails` be served by the index.

---

## 2. Discount-total covering index

`DISCOUNT_TOTAL` in `main.ts` is a correlated subquery that re-sums `rdb_log_discount` **per result
row** in the list and inside the exceptions predicate:

```sql
SUM(COALESCE(d.n2_allowance,0) + COALESCE(d.n2_perc_off_amount,0))
  WHERE d.<4-key> = h.<4-key> AND COALESCE(d.bl_voided,0) <> 1
```

A partial, covering index makes each sum an **index-only scan** (no heap access) and pre-applies the
`bl_voided` filter:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_discount_total
  ON public.rdb_log_discount (n0_unique_str_no, n0_terminal_no, n0_xact_no, dt_time_stamp)
  INCLUDE (n2_allowance, n2_perc_off_amount)
  WHERE COALESCE(bl_voided, 0) <> 1;
```

This also accelerates the standalone discount-aggregate join in `fetchTransactions` (same 4-key
join + `bl_voided <> 1`). If you add this, it can replace `ix_discount_key` from §1 for the discount
table (it covers the same lookup plus the sum).

---

## 3. Header hot-path partial index

Every list/summary/exceptions query starts from the same constant base predicate in
`transactionWhere`:

```
h.n0_trans_type = 0 AND h.bl_suspended = 0 AND h.bl_training = 0
```

plus a `dt_time_stamp_st` date range, ordered by `dt_time_stamp_st DESC` in the default sort. The
`rdb_log` primary key leads with `dt_time_stamp_st`, so the range is sargable, but the three flag
predicates are post-filters. A **partial index** bakes those constants in and preserves the default
sort order:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_rdb_log_sales_bytime
  ON public.rdb_log (dt_time_stamp_st DESC)
  WHERE n0_trans_type = 0 AND bl_suspended = 0 AND bl_training = 0;
```

This directly serves the most common screen (a date range in the default "newest first" order) and
keeps the index small because it only covers sale transactions.

- If filtering by **store/terminal** is common, consider instead:
  `… (n0_unique_str_no, n0_terminal_no, dt_time_stamp_st DESC) WHERE <same base predicate>`.
- The non-default sorts (`amount`, `operator`, etc. in `SORT_COLUMNS`) won't use this index for
  ordering; add per-sort partial indexes **only** if those sorts are measured to be hot, e.g.
  `… (n2_amount_price DESC) WHERE <base predicate>`.

---

## 4. Expression indexes (or normalization) for text filters

Several predicates wrap columns in `TRIM(COALESCE(...))`, which prevents a plain-column index from
being used:

- Operator filter & grouping: `TRIM(COALESCE(h.sz_employee_no,'')) = …` (list) and `GROUP BY` it
  (exceptions `operators`).
- Tender filter: `TRIM(COALESCE(t.sz_description, t.sz_tender_type,'')) IN (…)`.

Add matching **expression indexes** so the planner can use them:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_rdb_log_operator
  ON public.rdb_log ((TRIM(COALESCE(sz_employee_no, ''))))
  WHERE n0_trans_type = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tender_desc
  ON public.rdb_log_tender ((TRIM(COALESCE(sz_description, sz_tender_type, ''))));
```

**Better long term:** store these already-trimmed/normalized (the `sz_item_ref_no`,
`sz_customer_no`, `sz_misc_account` columns are fixed-width `character(n)` padded with spaces, which
is why the code keeps calling `TRIM`). Normalizing to `varchar`/`text` without padding removes the
need for `TRIM` wrappers and lets ordinary indexes apply everywhere.

---

## 5. Facets — avoid `SELECT DISTINCT` over whole tables

`loadFacets` runs four `SELECT DISTINCT …` scans over the full `rdb_log` / `rdb_log_tender` tables on
every app load (stores, terminals, operators, payment types). These values change rarely, so a
**materialized view** refreshed on a schedule is far cheaper than scanning the base tables each time:

```sql
CREATE MATERIALIZED VIEW mv_rdb_facets AS
  SELECT 'store'    AS kind, n0_unique_str_no::text AS value FROM public.rdb_log WHERE n0_trans_type = 0 GROUP BY 1,2
  UNION ALL
  SELECT 'terminal', n0_terminal_no::text FROM public.rdb_log WHERE n0_trans_type = 0 GROUP BY 1,2
  UNION ALL
  SELECT 'operator', TRIM(COALESCE(sz_employee_no,'')) FROM public.rdb_log
    WHERE n0_trans_type = 0 AND TRIM(COALESCE(sz_employee_no,'')) <> '' GROUP BY 1,2
  UNION ALL
  SELECT 'payment', TRIM(COALESCE(sz_description, sz_tender_type,'')) FROM public.rdb_log_tender
    WHERE TRIM(COALESCE(sz_description, sz_tender_type,'')) <> '' GROUP BY 1,2;

CREATE UNIQUE INDEX ON mv_rdb_facets (kind, value);
-- Refresh periodically (cron / scheduled job):
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_rdb_facets;
```

If a materialized view isn't desirable, the partial expression indexes from §3/§4 at least let these
`DISTINCT` scans run as cheaper index-only scans.

---

## 6. Search (`ILIKE '%term%'`) — optional, with a caveat

The search builds leading-wildcard `ILIKE '%term%'` predicates (`transactionWhere`, `search` branch).
B-tree indexes cannot serve a leading wildcard. A `pg_trgm` GIN index can:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_item_desc_trgm
  ON public.rdb_log_item USING gin (sz_description gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_item_ref_trgm
  ON public.rdb_log_item USING gin ((TRIM(sz_item_ref_no)) gin_trgm_ops);
```

**Caveat:** today the item search is a *correlated* `EXISTS` tied to each header row's key, so the
`ILIKE` only runs over a single transaction's items at a time — the §1 `ix_item_key` is what makes it
fast, and the trigram index helps mainly if you later refactor search into a standalone item scan.
The header-side `CAST(h.n0_xact_no AS text) ILIKE …` is a cheap per-row expression and generally not
worth indexing.

---

## 7. Exceptions scan

`fetchExceptions` filters with an `OR` of four conditions, one of which is the `DISCOUNT_TOTAL`
correlated subquery:

```
bl_refund = '1' OR bl_voided = 1 OR n2_amount_price <= 0 OR DISCOUNT_TOTAL > n2_amount_price/2
```

- The partial index (§3) + date range narrows the scanned set first; the discount covering index
  (§2) makes the per-row sum cheap. Those two alone should help the most.
- For the first three OR branches, PostgreSQL can combine small partial indexes via `BitmapOr`:

  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_rdb_log_refunded
    ON public.rdb_log (dt_time_stamp_st DESC) WHERE bl_refund = 1;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_rdb_log_voided
    ON public.rdb_log (dt_time_stamp_st DESC) WHERE bl_voided = 1;
  ```

- The `DISCOUNT_TOTAL > amount/2` branch can't be indexed as-is. If exceptions become slow on large
  ranges, consider rewriting it as a `LEFT JOIN LATERAL` that computes the discount once per row, or
  materializing a per-transaction discount total (see §8).

---

## 8. Scale-out options (larger, evaluate carefully)

- **Precomputed discount total.** `DISCOUNT_TOTAL` is recomputed in multiple queries. A summary
  column on `rdb_log` (maintained by trigger) or a small `rdb_log_discount_totals` roll-up table
  keyed by the 4-key would turn repeated correlated sums into a single lookup/join.
- **BRIN index on time.** POS logs are typically appended in timestamp order, so
  `CREATE INDEX … USING brin (dt_time_stamp_st)` is a tiny index that accelerates date-range scans
  on very large tables (it won't help `ORDER BY`, so pair with §3 for the default sort).
- **Range partitioning** of `rdb_log` (and children) by `dt_time_stamp_st` (e.g. monthly) lets
  date-bounded queries prune partitions and keeps per-partition indexes small — worthwhile once the
  tables are very large, at the cost of a migration and partition maintenance.
- **Extended statistics** for correlated filter columns improve row estimates and plan choice:
  `CREATE STATISTICS st_rdb_store_term (dependencies) ON n0_unique_str_no, n0_terminal_no FROM public.rdb_log;`
- **Keyset pagination.** `listSelect` uses `OFFSET (page-1)*25`, which gets slower the deeper you
  page (rows are scanned and discarded). A keyset approach
  (`WHERE dt_time_stamp_st < :last ORDER BY dt_time_stamp_st DESC LIMIT 26`) stays fast at any depth —
  this is an application change in `main.ts`, not a schema change.

---

## 9. Operational notes

- Add indexes **one at a time** and re-measure; drop any that `EXPLAIN` shows aren't used.
- These tables are write-heavy (live POS logging). Each index adds `INSERT` cost and disk usage; the
  partial/covering indexes above are deliberately narrow to limit that overhead.
- Keep statistics fresh: ensure autovacuum is enabled and `ANALYZE` runs regularly; index-only scans
  also depend on the visibility map being kept current by vacuum.
- Use `CREATE INDEX CONCURRENTLY` / `REFRESH MATERIALIZED VIEW CONCURRENTLY` to avoid blocking
  production traffic.

---

## 10. Cheapest win of all — stop fetching unused data (app-side)

`fetchDetails` currently also queries `rdb_log_info`, `rdb_log_cust_account` (loyalty), and
`rdb_log_alert`, but the detail drawer UI only renders items, payments, discounts, tax, and the
receipt. Not issuing those three extra queries removes their load entirely — no index required — and
is the fastest improvement available until those sections are actually shown. (If/when they are
shown, §1 covers them.)

---

### Summary checklist

| # | Change | Targets |
|---|--------|---------|
| 1 | 4-key composite indexes on every child table (**alert has none today**) | detail drawer, `EXISTS` subqueries |
| 2 | Partial covering index on `rdb_log_discount` | `DISCOUNT_TOTAL`, discount aggregate |
| 3 | Partial index on `rdb_log (dt_time_stamp_st DESC)` for sales | list, summary, exceptions |
| 4 | Expression indexes / normalize `TRIM(COALESCE(...))` text | operator & tender filters |
| 5 | Materialized view for facets | `loadFacets` |
| 6 | `pg_trgm` GIN on item text (optional) | search |
| 7 | Partial indexes + discount rewrite | exceptions scan |
| 8 | Precomputed discount, BRIN, partitioning, keyset paging | scale-out |
| 10 | Drop unused `info`/`loyalty`/`alert` fetches | detail drawer (app-side) |
