const REMOTE_LOOKUP_URL = "http://demo.elvispos.com:7392/api/db-operations/remote-lookup";
const PORT = Number(Bun.env.PORT ?? 3000);

type Filters = Record<string, string | undefined>;

const escapeLiteral = (value: string) => value.replaceAll("'", "''");
const isInteger = (value: string | undefined) => Boolean(value && /^\d+$/.test(value));
const isNumber = (value: string | undefined) => Boolean(value && /^-?\d+(\.\d+)?$/.test(value));

async function remoteQuery(query: string) {
  const response = await fetch(REMOTE_LOOKUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request: { command: 1003, query } }),
  });
  if (!response.ok) throw new Error(`Remote database returned ${response.status}`);
  const body = await response.text();
  const result = body.trim();
  return !result || result.startsWith("NO DATA") || result.startsWith("NO RECORD FOUND") ? [] : JSON.parse(result);
}

function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function transactionWhere(filters: Filters) {
  const clauses = ["h.n0_trans_type = 0"];
  if (isInteger(filters.store)) clauses.push(`h.n0_unique_str_no = ${filters.store}`);
  if (isInteger(filters.terminal)) clauses.push(`h.n0_terminal_no = ${filters.terminal}`);
  if (isInteger(filters.operator)) clauses.push(`h.n0_operator_no = ${filters.operator}`);
  if (filters.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) clauses.push(`h.dt_time_stamp_st >= '${filters.dateFrom}'::date`);
  if (filters.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) clauses.push(`h.dt_time_stamp_st < ('${filters.dateTo}'::date + interval '1 day')`);
  if (isNumber(filters.minAmount)) clauses.push(`h.n2_amount_price >= ${Math.round(Number(filters.minAmount) * 100)}`);
  if (isNumber(filters.maxAmount)) clauses.push(`h.n2_amount_price <= ${Math.round(Number(filters.maxAmount) * 100)}`);
  if (filters.search?.trim()) {
    const term = escapeLiteral(filters.search.trim());
    clauses.push(`(CAST(h.n0_xact_no AS text) ILIKE '%${term}%' OR CAST(h.n0_unique_str_no AS text) ILIKE '%${term}%' OR EXISTS (SELECT 1 FROM public.rdb_log_item i WHERE i.dt_time_stamp = h.dt_time_stamp_st AND i.n0_unique_str_no = h.n0_unique_str_no AND i.n0_terminal_no = h.n0_terminal_no AND i.n0_xact_no = h.n0_xact_no AND (i.sz_description ILIKE '%${term}%' OR TRIM(i.sz_item_ref_no) ILIKE '%${term}%')))`);
  }
  return clauses.join(" AND ");
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return response({ ok: true });
    try {
      if (url.pathname === "/api/transactions") {
        const filters = Object.fromEntries(url.searchParams) as Filters;
        const sortColumns: Record<string, string> = { date: "h.dt_time_stamp_st", amount: "h.n2_amount_price", store: "h.n0_unique_str_no", terminal: "h.n0_terminal_no", operator: "h.n0_operator_no" };
        const sort = sortColumns[filters.sort ?? "date"] ?? sortColumns.date;
        const direction = filters.direction === "asc" ? "ASC" : "DESC";
        const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
        const rows = await remoteQuery(`SELECT h.dt_time_stamp_st, h.n0_unique_str_no, h.n0_terminal_no, h.n0_xact_no, h.n0_operator_no, h.n2_amount_price, h.n0_tot_sold_item, h.n2_tot_disc_amt, h.bl_refund, h.bl_loyalty FROM public.rdb_log h WHERE ${transactionWhere(filters)} ORDER BY ${sort} ${direction}, h.dt_time_stamp_st DESC LIMIT 26 OFFSET ${(page - 1) * 25}`) as unknown[];
        return response({ rows: rows.slice(0, 25), hasMore: rows.length > 25, page });
      }
      const match = url.pathname.match(/^\/api\/transactions\/(.+)$/);
      if (match) {
        const key = JSON.parse(decodeURIComponent(match[1])) as Record<string, string | number>;
        if (!key.timestamp || !isInteger(String(key.store)) || !isInteger(String(key.terminal)) || !isInteger(String(key.transaction))) return response({ error: "Invalid transaction key" }, 400);
        const timestamp = escapeLiteral(String(key.timestamp));
        const where = `dt_time_stamp = '${timestamp}'::timestamp AND n0_unique_str_no = ${key.store} AND n0_terminal_no = ${key.terminal} AND n0_xact_no = ${key.transaction}`;
        const [items, tenders, discounts, vat] = await Promise.all([
          remoteQuery(`SELECT n0_sequence_no, sz_description, sz_item_ref_no, n0_quantity, n2_amount_price, n2_ext_price, bl_return FROM public.rdb_log_item WHERE ${where} ORDER BY n0_sequence_no`),
          remoteQuery(`SELECT n0_sequence_no, sz_description, sz_tender_type, n2_amount, sz_auth_number FROM public.rdb_log_tender WHERE ${where} ORDER BY n0_sequence_no`),
          remoteQuery(`SELECT n0_sequence_no, sz_description, n0_perc_off, n2_perc_off_amount, n2_allowance FROM public.rdb_log_discount WHERE ${where} ORDER BY n0_sequence_no`),
          remoteQuery(`SELECT n0_tax_code, n2_sold_amount, n2_vat_amount, n3_vat_percentage FROM public.rdb_log_vat WHERE ${where} ORDER BY n0_sequence_no`),
        ]);
        return response({ items, tenders, discounts, vat });
      }
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "Query failed" }, 502);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Sales Explorer API listening on http://localhost:${PORT}`);