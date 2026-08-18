// Active remote database host. Defaults to the env value but can be switched at runtime via POST /api/server
// (the desktop app persists the chosen server per user and re-applies it on launch).
const DEFAULT_SERVER = Bun.env.REMOTE_LOOKUP_SERVER ?? "demo.elvispos.com";
const SERVER_PATTERN = /^[a-zA-Z0-9.\-]+(:\d{1,5})?$/;
let remoteServer = DEFAULT_SERVER;
const remoteLookupUrl = () => `http://${remoteServer.includes(":") ? remoteServer : `${remoteServer}:7392`}/api/db-operations/remote-lookup`;
const PORT = Number(Bun.env.PORT ?? 3000);

type Filters = Record<string, string | undefined>;
type Row = Record<string, string | number | null>;

const escapeLiteral = (value: string) => value.replaceAll("'", "''");
const isInteger = (value: string | undefined) => Boolean(value && /^\d+$/.test(value));
const isNumber = (value: string | undefined) => Boolean(value && /^-?\d+(\.\d+)?$/.test(value));
const num = (value: unknown) => Number(value ?? 0);

async function remoteQuery(query: string): Promise<Row[]> {
  let response: Response;
  try {
    response = await fetch(remoteLookupUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { command: 1003, query } }),
      signal: AbortSignal.timeout(15000), // fail fast when the selected server is unreachable
    });
  } catch {
    throw new Error(`Could not reach ${remoteServer}`);
  }
  if (!response.ok) throw new Error(`Remote database returned ${response.status}`);
  const result = (await response.text()).trim();
  if (!result || result.startsWith("NO DATA") || result.startsWith("NO RECORD FOUND")) return [];
  if (result.startsWith("SQL ERROR")) throw new Error("Query rejected by remote database");
  return JSON.parse(result);
}

// Allow the bundled desktop webview (a different origin) to call this local API.
const CORS = { "Access-Control-Allow-Origin": "*" };

function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...CORS } });
}

// Per-header discount total (non-voided) — reused by the list, summary, and exceptions queries.
const DISCOUNT_TOTAL = "COALESCE((SELECT SUM(COALESCE(d.n2_allowance, 0) + COALESCE(d.n2_perc_off_amount, 0)) FROM public.rdb_log_discount d WHERE d.dt_time_stamp = h.dt_time_stamp_st AND d.n0_unique_str_no = h.n0_unique_str_no AND d.n0_terminal_no = h.n0_terminal_no AND d.n0_xact_no = h.n0_xact_no AND COALESCE(d.bl_voided, 0) <> 1), 0)";

const SORT_COLUMNS: Record<string, string> = { date: "h.dt_time_stamp_st", amount: "h.n2_amount_price", store: "h.n0_unique_str_no", terminal: "h.n0_terminal_no", operator: "h.n0_operator_no", discount: "discount_total" };

function transactionWhere(filters: Filters) {
  const clauses = ["h.n0_trans_type = 0", "h.bl_suspended = 0", "h.bl_training = 0"];
  if (isInteger(filters.store)) clauses.push(`h.n0_unique_str_no = ${filters.store}`);
  if (isInteger(filters.terminal)) clauses.push(`h.n0_terminal_no = ${filters.terminal}`);
  if (isInteger(filters.operator)) clauses.push(`h.n0_operator_no = ${filters.operator}`);
  // Transaction type derived from the header flags: a "sale" is a normal, non-refund, non-voided line.
  if (filters.type === "voided") clauses.push("COALESCE(h.bl_voided, 0) = 1");
  else if (filters.type === "refund") clauses.push("COALESCE(h.bl_refund, 0) = 1");
  else if (filters.type === "sale") clauses.push("COALESCE(h.bl_refund, 0) <> 1 AND COALESCE(h.bl_voided, 0) <> 1");
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

const listSelect = (where: string, sort: string, direction: string, limit: number, offset = 0) =>
  `SELECT h.dt_time_stamp_st, h.n0_unique_str_no, h.n0_terminal_no, h.n0_xact_no, h.n0_operator_no, h.n2_amount_price, h.n0_tot_sold_item, h.bl_refund, h.bl_loyalty, h.bl_voided, ${DISCOUNT_TOTAL} AS discount_total FROM public.rdb_log h WHERE ${where} ORDER BY ${sort} ${direction}, h.dt_time_stamp_st DESC LIMIT ${limit} OFFSET ${offset}`;

// --- endpoint handlers -----------------------------------------------------

async function transactionsList(filters: Filters) {
  const where = transactionWhere(filters);
  const sort = SORT_COLUMNS[filters.sort ?? "date"] ?? SORT_COLUMNS.date;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const [rows, summary, discount] = await Promise.all([
    remoteQuery(listSelect(where, sort, direction, 26, (page - 1) * 25)),
    // Voided transactions stay in the list (and count) but must not contribute to the money totals,
    // so the sales/refund aggregates filter them out and we surface the void count separately.
    remoteQuery(`SELECT count(*) total, COALESCE(SUM(h.n2_amount_price) FILTER (WHERE h.bl_refund <> '1' AND COALESCE(h.bl_voided, 0) <> 1), 0) sales, count(*) FILTER (WHERE h.bl_refund = '1' AND COALESCE(h.bl_voided, 0) <> 1) refunds, count(*) FILTER (WHERE COALESCE(h.bl_voided, 0) = 1) voids FROM public.rdb_log h WHERE ${where}`),
    remoteQuery(`SELECT COALESCE(SUM(COALESCE(d.n2_allowance, 0) + COALESCE(d.n2_perc_off_amount, 0)), 0) disc FROM public.rdb_log_discount d JOIN public.rdb_log h ON h.dt_time_stamp_st = d.dt_time_stamp AND h.n0_unique_str_no = d.n0_unique_str_no AND h.n0_terminal_no = d.n0_terminal_no AND h.n0_xact_no = d.n0_xact_no WHERE ${where} AND COALESCE(d.bl_voided, 0) <> 1 AND COALESCE(h.bl_voided, 0) <> 1`),
  ]);
  return response({
    rows: rows.slice(0, 25),
    hasMore: rows.length > 25,
    page,
    total: num(summary[0]?.total),
    salesTotal: num(summary[0]?.sales),
    refundCount: num(summary[0]?.refunds),
    voidCount: num(summary[0]?.voids),
    discountTotal: num(discount[0]?.disc),
  });
}

async function transactionsCsv(filters: Filters) {
  const where = transactionWhere(filters);
  const sort = SORT_COLUMNS[filters.sort ?? "date"] ?? SORT_COLUMNS.date;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const rows = await remoteQuery(listSelect(where, sort, direction, 5000));
  const header = ["Date/time", "Transaction", "Store", "Terminal", "Operator", "Amount", "Discount", "Items", "Refund", "Loyalty", "Voided"];
  const cell = (value: unknown) => { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  const body = rows.map((r) => [
    String(r.dt_time_stamp_st ?? "").slice(0, 19).replace("T", " "),
    r.n0_xact_no, r.n0_unique_str_no, r.n0_terminal_no, r.n0_operator_no,
    (num(r.n2_amount_price) / 100).toFixed(2),
    (num(r.discount_total) / 100).toFixed(2),
    r.n0_tot_sold_item,
    r.bl_refund === "1" ? "yes" : "no",
    r.bl_loyalty ? "yes" : "no",
    num(r.bl_voided) === 1 ? "yes" : "no",
  ].map(cell).join(","));
  const csv = [header.join(","), ...body].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store", ...CORS } });
}

async function exceptions(filters: Filters) {
  const where = transactionWhere(filters);
  const transactionMatch = (table: string) => `${table}.dt_time_stamp = h.dt_time_stamp_st AND ${table}.n0_unique_str_no = h.n0_unique_str_no AND ${table}.n0_terminal_no = h.n0_terminal_no AND ${table}.n0_xact_no = h.n0_xact_no`;
  // Bring independently recorded POS evidence into the exception scan. The correlated aggregates keep
  // one candidate row per transaction and remain read-only against the source database.
  const flagInner = `SELECT h.dt_time_stamp_st, h.n0_unique_str_no store, h.n0_terminal_no term, h.n0_xact_no xact, h.n0_operator_no oper, h.n2_amount_price amount, h.bl_refund, h.bl_voided, h.bl_void_prev, COALESCE(h.n0_tot_itm_voided, 0) item_voids, ${DISCOUNT_TOTAL} AS disc, COALESCE((SELECT COUNT(*) FROM public.rdb_log_item i WHERE ${transactionMatch("i")} AND (COALESCE(i.bl_price_req, 0) = 1 OR COALESCE(i.bl_quant_req, 0) = 1)), 0) manual_entries, COALESCE((SELECT COUNT(*) FROM public.rdb_log_item i WHERE ${transactionMatch("i")} AND COALESCE(i.bl_return, 0) = 1), 0) item_returns, COALESCE((SELECT COUNT(*) FROM public.rdb_log_item i WHERE ${transactionMatch("i")} AND COALESCE(i.bl_mgr_voided, 0) = 1), 0) manager_voids, COALESCE((SELECT COUNT(*) FROM public.rdb_log_tender t WHERE ${transactionMatch("t")} AND (COALESCE(t.bl_offline, 0) = 1 OR COALESCE(t.bl_denied, 0) = 1 OR COALESCE(t.bl_host_denied, 0) = 1)), 0) tender_issues, COALESCE((SELECT MAX(a.n0_alert_severity) FROM public.rdb_log_alert a WHERE ${transactionMatch("a")}), 0) alert_severity, COALESCE((SELECT COUNT(*) FROM public.rdb_log_cust_account c WHERE ${transactionMatch("c")}), 0) loyalty_changes, COALESCE(EXTRACT(EPOCH FROM (h.dt_time_stamp_end - h.dt_time_stamp_st)), 0) duration_seconds FROM public.rdb_log h WHERE ${where}`;
  const [candidates, operatorsRaw] = await Promise.all([
    remoteQuery(`SELECT * FROM (${flagInner}) t WHERE t.bl_refund = '1' OR t.bl_voided = '1' OR t.bl_void_prev = '1' OR t.item_voids > 0 OR t.amount <= 0 OR (t.amount > 0 AND t.disc > t.amount / 2) OR t.manual_entries > 0 OR t.item_returns > 0 OR t.manager_voids > 0 OR t.tender_issues > 0 OR t.alert_severity >= 3 OR t.loyalty_changes > 0 OR t.duration_seconds > 1200 ORDER BY t.dt_time_stamp_st DESC LIMIT 200`),
    remoteQuery(`SELECT h.n0_operator_no oper, count(*) txns, count(*) FILTER (WHERE h.bl_refund = '1') refunds, count(*) FILTER (WHERE h.bl_voided = '1') voids FROM public.rdb_log h WHERE ${where} GROUP BY 1`),
  ]);

  const flagged = candidates.map((r) => {
    const amount = num(r.amount), discount = num(r.disc), itemVoids = num(r.item_voids), manualEntries = num(r.manual_entries), itemReturns = num(r.item_returns), managerVoids = num(r.manager_voids), tenderIssues = num(r.tender_issues), alertSeverity = num(r.alert_severity), loyaltyChanges = num(r.loyalty_changes), durationSeconds = num(r.duration_seconds);
    const reasons: { label: string; weight: number }[] = [];
    if (num(r.bl_voided) === 1) reasons.push({ label: "Voided transaction", weight: 40 });
    if (num(r.bl_void_prev) === 1) reasons.push({ label: "Voided a previous sale", weight: 35 });
    if (num(r.bl_refund) === 1) reasons.push({ label: "Refund", weight: 30 });
    if (itemVoids > 0) reasons.push({ label: `${itemVoids} item void${itemVoids > 1 ? "s" : ""}`, weight: 10 + itemVoids * 5 });
    if (amount <= 0) reasons.push({ label: "Non-positive amount", weight: 20 });
    if (amount > 0 && discount > amount / 2) reasons.push({ label: `Heavy discount (${Math.round((discount / amount) * 100)}%)`, weight: 30 });
    if (manualEntries > 0) reasons.push({ label: `${manualEntries} manual item entr${manualEntries > 1 ? "ies" : "y"}`, weight: 10 + manualEntries * 5 });
    if (itemReturns > 0) reasons.push({ label: `${itemReturns} returned item${itemReturns > 1 ? "s" : ""}`, weight: 15 + itemReturns * 5 });
    if (managerVoids > 0) reasons.push({ label: `${managerVoids} manager item void${managerVoids > 1 ? "s" : ""}`, weight: 25 + managerVoids * 5 });
    if (tenderIssues > 0) reasons.push({ label: `${tenderIssues} tender issue${tenderIssues > 1 ? "s" : ""}`, weight: 25 + tenderIssues * 5 });
    if (alertSeverity >= 3) reasons.push({ label: `High-severity POS alert (${alertSeverity})`, weight: 15 + alertSeverity * 5 });
    if (loyaltyChanges > 0) reasons.push({ label: `${loyaltyChanges} loyalty account change${loyaltyChanges > 1 ? "s" : ""}`, weight: 8 + loyaltyChanges * 2 });
    if (durationSeconds > 1200) reasons.push({ label: `Long transaction (${Math.round(durationSeconds / 60)} min)`, weight: 15 });
    return { dt_time_stamp_st: r.dt_time_stamp_st, n0_unique_str_no: r.store, n0_terminal_no: r.term, n0_xact_no: r.xact, n0_operator_no: r.oper, n2_amount_price: amount, discount_total: discount, reasons: reasons.map((x) => x.label), score: reasons.reduce((s, x) => s + x.weight, 0) };
  }).sort((a, b) => b.score - a.score);

  const operators = operatorsRaw.map((r) => {
    const txns = num(r.txns), voids = num(r.voids), refunds = num(r.refunds);
    return { operator: String(r.oper), txns, voids, refunds, voidRate: txns ? voids / txns : 0, risk: txns ? Math.round(((voids * 40 + refunds * 30) / txns)) : 0 };
  }).filter((o) => o.txns >= 5).sort((a, b) => b.risk - a.risk).slice(0, 10);

  return response({ flagged, operators });
}

async function transactionDetail(rawKey: string) {
  const key = JSON.parse(decodeURIComponent(rawKey)) as Record<string, string | number>;
  const date = String(key.timestamp ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isInteger(String(key.store)) || !isInteger(String(key.terminal)) || !isInteger(String(key.transaction))) return response({ error: "Invalid transaction key" }, 400);
  // Join on the calendar day only — a store/terminal/transaction is (almost always) unique within a
  // day, so this tolerates sub-second timestamp drift between the header and its detail rows.
  const dayRange = (column: string) => `${column} >= '${date}'::date AND ${column} < '${date}'::date + interval '1 day'`;
  const keyMatch = `n0_unique_str_no = ${key.store} AND n0_terminal_no = ${key.terminal} AND n0_xact_no = ${key.transaction}`;
  // Detail tables carry no bl_suspended flag, so drop rows recorded at a suspended header's timestamp.
  const notSuspended = `dt_time_stamp NOT IN (SELECT dt_time_stamp_st FROM public.rdb_log WHERE n0_trans_type = 0 AND bl_suspended <> 0 AND ${keyMatch} AND ${dayRange("dt_time_stamp_st")})`;
  const where = `${dayRange("dt_time_stamp")} AND ${keyMatch} AND ${notSuspended}`;
  const [items, tenders, discounts, vat, info, loyalty, alerts, receiptRows] = await Promise.all([
    remoteQuery(`SELECT n0_sequence_no, sz_description, sz_item_ref_no, n0_quantity, n2_amount_price, n2_ext_price, bl_return FROM public.rdb_log_item WHERE ${where} ORDER BY n0_sequence_no`),
    remoteQuery(`SELECT n0_sequence_no, sz_description, sz_tender_type, n2_amount, sz_auth_number FROM public.rdb_log_tender WHERE ${where} ORDER BY n0_sequence_no`),
    remoteQuery(`SELECT n0_sequence_no, sz_description, n0_perc_off, (COALESCE(n2_allowance, 0) + COALESCE(n2_perc_off_amount, 0)) AS n2_disc_amount FROM public.rdb_log_discount WHERE ${where} ORDER BY n0_sequence_no`),
    remoteQuery(`SELECT n0_tax_code, n2_sold_amount, n2_vat_amount, n3_vat_percentage FROM public.rdb_log_vat WHERE ${where} ORDER BY n0_sequence_no`),
    // Per-transaction event trail (each row a timestamped POS event: FIRST_ITEM, SUBTOTAL,
    // SOLD_ITEM : n, START_PAYMENT, END_TRANSACTION, START/END_PAUSE) used to build the activity timeline.
    remoteQuery(`SELECT n0_sequence_no, dt_time_stamp, sz_info_data FROM public.rdb_log_info WHERE ${where} ORDER BY dt_time_stamp, n0_sequence_no`),
    // Loyalty / customer counter changes (visits, points balance, discount) recorded for the identified
    // customer, with their name carried in the j_delivery_info JSON blob.
    remoteQuery(`SELECT n0_sequence_no, sz_customer_no, sz_action, sz_entity, sz_entity_descr, n0_entity_value, j_delivery_info, n0_campaign_id, n0_initiative_id FROM public.rdb_log_cust_account WHERE ${where} ORDER BY n0_sequence_no`),
    // POS alerts emitted during the transaction (VOID, PAUSE, LOGIN/LOGOFF, PRICEOVERRIDE, PLD, ...),
    // each with a numeric severity and a human-readable message in sz_alert_log.
    remoteQuery(`SELECT dt_time_stamp, n0_alert_severity, sz_alert_code, sz_alert_log, sz_source FROM public.rdb_log_alert WHERE ${where} ORDER BY dt_time_stamp`),
    // Original POS-printed receipt: one row per transaction whose j_receipt_line JSON holds the
    // pre-formatted text lines ({ id, val, type }) exactly as printed.
    remoteQuery(`SELECT j_receipt_line FROM public.rdb_log_receipt WHERE ${where} ORDER BY dt_time_stamp`),
  ]);
  // Flatten the printed lines from any matching receipt row(s) into a single ordered list.
  const receipt = receiptRows.flatMap((r) => (Array.isArray(r.j_receipt_line) ? (r.j_receipt_line as unknown[]) : []));
  return response({ items, tenders, discounts, vat, info, loyalty, alerts, receipt });
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const filters = Object.fromEntries(url.searchParams) as Filters;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    if (url.pathname === "/api/health") return response({ ok: true });
    try {
      if (url.pathname === "/api/server") {
        if (request.method === "POST") {
          const body = (await request.json().catch(() => ({}))) as { address?: string };
          const address = String(body.address ?? "").trim();
          if (!SERVER_PATTERN.test(address)) return response({ error: "Invalid server address" }, 400);
          remoteServer = address;
          return response({ server: remoteServer });
        }
        return response({ server: remoteServer });
      }
      if (url.pathname === "/api/facets") {
        const [stores, terminals, operators] = await Promise.all([
          remoteQuery("SELECT DISTINCT n0_unique_str_no AS value FROM public.rdb_log WHERE n0_trans_type = 0 ORDER BY 1"),
          remoteQuery("SELECT DISTINCT n0_terminal_no AS value FROM public.rdb_log WHERE n0_trans_type = 0 ORDER BY 1"),
          remoteQuery("SELECT DISTINCT n0_operator_no AS value FROM public.rdb_log WHERE n0_trans_type = 0 ORDER BY 1"),
        ]);
        const values = (rows: Row[]) => rows.map((row) => String(row.value));
        return response({ stores: values(stores), terminals: values(terminals), operators: values(operators) });
      }
      if (url.pathname === "/api/transactions") return await transactionsList(filters);
      if (url.pathname === "/api/transactions.csv") return await transactionsCsv(filters);
      if (url.pathname === "/api/exceptions") return await exceptions(filters);
      const match = url.pathname.match(/^\/api\/transactions\/(.+)$/);
      if (match) return await transactionDetail(match[1]);
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "Query failed" }, 502);
    }
    return new Response("Not found", { status: 404, headers: { ...CORS } });
  },
});

console.log(`Sales Explorer API listening on http://localhost:${PORT}`);
