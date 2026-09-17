import "./style.css";

type Transaction = {
  dt_time_stamp_st: string;
  n0_unique_str_no: number;
  n0_terminal_no: string;
  n0_xact_no: number;
  sz_employee_no: string;
  n2_amount_price: number;
  n0_tot_sold_item?: number;
  discount_total?: number | string;
  bl_refund?: string;
  bl_loyalty?: boolean;
  bl_voided?: string | number;
};

type Detail = Record<string, unknown>;
type Details = { items: Detail[]; tenders: Detail[]; discounts: Detail[]; vat: Detail[]; info: Detail[]; loyalty: Detail[]; alerts: Detail[]; receipt: Detail[] };
type Facets = { stores: string[]; terminals: string[]; operators: string[]; paymentTypes: string[] };
type Summary = { total: number; salesTotal: number; refundCount: number; voidCount: number; discountTotal: number };
type Flagged = Transaction & { reasons: string[]; score: number };
type Operator = { operator: string; txns: number; voids: number; refunds: number; voidRate: number; risk: number };
type Exceptions = { flagged: Flagged[]; operators: Operator[] };
type View = "transactions" | "exceptions";

const app = document.querySelector<HTMLDivElement>("#app")!;
const state = {
  view: "transactions" as View,
  rows: [] as Transaction[],
  summary: { total: 0, salesTotal: 0, refundCount: 0, voidCount: 0, discountTotal: 0 } as Summary,
  page: 1, sort: "date", direction: "desc", hasMore: false,
  loading: false, error: "",
  range: null as number | null,
  facets: null as Facets | null,
  filters: {} as Record<string, string>,
  exceptions: null as Exceptions | null,
  selected: null as Transaction | null,
  details: null as Details | null,
  detailError: false,
  drawerTab: "detail" as "detail" | "receipt",
  pendingSel: null as string | null,
};

const remoteServer = import.meta.env.VITE_REMOTE_LOOKUP_SERVER ?? window.location.hostname != "localhost" ? window.location.hostname : "142.132.232.189";
const remoteLookupUrl = `http://${remoteServer.includes(":") ? remoteServer : `${remoteServer}:7392`}/api/db-operations/remote-lookup`;
type Filters = Record<string, string | undefined>;
type Row = Record<string, string | number | boolean | null | unknown[]>;

const escapeLiteral = (value: string) => value.replaceAll("'", "''");
const isInteger = (value: string | undefined) => Boolean(value && /^\d+$/.test(value));
const isNumber = (value: string | undefined) => Boolean(value && /^-?\d+(\.\d+)?$/.test(value));
const num = (value: unknown) => Number(value ?? 0);

async function remoteQuery(query: string): Promise<Row[]> {
  let response: Response;
  try {
    response = await fetch(remoteLookupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { command: 1003, query } }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`Could not reach ${remoteServer}`);
  }
  if (!response.ok) throw new Error(`Remote database returned ${response.status}`);
  const result = (await response.text()).trim();
  if (!result || result.startsWith("NO DATA") || result.startsWith("NO RECORD FOUND")) return [];
  if (result.startsWith("SQL ERROR")) throw new Error("Query rejected by remote database");
  return JSON.parse(result) as Row[];
}

const DISCOUNT_TOTAL = "COALESCE((SELECT SUM(COALESCE(d.n2_allowance, 0) + COALESCE(d.n2_perc_off_amount, 0)) FROM public.rdb_log_discount d WHERE d.dt_time_stamp = h.dt_time_stamp_st AND d.n0_unique_str_no = h.n0_unique_str_no AND d.n0_terminal_no = h.n0_terminal_no AND d.n0_xact_no = h.n0_xact_no AND COALESCE(d.bl_voided, 0) <> 1), 0)";
const SORT_COLUMNS: Record<string, string> = { date: "h.dt_time_stamp_st", amount: "h.n2_amount_price", store: "h.n0_unique_str_no", terminal: "h.n0_terminal_no", operator: "h.sz_employee_no", discount: "discount_total" };

function transactionWhere(filters: Filters) {
  const clauses = ["h.n0_trans_type = 0", "h.bl_suspended = 0", "h.bl_training = 0"];
  if (isInteger(filters.store)) clauses.push(`h.n0_unique_str_no = ${filters.store}`);
  if (isInteger(filters.terminal)) clauses.push(`h.n0_terminal_no = ${filters.terminal}`);
  if (filters.operator?.trim()) clauses.push(`TRIM(COALESCE(h.sz_employee_no, '')) = '${escapeLiteral(filters.operator.trim())}'`);
  if (filters.type === "voided") clauses.push("COALESCE(h.bl_voided, 0) = 1");
  else if (filters.type === "refund") clauses.push("COALESCE(h.bl_refund, 0) = 1");
  else if (filters.type === "sale") clauses.push("COALESCE(h.bl_refund, 0) <> 1 AND COALESCE(h.bl_voided, 0) <> 1");
  if (filters.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) clauses.push(`h.dt_time_stamp_st >= '${filters.dateFrom}'::date`);
  if (filters.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) clauses.push(`h.dt_time_stamp_st < ('${filters.dateTo}'::date + interval '1 day')`);
  if (isNumber(filters.minAmount)) clauses.push(`h.n2_amount_price >= ${Math.round(Number(filters.minAmount) * 100)}`);
  if (isNumber(filters.maxAmount)) clauses.push(`h.n2_amount_price <= ${Math.round(Number(filters.maxAmount) * 100)}`);
  const transactionMatch = (table: string) => `${table}.dt_time_stamp = h.dt_time_stamp_st AND ${table}.n0_unique_str_no = h.n0_unique_str_no AND ${table}.n0_terminal_no = h.n0_terminal_no AND ${table}.n0_xact_no = h.n0_xact_no`;
  const paymentTypes = [...new Set((filters.paymentTypes ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
  if (paymentTypes.length) clauses.push(`EXISTS (SELECT 1 FROM public.rdb_log_tender t WHERE ${transactionMatch("t")} AND TRIM(COALESCE(t.sz_description, t.sz_tender_type, '')) IN (${paymentTypes.map((value) => `'${escapeLiteral(value)}'`).join(", ")}))`);
  if (filters.loyaltyCard?.trim()) clauses.push(`EXISTS (SELECT 1 FROM public.rdb_log_cust_account c WHERE ${transactionMatch("c")} AND TRIM(COALESCE(c.sz_customer_no, '')) ILIKE '%${escapeLiteral(filters.loyaltyCard.trim())}%')`);
  if (filters.search?.trim()) {
    const term = escapeLiteral(filters.search.trim());
    clauses.push(`(CAST(h.n0_xact_no AS text) ILIKE '%${term}%' OR CAST(h.n0_unique_str_no AS text) ILIKE '%${term}%' OR EXISTS (SELECT 1 FROM public.rdb_log_item i WHERE i.dt_time_stamp = h.dt_time_stamp_st AND i.n0_unique_str_no = h.n0_unique_str_no AND i.n0_terminal_no = h.n0_terminal_no AND i.n0_xact_no = h.n0_xact_no AND (i.sz_description ILIKE '%${term}%' OR TRIM(i.sz_item_ref_no) ILIKE '%${term}%')))`);
  }
  return clauses.join(" AND ");
}

const listSelect = (where: string, sort: string, direction: string, limit: number, offset = 0) => `SELECT h.dt_time_stamp_st, h.n0_unique_str_no, h.n0_terminal_no, h.n0_xact_no, h.sz_employee_no, h.n2_amount_price, h.n0_tot_sold_item, h.bl_refund, h.bl_loyalty, h.bl_voided, ${DISCOUNT_TOTAL} AS discount_total FROM public.rdb_log h WHERE ${where} ORDER BY ${sort} ${direction}, h.dt_time_stamp_st DESC LIMIT ${limit} OFFSET ${offset}`;

async function transactionsList(filters: Filters) {
  const where = transactionWhere(filters);
  const sort = SORT_COLUMNS[filters.sort ?? "date"] ?? SORT_COLUMNS.date;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const [rows, summary, discount] = await Promise.all([
    remoteQuery(listSelect(where, sort, direction, 26, (page - 1) * 25)),
    remoteQuery(`SELECT count(*) total, COALESCE(SUM(h.n2_amount_price) FILTER (WHERE h.bl_refund <> '1' AND COALESCE(h.bl_voided, 0) <> 1), 0) sales, count(*) FILTER (WHERE h.bl_refund = '1' AND COALESCE(h.bl_voided, 0) <> 1) refunds, count(*) FILTER (WHERE COALESCE(h.bl_voided, 0) = 1) voids FROM public.rdb_log h WHERE ${where}`),
    remoteQuery(`SELECT COALESCE(SUM(COALESCE(d.n2_allowance, 0) + COALESCE(d.n2_perc_off_amount, 0)), 0) disc FROM public.rdb_log_discount d JOIN public.rdb_log h ON h.dt_time_stamp_st = d.dt_time_stamp AND h.n0_unique_str_no = d.n0_unique_str_no AND h.n0_terminal_no = d.n0_terminal_no AND h.n0_xact_no = d.n0_xact_no WHERE ${where} AND COALESCE(d.bl_voided, 0) <> 1 AND COALESCE(h.bl_voided, 0) <> 1`),
  ]);
  return { rows: rows.slice(0, 25), hasMore: rows.length > 25, page, total: num(summary[0]?.total), salesTotal: num(summary[0]?.sales), refundCount: num(summary[0]?.refunds), voidCount: num(summary[0]?.voids), discountTotal: num(discount[0]?.disc) };
}

async function transactionsCsv(filters: Filters) {
  const where = transactionWhere(filters);
  const sort = SORT_COLUMNS[filters.sort ?? "date"] ?? SORT_COLUMNS.date;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const rows = await remoteQuery(listSelect(where, sort, direction, 5000));
  const header = ["Date/time", "Transaction", "Store", "Terminal", "Operator", "Amount", "Discount", "Items", "Refund", "Loyalty", "Voided"];
  const cell = (value: unknown) => { const text = String(value ?? ""); return /[\",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  const body = rows.map((row) => [String(row.dt_time_stamp_st ?? "").slice(0, 19).replace("T", " "), row.n0_xact_no, row.n0_unique_str_no, row.n0_terminal_no, row.sz_employee_no, (num(row.n2_amount_price) / 100).toFixed(2), (num(row.discount_total) / 100).toFixed(2), row.n0_tot_sold_item, row.bl_refund === "1" ? "yes" : "no", row.bl_loyalty ? "yes" : "no", num(row.bl_voided) === 1 ? "yes" : "no"].map(cell).join(","));
  return new Response([header.join(","), ...body].join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}

async function exceptions(filters: Filters) {
  const where = transactionWhere(filters);
  const transactionMatch = (table: string) => `${table}.dt_time_stamp = h.dt_time_stamp_st AND ${table}.n0_unique_str_no = h.n0_unique_str_no AND ${table}.n0_terminal_no = h.n0_terminal_no AND ${table}.n0_xact_no = h.n0_xact_no`;
  const flagInner = `SELECT h.dt_time_stamp_st, h.n0_unique_str_no store, h.n0_terminal_no term, h.n0_xact_no xact, h.sz_employee_no oper, h.n2_amount_price amount, h.bl_refund, h.bl_voided, h.bl_void_prev, COALESCE(h.n0_tot_itm_voided, 0) item_voids, ${DISCOUNT_TOTAL} AS disc, COALESCE((SELECT COUNT(*) FROM public.rdb_log_item i WHERE ${transactionMatch("i")} AND (COALESCE(i.bl_price_req, 0) = 1 OR COALESCE(i.bl_quant_req, 0) = 1)), 0) manual_entries, COALESCE((SELECT COUNT(*) FROM public.rdb_log_item i WHERE ${transactionMatch("i")} AND COALESCE(i.bl_return, 0) = 1), 0) item_returns, COALESCE((SELECT COUNT(*) FROM public.rdb_log_item i WHERE ${transactionMatch("i")} AND COALESCE(i.bl_mgr_voided, 0) = 1), 0) manager_voids, COALESCE((SELECT COUNT(*) FROM public.rdb_log_tender t WHERE ${transactionMatch("t")} AND (COALESCE(t.bl_offline, 0) = 1 OR COALESCE(t.bl_denied, 0) = 1 OR COALESCE(t.bl_host_denied, 0) = 1)), 0) tender_issues, COALESCE((SELECT MAX(a.n0_alert_severity) FROM public.rdb_log_alert a WHERE ${transactionMatch("a")}), 0) alert_severity, COALESCE((SELECT COUNT(*) FROM public.rdb_log_cust_account c WHERE ${transactionMatch("c")}), 0) loyalty_changes, COALESCE(EXTRACT(EPOCH FROM (h.dt_time_stamp_end - h.dt_time_stamp_st)), 0) duration_seconds FROM public.rdb_log h WHERE ${where}`;
  const [candidates, operatorsRaw] = await Promise.all([remoteQuery(`SELECT * FROM (${flagInner}) t WHERE t.bl_refund = '1' OR t.bl_voided = '1' OR t.bl_void_prev = '1' OR t.item_voids > 0 OR t.amount <= 0 OR (t.amount > 0 AND t.disc > t.amount / 2) OR t.manual_entries > 0 OR t.item_returns > 0 OR t.manager_voids > 0 OR t.tender_issues > 0 OR t.alert_severity >= 3 OR t.loyalty_changes > 0 OR t.duration_seconds > 1200 ORDER BY t.dt_time_stamp_st DESC LIMIT 200`), remoteQuery(`SELECT TRIM(COALESCE(h.sz_employee_no, '')) oper, count(*) txns, count(*) FILTER (WHERE h.bl_refund = '1') refunds, count(*) FILTER (WHERE h.bl_voided = '1') voids FROM public.rdb_log h WHERE ${where} GROUP BY 1`)]);
  const flagged = candidates.map((row) => {
    const amount = num(row.amount), discount = num(row.disc), itemVoids = num(row.item_voids), manualEntries = num(row.manual_entries), itemReturns = num(row.item_returns), managerVoids = num(row.manager_voids), tenderIssues = num(row.tender_issues), alertSeverity = num(row.alert_severity), loyaltyChanges = num(row.loyalty_changes), durationSeconds = num(row.duration_seconds);
    const reasons: { label: string; weight: number }[] = [];
    if (num(row.bl_voided) === 1) reasons.push({ label: "Voided transaction", weight: 40 }); if (num(row.bl_void_prev) === 1) reasons.push({ label: "Voided a previous sale", weight: 35 }); if (num(row.bl_refund) === 1) reasons.push({ label: "Refund", weight: 30 }); if (itemVoids > 0) reasons.push({ label: `${itemVoids} item void${itemVoids > 1 ? "s" : ""}`, weight: 10 + itemVoids * 5 }); if (amount <= 0) reasons.push({ label: "Non-positive amount", weight: 20 }); if (amount > 0 && discount > amount / 2) reasons.push({ label: `Heavy discount (${Math.round((discount / amount) * 100)}%)`, weight: 30 }); if (manualEntries > 0) reasons.push({ label: `${manualEntries} manual item entr${manualEntries > 1 ? "ies" : "y"}`, weight: 10 + manualEntries * 5 }); if (itemReturns > 0) reasons.push({ label: `${itemReturns} returned item${itemReturns > 1 ? "s" : ""}`, weight: 15 + itemReturns * 5 }); if (managerVoids > 0) reasons.push({ label: `${managerVoids} manager item void${managerVoids > 1 ? "s" : ""}`, weight: 25 + managerVoids * 5 }); if (tenderIssues > 0) reasons.push({ label: `${tenderIssues} tender issue${tenderIssues > 1 ? "s" : ""}`, weight: 25 + tenderIssues * 5 }); if (alertSeverity >= 3) reasons.push({ label: `High-severity POS alert (${alertSeverity})`, weight: 15 + alertSeverity * 5 }); if (loyaltyChanges > 0) reasons.push({ label: `${loyaltyChanges} loyalty account change${loyaltyChanges > 1 ? "s" : ""}`, weight: 8 + loyaltyChanges * 2 }); if (durationSeconds > 1200) reasons.push({ label: `Long transaction (${Math.round(durationSeconds / 60)} min)`, weight: 15 });
    return { dt_time_stamp_st: String(row.dt_time_stamp_st ?? ""), n0_unique_str_no: num(row.store), n0_terminal_no: String(row.term ?? ""), n0_xact_no: num(row.xact), sz_employee_no: String(row.oper ?? ""), n2_amount_price: amount, discount_total: discount, reasons: reasons.map((reason) => reason.label), score: reasons.reduce((sum, reason) => sum + reason.weight, 0) };
  }).sort((left, right) => right.score - left.score);
  const operators = operatorsRaw.map((row) => { const txns = num(row.txns), voids = num(row.voids), refunds = num(row.refunds); return { operator: String(row.oper), txns, voids, refunds, voidRate: txns ? voids / txns : 0, risk: txns ? Math.round((voids * 40 + refunds * 30) / txns) : 0 }; }).filter((operator) => operator.txns >= 5).sort((left, right) => right.risk - left.risk).slice(0, 10);
  return { flagged, operators };
}

async function transactionDetail(rawKey: string) {
  const key = JSON.parse(decodeURIComponent(rawKey)) as Record<string, string | number>;
  const date = String(key.timestamp ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isInteger(String(key.store)) || !isInteger(String(key.terminal)) || !isInteger(String(key.transaction))) throw new Error("Invalid transaction key");
  const dayRange = (column: string) => `${column} >= '${date}'::date AND ${column} < '${date}'::date + interval '1 day'`;
  const keyMatch = `n0_unique_str_no = ${key.store} AND n0_terminal_no = ${key.terminal} AND n0_xact_no = ${key.transaction}`;
  const notSuspended = `dt_time_stamp NOT IN (SELECT dt_time_stamp_st FROM public.rdb_log WHERE n0_trans_type = 0 AND bl_suspended <> 0 AND ${keyMatch} AND ${dayRange("dt_time_stamp_st")})`;
  const where = `${dayRange("dt_time_stamp")} AND ${keyMatch} AND ${notSuspended}`;
  const [items, tenders, discounts, vat, info, loyalty, alerts, receiptRows] = await Promise.all([
    remoteQuery(`SELECT n0_sequence_no, sz_description, sz_item_ref_no, n0_quantity, n2_amount_price, n2_ext_price, bl_return FROM public.rdb_log_item WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, sz_description, sz_tender_type, n2_amount, sz_auth_number FROM public.rdb_log_tender WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, sz_description, n0_perc_off, (COALESCE(n2_allowance, 0) + COALESCE(n2_perc_off_amount, 0)) AS n2_disc_amount FROM public.rdb_log_discount WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_tax_code, n2_sold_amount, n2_vat_amount, n3_vat_percentage FROM public.rdb_log_vat WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, dt_time_stamp, sz_info_data FROM public.rdb_log_info WHERE ${where} ORDER BY dt_time_stamp, n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, sz_customer_no, sz_action, sz_entity, sz_entity_descr, n0_entity_value, j_delivery_info, n0_campaign_id, n0_initiative_id FROM public.rdb_log_cust_account WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT dt_time_stamp, n0_alert_severity, sz_alert_code, sz_alert_log, sz_source FROM public.rdb_log_alert WHERE ${where} ORDER BY dt_time_stamp`), remoteQuery(`SELECT j_receipt_line FROM public.rdb_log_receipt WHERE ${where} ORDER BY dt_time_stamp`),
  ]);
  return { items, tenders, discounts, vat, info, loyalty, alerts, receipt: receiptRows.flatMap((row) => Array.isArray(row.j_receipt_line) ? row.j_receipt_line : []) };
}

async function apiFetch(path: string, _init?: RequestInit) {
  try {
    const url = new URL(path, window.location.origin);
    const filters = Object.fromEntries(url.searchParams) as Filters;
    if (url.pathname === "/api/facets") {
      const [stores, terminals, operators, paymentTypes] = await Promise.all([remoteQuery("SELECT DISTINCT n0_unique_str_no AS value FROM public.rdb_log WHERE n0_trans_type = 0 ORDER BY 1"), remoteQuery("SELECT DISTINCT n0_terminal_no AS value FROM public.rdb_log WHERE n0_trans_type = 0 ORDER BY 1"), remoteQuery("SELECT DISTINCT TRIM(COALESCE(sz_employee_no, '')) AS value FROM public.rdb_log WHERE n0_trans_type = 0 AND TRIM(COALESCE(sz_employee_no, '')) <> '' ORDER BY 1"), remoteQuery("SELECT DISTINCT TRIM(COALESCE(sz_description, sz_tender_type, '')) AS value FROM public.rdb_log_tender WHERE TRIM(COALESCE(sz_description, sz_tender_type, '')) <> '' ORDER BY 1")]);
      const values = (rows: Row[]) => rows.map((row) => String(row.value));
      return Response.json({ stores: values(stores), terminals: values(terminals), operators: values(operators), paymentTypes: values(paymentTypes) });
    }
    if (url.pathname === "/api/transactions") return Response.json(await transactionsList(filters));
    if (url.pathname === "/api/transactions.csv") return await transactionsCsv(filters);
    if (url.pathname === "/api/exceptions") return Response.json(await exceptions(filters));
    const match = url.pathname.match(/^\/api\/transactions\/(.+)$/);
    if (match) return Response.json(await transactionDetail(match[1]));
    return new Response("Not found", { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Query failed" }, { status: 502 });
  }
}

const formatMoney = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
const formatPercentage = (value: unknown) => `${(Number(value ?? 0) / 100).toFixed(2)}%`;
// The API labels naive POS wall-clock timestamps as UTC (trailing "Z"), so render them in UTC to
// show the stored time verbatim rather than re-projecting into the viewer's local zone.
const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
const formatTime = (value: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value));
const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};
const clean = (value: unknown) => String(value ?? "-").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
const icon = (name: string) => `<svg class="icon" aria-hidden="true"><use href="#${name}" /></svg>`;
const keyOf = (row: Transaction) => JSON.stringify({ timestamp: row.dt_time_stamp_st, store: row.n0_unique_str_no, terminal: row.n0_terminal_no, transaction: row.n0_xact_no });
const BADGE_TONES: Record<"amber" | "sky" | "red", string> = { amber: "bg-amber-100 text-amber-700", sky: "bg-sky-100 text-sky-700", red: "bg-red-100 text-red-700" };
const badge = (label: string, tone: "amber" | "sky" | "red") => `<span class="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_TONES[tone]}">${label}</span>`;
const isVoided = (row: Transaction) => row.bl_voided === "1" || row.bl_voided === 1;
const logo = () => `<svg class="brand-mark h-6 w-6 shrink-0" viewBox="0 0 40 40" aria-label="Sales Explorer logo" role="img"><rect width="40" height="40" rx="9" fill="#3b82f6"/><path d="M11 13.5h18M11 20h18M11 26.5h11" stroke="#eff6ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="27" cy="26.5" r="4" fill="#bfdbfe"/><path d="m25.3 26.5 1.15 1.15 2.25-2.35" stroke="#1e3a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function toolbarMarkup() {
  const tab = (view: View, label: string, ic: string) => `<button class="nav-tab flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition ${state.view === view ? "bg-slate-800 text-white shadow-sm border-b-2 border-blue-500" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"}" data-view="${view}">${icon(ic)}<span>${label}</span></button>`;
  const nav = `<nav class="titlebar-nav ml-auto flex shrink-0 gap-1 rounded-md border border-slate-800/80 bg-slate-900/60 p-0.5">${tab("transactions", "Transactions", "list")}${tab("exceptions", "Exceptions", "alert")}</nav>`;
  return `<header class="app-titlebar sticky top-0 z-30 flex min-h-10 w-full select-none items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 text-slate-200 shadow-md"><div class="titlebar-primary flex min-w-0 items-center gap-3"><div class="flex shrink-0 items-center gap-2">${logo()}<span class="font-display text-sm font-semibold tracking-tight text-white">Sales Explorer</span></div></div>${nav}</header>`;
}

function pageHeaderMarkup() {
  const meta = {
    transactions: { k: "RDB log", t: "Sales transactions", d: "Inspect sales headers, line items, payments, discounts, and tax detail." },
    exceptions: { k: "Loss prevention", t: "Exceptions", d: "Voids, refunds and heavy discounts — ranked by risk." },
  }[state.view];
  return `<section class="mb-6"><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">${meta.k}</p><h1 class="mt-1 font-display text-3xl font-semibold">${meta.t}</h1><p class="mt-1 text-sm text-slate-500">${meta.d}</p></section>`;
}

// Compact dark select for the filter sub-toolbar (placeholder-labelled, own chevron).
function tbSelect(name: string, placeholder: string, options: (string | [string, string])[] = []) {
  const current = state.filters[name] ?? "";
  const option = (opt: string | [string, string]) => { const [value, text] = Array.isArray(opt) ? opt : [opt, opt]; return `<option value="${clean(value)}" ${current === value ? "selected" : ""}>${clean(text)}</option>`; };
  return `<select class="toolbar-field toolbar-select appearance-none bg-[right_0.5rem_center] bg-no-repeat pr-7 [&>option]:bg-slate-900 [&>option]:text-slate-100 ${current ? "font-medium text-slate-100" : "text-slate-400"}" name="${name}" aria-label="${clean(placeholder)}" style="background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m3 4.5 3 3 3-3%22/></svg>')"><option value="">${clean(placeholder)}</option>${options.map(option).join("")}</select>`;
}

function paymentTypeSelect() {
  const selected = (state.filters.paymentTypes ?? "").split(",").filter(Boolean);
  const label = selected.length ? `${selected.length} payment type${selected.length === 1 ? "" : "s"}` : "All payment types";
  const options = (state.facets?.paymentTypes ?? []).map((paymentType) => `<label class="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm text-slate-100 hover:bg-slate-700"><input class="h-5 w-5 rounded border-slate-500 bg-slate-800 text-pine focus:ring-blue-500" type="checkbox" name="paymentType" value="${clean(paymentType)}" ${selected.includes(paymentType) ? "checked" : ""} /><span class="truncate">${clean(paymentType)}</span></label>`).join("") || `<p class="px-3 py-3 text-sm text-slate-400">No payment types found.</p>`;
  return `<details class="payment-types relative shrink-0"><summary class="toolbar-field flex h-11 min-w-40 cursor-pointer list-none items-center justify-between gap-2 px-3"><span class="truncate">${clean(label)}</span><span class="text-slate-400">${icon("chevron")}</span></summary><div class="absolute left-0 z-40 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-slate-700 bg-slate-800 py-1 shadow-xl">${options}</div></details>`;
}

// The filter sub-toolbar: same fields/logic as before (form#filters), reorganised into a compact,
// sticky dark secondary bar under the app title bar. All controls sit on a single non-wrapping row —
// search flexes/shrinks; store/terminal/operator/type are compact selects; period and amount are
// grouped range controls; Clear (icon-only) and Apply sit on the right.
function subToolbarMarkup() {
  const val = (name: string) => clean(state.filters[name] ?? "");
  const date = (name: string) => clean(formatFilterDate(state.filters[name] ?? ""));
  const datePicker = (name: "dateFrom" | "dateTo", label: string) => `<div class="relative flex min-w-0 items-center"><input type="text" data-date-display="${name}" value="${date(name)}" class="toolbar-bare w-[5.5rem] sm:w-[6.25rem]" inputmode="numeric" pattern="\\d{2}/\\d{2}/\\d{4}" placeholder="DD/MM/YYYY" aria-label="${label}" /><input type="date" data-date-picker="${name}" value="${val(name)}" class="toolbar-native-date" tabindex="-1" aria-hidden="true" /><button type="button" class="date-picker flex h-6 w-5 shrink-0 items-center justify-center text-slate-400 transition hover:text-slate-100" data-date-picker-button="${name}" title="Choose ${label.toLowerCase()}" aria-label="Choose ${label.toLowerCase()}">${icon("calendar")}</button></div>`;
  const search = `<div class="toolbar-search relative min-w-0"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon("search")}</span><input class="toolbar-field w-full pl-9" name="search" value="${val("search")}" placeholder="Search article, transaction…" aria-label="Search" /></div>`;
  const loyalty = `<input class="toolbar-field w-44" name="loyaltyCard" value="${val("loyaltyCard")}" placeholder="Loyalty card number" aria-label="Loyalty card number" />`;
  const period = `<div class="toolbar-group">${datePicker("dateFrom", "From date")}<span class="text-slate-500">–</span>${datePicker("dateTo", "To date")}</div>`;
  const amount = `<div class="toolbar-group"><span class="shrink-0 text-slate-400">€</span><input name="minAmount" inputmode="decimal" placeholder="Min" value="${val("minAmount")}" class="toolbar-bare w-12 tabular-nums" aria-label="Min amount" /><span class="text-slate-500">–</span><input name="maxAmount" inputmode="decimal" placeholder="Max" value="${val("maxAmount")}" class="toolbar-bare w-12 tabular-nums" aria-label="Max amount" /></div>`;
  const actions = `<div class="flex shrink-0 items-center gap-2"><button type="reset" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-700 hover:text-slate-100" title="Clear filters" aria-label="Clear filters">${icon("close")}</button><button class="flex h-11 shrink-0 items-center gap-2 rounded-md bg-pine px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">${icon("sliders")}Apply</button></div>`;
  return `<div class="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 shadow-sm backdrop-blur" style="color-scheme:dark"><form id="filters" class="flex w-full flex-wrap items-center gap-2 px-4 py-3">${search}<div class="hidden">${tbSelect("store", "All stores", state.facets?.stores)}</div><div class="hidden">${tbSelect("terminal", "All terminals", state.facets?.terminals)}</div><div class="hidden">${tbSelect("operator", "All operators", state.facets?.operators)}</div>${tbSelect("type", "All types", [["sale", "Sale"], ["refund", "Refund"], ["voided", "Voided"]])}${paymentTypeSelect()}${loyalty}${period}${amount}${actions}</form></div>`;
}

// --- transactions view ------------------------------------------------------

function summaryMarkup() {
  const s = state.summary;
  // Average is over genuine sales only: exclude both refunds and voided transactions.
  const sales = Math.max(0, s.total - s.refundCount - s.voidCount);
  const cell = (label: string, value: string, last = false) => `<div class="${last ? "px-5" : "border-r border-[#c7d7ff] px-5 first:pl-0"}"><p class="text-xs font-medium text-slate-600">${label}</p><p class="mt-0.5 text-lg font-semibold tabular-nums">${state.loading ? "…" : value}</p></div>`;
  return `<section class="mb-5 flex flex-wrap gap-y-3 rounded-lg border border-[#cddcff] bg-mist px-5 py-4 shadow-sm">${cell("Transactions", String(s.total))}${cell("Sales total", formatMoney(s.salesTotal))}${cell("Average sale", formatMoney(sales ? s.salesTotal / sales : 0))}${cell("Discounts", s.discountTotal > 0 ? `-${formatMoney(s.discountTotal)}` : formatMoney(0))}${cell("Refunds", String(s.refundCount))}${cell("Voided", String(s.voidCount), true)}</section>`;
}

function tableMarkup() {
  const sortable = [["date", "Date & time"], ["store", "Store"], ["terminal", "Terminal"], ["operator", "Operator"], ["amount", "Amount"], ["discount", "Discount"]];
  const emptyState = state.error
    ? `<tr><td colspan="9" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-clay"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#alert" /></svg><p class="text-sm font-semibold">${clean(state.error)}</p><p class="text-xs text-slate-500">Check the remote lookup service and try again.</p></div></td></tr>`
    : `<tr><td colspan="9" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-slate-400"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#inbox" /></svg><p class="text-sm font-medium text-slate-500">No transactions match these filters.</p></div></td></tr>`;
  const discountCell = (row: Transaction) => Number(row.discount_total) > 0 ? `<span class="font-medium text-emerald-600">-${formatMoney(row.discount_total)}</span>` : `<span class="text-slate-300">—</span>`;
  const body = state.loading
    ? Array.from({ length: 8 }, () => `<tr class="border-b border-slate-100 last:border-0">${Array.from({ length: 9 }, () => `<td class="px-5 py-4"><div class="h-3.5 rounded bg-slate-100"></div></td>`).join("")}</tr>`).join("")
    : state.rows.length
    ? state.rows.map((row) => { const voided = isVoided(row); const cell = (classes: string, content: string, strike = true) => `<td class="${classes} ${voided && strike ? "line-through decoration-red-400" : ""}">${content}</td>`; return `<tr class="border-b border-slate-100 last:border-0 hover:bg-mist/40 ${voided ? "bg-red-50/40 text-slate-400" : ""}">${cell("whitespace-nowrap px-5 py-4 font-medium", formatDate(row.dt_time_stamp_st))}${cell(`px-5 py-4 font-semibold tabular-nums ${voided ? "text-slate-400" : "text-ink"}`, `#${clean(row.n0_xact_no)}`)}${cell("hidden px-5 py-4 tabular-nums", clean(row.n0_unique_str_no))}${cell("hidden px-5 py-4 tabular-nums", clean(row.n0_terminal_no))}${cell("px-5 py-4 tabular-nums", clean(row.sz_employee_no))}${cell(`whitespace-nowrap px-5 py-4 font-semibold tabular-nums ${voided ? "text-slate-400" : Number(row.n2_amount_price) < 0 ? "text-clay" : ""}`, `${formatMoney(row.n2_amount_price)}${voided ? badge("Voided", "red") : ""}${row.bl_refund === "1" ? badge("Refund", "amber") : ""}${row.bl_loyalty ? badge("Loyalty", "sky") : ""}`)}${cell("whitespace-nowrap px-5 py-4 tabular-nums", discountCell(row))}${cell("px-5 py-4 tabular-nums", clean(row.n0_tot_sold_item))}${cell("px-5 py-4 text-right", `<button class="inspect ml-auto flex items-center gap-1 font-bold text-pine hover:text-ink" data-key="${encodeURIComponent(keyOf(row))}">View ${icon("chevron")}</button>`, false)}</tr>`; }).join("")
    : emptyState;
  const from = state.rows.length ? (state.page - 1) * 25 + 1 : 0;
  const to = (state.page - 1) * 25 + state.rows.length;
  const count = state.loading ? "…" : `${from.toLocaleString()}–${to.toLocaleString()} of ${state.summary.total.toLocaleString()}`;
  return `${summaryMarkup()}<section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="border-b border-blue-100 bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr>${sortable.map(([key, title]) => `<th class="${key === "store" || key === "terminal" ? "hidden " : ""}whitespace-nowrap px-5 py-3.5"><button class="sort inline-flex items-center gap-1 transition hover:text-pine ${state.sort === key ? "text-pine" : ""}" data-sort="${key}">${title}<span class="text-[0.7rem]">${state.sort === key ? (state.direction === "asc" ? "↑" : "↓") : ""}</span></button></th>${key === "date" ? `<th class="px-5 py-3.5">Txn #</th>` : ""}`).join("")}<th class="px-5 py-3.5">Items</th><th class="px-5 py-3.5"></th></tr></thead><tbody>${body}</tbody></table></div><footer class="flex items-center justify-between border-t border-blue-100 bg-[#fbfcff] px-5 py-3"><p class="text-sm text-slate-500">Showing ${count}</p><div class="flex gap-2"><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="prev" ${state.page === 1 ? "disabled" : ""}>Previous</button><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="next" ${!state.hasMore ? "disabled" : ""}>Next</button></div></footer></section>`;
}

// --- exceptions view --------------------------------------------------------

const statusCard = (body: string) => `<section class="rounded-lg border border-blue-100 bg-white p-12 text-center text-sm shadow-panel">${body}</section>`;
const tile = (label: string, value: string, sub = "") => `<div class="rounded-lg border border-[#cddcff] bg-mist px-5 py-4 shadow-sm"><p class="text-xs font-medium text-slate-600">${label}</p><p class="mt-1 text-2xl font-semibold tabular-nums text-ink">${value}</p>${sub ? `<p class="mt-0.5 truncate text-xs text-slate-500">${sub}</p>` : ""}</div>`;

const reasonChip = (reason: string) => {
  const tone = /void/i.test(reason) ? "bg-red-100 text-red-700" : /refund/i.test(reason) ? "bg-amber-100 text-amber-700" : /training/i.test(reason) ? "bg-slate-200 text-slate-600" : /discount/i.test(reason) ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700";
  return `<span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}">${clean(reason)}</span>`;
};

function exceptionsMarkup() {
  if (state.loading) return statusCard(`<p class="text-slate-500">Scanning for exceptions…</p>`);
  if (state.error || !state.exceptions) return statusCard(`<div class="flex flex-col items-center gap-2 text-clay"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#alert" /></svg><p class="font-semibold">${clean(state.error || "Unable to load exceptions.")}</p></div>`);
  const { flagged, operators } = state.exceptions;
  const countBy = (re: RegExp) => flagged.filter((f) => f.reasons.some((r) => re.test(r))).length;
  const tiles = `<div class="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">${tile("Flagged", flagged.length.toLocaleString())}${tile("Voids", String(countBy(/void/i)))}${tile("Refunds", String(countBy(/refund/i)))}${tile("Heavy discounts", String(countBy(/discount/i)))}</div>`;

  const opRows = operators.length
    ? operators.map((o) => `<tr class="border-t border-slate-100"><td class="px-4 py-2.5 font-semibold tabular-nums">${clean(o.operator)}</td><td class="px-4 py-2.5 tabular-nums">${o.txns}</td><td class="px-4 py-2.5 tabular-nums">${o.voids} <span class="text-xs text-slate-400">(${Math.round(o.voidRate * 100)}%)</span></td><td class="px-4 py-2.5 tabular-nums">${o.refunds}</td><td class="px-4 py-2.5"><div class="flex items-center gap-2"><div class="h-2 w-20 overflow-hidden rounded bg-slate-100"><div class="h-2 rounded ${o.risk >= 25 ? "bg-clay" : o.risk >= 12 ? "bg-amber-400" : "bg-emerald-400"}" style="width:${Math.min(100, o.risk)}%"></div></div><span class="text-xs font-bold tabular-nums">${o.risk}</span></div></td></tr>`).join("")
    : `<tr><td colspan="5" class="px-4 py-8 text-center text-sm text-slate-400">No operators with enough volume.</td></tr>`;
  const operatorCard = `<section class="mb-5 overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><h3 class="border-b border-blue-100 px-5 py-3.5 text-sm font-bold text-ink">Operator risk</h3><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr><th class="px-4 py-2.5">Operator</th><th class="px-4 py-2.5">Txns</th><th class="px-4 py-2.5">Voids</th><th class="px-4 py-2.5">Refunds</th><th class="px-4 py-2.5">Risk</th></tr></thead><tbody>${opRows}</tbody></table></div></section>`;

  const flagBody = flagged.length
    ? flagged.map((f) => `<tr class="border-b border-slate-100 last:border-0 hover:bg-mist/40"><td class="whitespace-nowrap px-5 py-3.5 font-medium">${formatDate(f.dt_time_stamp_st)}</td><td class="px-5 py-3.5 font-semibold tabular-nums text-ink">#${clean(f.n0_xact_no)}</td><td class="px-5 py-3.5 tabular-nums text-slate-500">${clean(f.n0_unique_str_no)} · ${clean(f.n0_terminal_no)}</td><td class="px-5 py-3.5 tabular-nums">${clean(f.sz_employee_no)}</td><td class="whitespace-nowrap px-5 py-3.5 font-semibold tabular-nums ${Number(f.n2_amount_price) < 0 ? "text-clay" : ""}">${formatMoney(f.n2_amount_price)}</td><td class="whitespace-nowrap px-5 py-3.5 tabular-nums">${Number(f.discount_total) > 0 ? `<span class="font-medium text-emerald-600">-${formatMoney(f.discount_total)}</span>` : `<span class="text-slate-300">—</span>`}</td><td class="px-5 py-3.5"><div class="flex flex-wrap gap-1">${f.reasons.map(reasonChip).join("")}</div></td><td class="px-5 py-3.5 text-center"><span class="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums">${f.score}</span></td><td class="px-5 py-3.5 text-right"><button class="inspect font-bold text-pine hover:text-ink" data-key="${encodeURIComponent(keyOf(f))}">View</button></td></tr>`).join("")
    : `<tr><td colspan="9" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-emerald-500"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#inbox" /></svg><p class="text-sm font-medium text-slate-500">No exceptions for these filters — all clean.</p></div></td></tr>`;
  const flagCard = `<section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><h3 class="border-b border-blue-100 px-5 py-3.5 text-sm font-bold text-ink">Flagged transactions <span class="font-medium text-slate-400">by risk score</span></h3><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr><th class="px-5 py-3">Date &amp; time</th><th class="px-5 py-3">Txn #</th><th class="px-5 py-3">Store · Term</th><th class="px-5 py-3">Operator</th><th class="px-5 py-3">Amount</th><th class="px-5 py-3">Discount</th><th class="px-5 py-3">Flags</th><th class="px-5 py-3 text-center">Score</th><th class="px-5 py-3"></th></tr></thead><tbody>${flagBody}</tbody></table></div></section>`;
  return `${tiles}${operatorCard}${flagCard}`;
}

// --- transaction detail drawer ---------------------------------------------

function section(title: string, rows: Detail[], columns: [string, string][], currencyColumns: string[] = [], percentageColumns: string[] = [], totalKey?: string, rowAction?: (row: Detail) => string) {
  const heading = `<h3 class="mb-2 flex items-baseline justify-between text-sm font-bold">${title}<span class="text-xs font-medium text-slate-400">${rows.length} ${rows.length === 1 ? "row" : "rows"}</span></h3>`;
  if (!rows.length) return `<section>${heading}<p class="border-y border-slate-100 py-4 text-sm text-slate-500">No records.</p></section>`;
  const total = totalKey ? rows.reduce((sum, row) => sum + Number(row[totalKey] ?? 0), 0) : null;
  const footer = totalKey ? `<tfoot><tr class="border-t-2 border-slate-200 font-semibold"><td class="px-3 py-2.5 text-slate-500">Total</td>${columns.slice(1).map(([key]) => `<td class="px-3 py-2.5 tabular-nums">${key === totalKey ? formatMoney(total) : ""}</td>`).join("")}${rowAction ? `<td class="px-3 py-2.5"></td>` : ""}</tr></tfoot>` : "";
  return `<section>${heading}<div class="overflow-x-auto border-y border-slate-100"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500"><tr>${columns.map(([, label]) => `<th class="px-3 py-2 font-semibold">${label}</th>`).join("")}${rowAction ? `<th class="px-3 py-2"></th>` : ""}</tr></thead><tbody>${rows.map((row) => `<tr class="border-t border-slate-100">${columns.map(([key]) => `<td class="px-3 py-2.5 ${currencyColumns.includes(key) ? "tabular-nums" : ""}">${currencyColumns.includes(key) ? formatMoney(row[key]) : percentageColumns.includes(key) ? formatPercentage(row[key]) : clean(row[key])}</td>`).join("")}${rowAction ? `<td class="px-3 py-2.5 text-right">${rowAction(row)}</td>` : ""}</tr>`).join("")}</tbody>${footer}</table></div></section>`;
}

// Friendly rendering for the rdb_log_info event trail. Each POS event maps to a label and a
// coloured dot; SOLD_ITEM carries a running item count after a colon (e.g. "SOLD_ITEM : 4").
const EVENT_META: Record<string, { label: string; dot: string }> = {
  FIRST_ITEM: { label: "First item scanned", dot: "bg-emerald-500" },
  SUBTOTAL: { label: "Subtotal reached", dot: "bg-slate-400" },
  SOLD_ITEM: { label: "Items registered", dot: "bg-slate-400" },
  START_PAYMENT: { label: "Payment started", dot: "bg-blue-500" },
  END_TRANSACTION: { label: "Transaction completed", dot: "bg-pine" },
  START_PAUSE: { label: "Paused", dot: "bg-amber-500" },
  END_PAUSE: { label: "Resumed", dot: "bg-amber-500" },
};

function timelineMarkup(info: Detail[]) {
  const events = info
    .map((row) => {
      const raw = String(row.sz_info_data ?? "").trim();
      const [head, tail] = raw.split(":").map((part) => part.trim());
      const meta = EVENT_META[head] ?? { label: head.replace(/_/g, " ").toLowerCase(), dot: "bg-slate-300" };
      const label = head === "SOLD_ITEM" && tail ? `${meta.label} · ${tail}` : meta.label;
      return { time: String(row.dt_time_stamp ?? ""), stamp: new Date(String(row.dt_time_stamp ?? "")).getTime(), label, dot: meta.dot };
    })
    .filter((event) => Number.isFinite(event.stamp));
  const heading = (sub: string) => `<h3 class="mb-2 flex items-baseline justify-between text-sm font-bold">Activity timeline<span class="text-xs font-medium text-slate-400">${sub}</span></h3>`;
  if (!events.length) return `<section>${heading("0 events")}<p class="border-y border-slate-100 py-4 text-sm text-slate-500">No activity recorded.</p></section>`;
  const start = events[0].stamp;
  const span = events[events.length - 1].stamp - start;
  const sub = `${span > 0 ? `${formatDuration(span)} · ` : ""}${events.length} event${events.length === 1 ? "" : "s"}`;
  const rows = events.map((event, index) => {
    const last = index === events.length - 1;
    const offset = index === 0 ? "" : ` · +${formatDuration(event.stamp - start)}`;
    return `<li class="relative flex gap-3"><div class="flex flex-col items-center"><span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${event.dot} ring-2 ring-white"></span>${last ? "" : `<span class="w-px flex-1 bg-slate-200"></span>`}</div><div class="flex min-w-0 flex-1 items-baseline justify-between gap-3 ${last ? "" : "pb-3"}"><span class="truncate text-sm text-slate-700">${clean(event.label)}</span><span class="shrink-0 text-xs tabular-nums text-slate-400">${clean(formatTime(event.time))}${offset}</span></div></li>`;
  }).join("");
  return `<section>${heading(sub)}<ol class="border-y border-slate-100 py-3">${rows}</ol></section>`;
}

// Loyalty / customer counter changes from rdb_log_cust_account. Each row is one counter delta
// (visits, points balance, discount) for the identified customer; the name lives in the
// j_delivery_info JSON. Renders a customer card plus the per-counter movements for this sale.
const COUNTER_LABELS: Record<string, string> = { visits: "Visits", balance: "Points balance", discount: "Discount" };

function loyaltyMarkup(rows: Detail[]) {
  if (!rows.length) return "";
  const first = rows[0];
  const customer = String(first.sz_customer_no ?? "").trim();
  const delivery = (first.j_delivery_info && typeof first.j_delivery_info === "object" ? first.j_delivery_info : {}) as Record<string, unknown>;
  const name = [delivery.sz_name, delivery.sz_lname].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  const sign = (action: unknown) => (String(action ?? "").toUpperCase() === "MINUS" ? "−" : "+");
  const counters = rows.map((row) => {
    const descr = String(row.sz_entity_descr ?? "").trim();
    return `<div class="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/70 px-3 py-2"><span class="text-xs font-medium text-slate-500">${clean(COUNTER_LABELS[descr] ?? (descr || "Counter"))}</span><span class="text-sm font-semibold tabular-nums text-ink">${sign(row.sz_action)}${clean(row.n0_entity_value)}</span></div>`;
  }).join("");
  const heading = `<h3 class="mb-2 text-sm font-bold">Loyalty</h3>`;
  const identity = `<div class="mb-3 flex items-center gap-3 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2.5"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">${icon("user")}</span><div class="min-w-0"><p class="truncate text-sm font-semibold text-ink">${name ? clean(name) : "Loyalty customer"}</p>${customer ? `<p class="truncate font-mono text-xs text-slate-500">${clean(customer)}</p>` : ""}</div></div>`;
  return `<section>${heading}${identity}<div class="grid gap-2 sm:grid-cols-3">${counters}</div></section>`;
}

// POS alerts from rdb_log_alert scoped to this transaction. Severity is a numeric POS rank
// (higher = more serious); map it to a coloured tier so voids/overrides stand out from routine
// login/logoff notices. sz_alert_log carries the human-readable detail.
const alertTier = (severity: number) =>
  severity >= 90 ? { label: "Critical", chip: "bg-red-100 text-red-700", dot: "border-red-200 bg-red-50" }
  : severity >= 60 ? { label: "Warning", chip: "bg-amber-100 text-amber-700", dot: "border-amber-200 bg-amber-50" }
  : severity >= 40 ? { label: "Notice", chip: "bg-sky-100 text-sky-700", dot: "border-sky-200 bg-sky-50" }
  : { label: "Info", chip: "bg-slate-100 text-slate-600", dot: "border-slate-200 bg-slate-50" };

function alertsMarkup(rows: Detail[]) {
  if (!rows.length) return "";
  const heading = `<h3 class="mb-2 flex items-center justify-between text-sm font-bold"><span class="flex items-center gap-1.5 text-clay">${icon("alert")}Alerts</span><span class="text-xs font-medium text-slate-400">${rows.length} ${rows.length === 1 ? "alert" : "alerts"}</span></h3>`;
  const items = rows.map((row) => {
    const tier = alertTier(Number(row.n0_alert_severity ?? 0));
    const code = String(row.sz_alert_code ?? "").trim();
    const message = String(row.sz_alert_log ?? "").trim();
    const source = String(row.sz_source ?? "").trim();
    const meta = [row.dt_time_stamp ? formatTime(String(row.dt_time_stamp)) : "", source].filter(Boolean).join(" · ");
    return `<div class="flex gap-3 rounded-md border px-3 py-2.5 ${tier.dot}"><span class="mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tier.chip}">${clean(tier.label)}</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold text-ink">${clean(code || "Alert")}</p>${message ? `<p class="text-xs text-slate-600">${clean(message)}</p>` : ""}${meta ? `<p class="mt-0.5 text-[11px] tabular-nums text-slate-400">${clean(meta)}</p>` : ""}</div></div>`;
  }).join("");
  return `<section>${heading}<div class="space-y-2">${items}</div></section>`;
}

// Per-item action: search every transaction containing this article. Prefer the item reference
// (stable product code) and fall back to the description; the backend matches either.
const itemSearchTerm = (row: Detail) => String(row.sz_item_ref_no ?? "").trim() || String(row.sz_description ?? "").trim();
function itemSearchButton(row: Detail) {
  const term = itemSearchTerm(row);
  if (!term) return "";
  return `<button class="search-item inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-pine transition hover:bg-mist hover:text-ink" data-term="${clean(term)}" title="Find all transactions with this item" aria-label="Find all transactions with this item">${icon("search")}</button>`;
}

function detailSectionsMarkup() {
  const d = state.details!;
  return `<div class="space-y-6">${alertsMarkup(d.alerts ?? [])}${loyaltyMarkup(d.loyalty ?? [])}${section("Items", d.items, [["sz_description", "Description"], ["n0_quantity", "Qty"], ["n2_ext_price", "Line amount"]], ["n2_ext_price"], [], "n2_ext_price", itemSearchButton)}${section("Payments", d.tenders, [["sz_description", "Method"], ["n2_amount", "Amount"], ["sz_auth_number", "Authorisation"]], ["n2_amount"], [], "n2_amount")}${section("Discounts", d.discounts, [["sz_description", "Description"], ["n0_perc_off", "Rate"], ["n2_disc_amount", "Amount"]], ["n2_disc_amount"], [], "n2_disc_amount")}${section("Tax", d.vat, [["n0_tax_code", "Tax code"], ["n3_vat_percentage", "Rate"], ["n2_vat_amount", "Tax amount"]], ["n2_vat_amount"], ["n3_vat_percentage"], "n2_vat_amount")}${timelineMarkup(d.info ?? [])}</div>`;
}

// The original POS-printed receipt from rdb_log_receipt: each line's `val` is already column-aligned,
// so render them verbatim in a monospace <pre>. Collapse the doubled apostrophes left by the source
// escaping (e.g. d''article).
function receiptMarkup() {
  const lines = state.details?.receipt ?? [];
  if (!lines.length) return `<div class="py-12 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-slate-400"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#inbox" /></svg><p class="text-sm font-medium text-slate-500">No printed receipt was recorded for this transaction.</p></div></div>`;
  const rows = lines.map((l) => String(l.val ?? "").replace(/''/g, "'"));
  // Fit-to-width: the widest line drives the font size so the monospace receipt never needs a
  // horizontal scrollbar. `cqw` measures the container's inner width; the font caps at 11px (so short
  // receipts stay a tidy narrow slip) and shrinks only when a line would otherwise overflow. The 0.6
  // factor approximates the monospace character advance; px-5 padding (2.5rem) is subtracted first.
  const width = Math.max(1, ...rows.map((r) => r.length));
  const font = `min(11px, calc((100cqw - 2.9rem) / ${width} / 0.6))`;
  const paper = `<div style="container-type:inline-size"><pre id="receipt" style="font-size:${font}" class="mx-auto w-max max-w-full whitespace-pre rounded-lg border border-slate-200 bg-white px-5 py-6 font-mono leading-[1.45] text-slate-800 shadow-sm">${rows.map(clean).join("\n")}</pre></div>`;
  return `${paper}<button class="print-receipt mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-pine px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">${icon("printer")}Print receipt</button>`;
}

function drawerBodyMarkup() {
  if (state.detailError) return `<div class="flex flex-col items-center gap-2 py-12 text-center text-clay"><svg class="h-7 w-7 fill-none stroke-current" style="stroke-width:1.6"><use href="#alert" /></svg><p class="text-sm font-semibold">Unable to load transaction details.</p></div>`;
  if (!state.details) return `<div class="space-y-6">${Array.from({ length: 3 }, () => `<div><div class="mb-2 h-3.5 w-24 rounded bg-slate-100"></div><div class="space-y-2 border-y border-slate-100 py-3">${Array.from({ length: 2 }, () => `<div class="h-3.5 rounded bg-slate-100"></div>`).join("")}</div></div>`).join("")}</div>`;
  const tab = (id: "detail" | "receipt", label: string) => `<button class="drawer-tab flex-1 rounded px-3 py-1.5 font-medium transition ${state.drawerTab === id ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"}" data-tab="${id}">${label}</button>`;
  const tabs = `<div class="mb-5 flex gap-1 rounded-md bg-slate-100 p-1 text-sm">${tab("detail", "Detail")}${tab("receipt", "Receipt")}</div>`;
  return `${tabs}${state.drawerTab === "receipt" ? receiptMarkup() : detailSectionsMarkup()}`;
}

function drawerMarkup() {
  if (!state.selected) return "";
  const row = state.selected;
  return `<div class="fixed inset-0 z-20 bg-ink/25" data-close></div><aside class="drawer"><header class="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">Transaction detail</p><h2 class="mt-1 flex items-center font-display text-2xl font-semibold">#${clean(row.n0_xact_no)}${isVoided(row) ? badge("Voided", "red") : ""}${row.bl_refund === "1" ? badge("Refund", "amber") : ""}${row.bl_loyalty ? badge("Loyalty", "sky") : ""}</h2><p class="mt-1 text-sm text-slate-500">Store ${clean(row.n0_unique_str_no)} · Terminal ${clean(row.n0_terminal_no)} · ${formatDate(row.dt_time_stamp_st)}</p></div><button class="rounded p-2 text-slate-500 hover:bg-slate-100" data-close aria-label="Close details">${icon("close")}</button></header><div class="p-6"><div class="mb-6 grid grid-cols-2 gap-3 border-y border-slate-100 py-4"><div><p class="text-xs text-slate-500">Total</p><p class="mt-1 text-xl font-semibold ${isVoided(row) ? "text-slate-400 line-through decoration-red-400" : ""}">${formatMoney(row.n2_amount_price)}</p>${isVoided(row) ? `<p class="text-[11px] font-semibold uppercase tracking-wide text-red-600">Voided · not counted</p>` : ""}</div><div><p class="text-xs text-slate-500">Operator</p><p class="mt-1 text-xl font-semibold">${clean(row.sz_employee_no)}</p></div></div><div id="drawer-detail">${drawerBodyMarkup()}</div></div></aside>`;
}

// --- render + state sync ----------------------------------------------------

function render() {
  // Lock the page behind the drawer/modal so only its scrollbar is active (no double scrollbar).
  const scrollLocked = Boolean(state.selected);
  document.documentElement.classList.toggle("scroll-locked", scrollLocked);
  app.classList.toggle("scroll-locked", scrollLocked);
  const content = state.view === "exceptions" ? exceptionsMarkup() : tableMarkup();
  app.innerHTML = `<div class="hidden">${toolbarMarkup()}</div>${subToolbarMarkup()}<div class="app-content"><main class="mx-auto max-w-[1500px] px-5 py-7 md:px-8">${pageHeaderMarkup()}${content}</main></div>${drawerMarkup()}`;
  syncUrl();
  bindEvents();
}

function currentFilters() {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) if (value.trim()) query.set(key, value);
  return query;
}

function syncUrl() {
  const query = currentFilters();
  if (state.view !== "transactions") query.set("view", state.view);
  if (state.sort !== "date") query.set("sort", state.sort);
  if (state.direction !== "desc") query.set("dir", state.direction);
  if (state.page > 1) query.set("page", String(state.page));
  if (state.selected) query.set("sel", encodeURIComponent(keyOf(state.selected)));
  const qs = query.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function currentLocalDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatFilterDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function parseFilterDate(value: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
  return Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== Number(year) || parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day) ? "" : `${year}-${month}-${day}`;
}

function defaultFilterDates() {
  const today = currentLocalDate();
  state.filters.dateFrom ??= today;
  state.filters.dateTo ??= today;
}

function readUrl() {
  const query = new URLSearchParams(location.search);
  for (const key of ["store", "terminal", "operator", "type", "paymentTypes", "loyaltyCard", "dateFrom", "dateTo", "minAmount", "maxAmount", "search"]) {
    const value = query.get(key);
    if (value) state.filters[key] = value;
  }
  defaultFilterDates();
  if (query.get("view") === "exceptions") state.view = "exceptions";
  if (query.get("sort")) state.sort = query.get("sort")!;
  if (query.get("dir") === "asc") state.direction = "asc";
  state.page = Math.max(1, Number.parseInt(query.get("page") ?? "1", 10) || 1);
  state.pendingSel = query.get("sel");
}

function syncFilters() {
  const form = document.querySelector<HTMLFormElement>("#filters");
  if (!form) return;
  for (const [key, value] of new FormData(form).entries()) {
    if (key !== "paymentType") state.filters[key] = key === "dateFrom" || key === "dateTo" ? parseFilterDate(String(value)) : String(value);
  }
  const paymentTypes = new FormData(form).getAll("paymentType").map(String);
  if (paymentTypes.length) state.filters.paymentTypes = paymentTypes.join(",");
  else delete state.filters.paymentTypes;
  form.querySelectorAll<HTMLInputElement>("[data-date-display]").forEach((input) => {
    state.filters[input.dataset.dateDisplay!] = parseFilterDate(input.value);
  });
}

// --- data loading -----------------------------------------------------------

async function loadFacets() {
  try {
    const result = await apiFetch("/api/facets");
    if (!result.ok) return;
    state.facets = await result.json();
    render();
  } catch {
    /* dropdowns fall back to empty; filters still work via query */
  }
}

function loadView() {
  if (state.view === "exceptions") return loadExceptions();
  return loadTransactions();
}

async function loadTransactions() {
  const query = currentFilters();
  state.loading = true;
  state.error = "";
  render();
  query.set("page", String(state.page));
  query.set("sort", state.sort);
  query.set("direction", state.direction);
  try {
    const result = await apiFetch(`/api/transactions?${query}`);
    if (!result.ok) throw new Error("Unable to load transactions");
    const payload = await result.json();
    state.rows = payload.rows;
    state.hasMore = payload.hasMore;
    state.summary = { total: payload.total, salesTotal: payload.salesTotal, refundCount: payload.refundCount, voidCount: payload.voidCount ?? 0, discountTotal: payload.discountTotal };
  } catch (error) {
    state.rows = [];
    state.hasMore = false;
    state.summary = { total: 0, salesTotal: 0, refundCount: 0, voidCount: 0, discountTotal: 0 };
    state.error = error instanceof Error ? error.message : "Unable to load transactions";
  } finally {
    state.loading = false;
    render();
  }
}

async function loadExceptions() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const result = await apiFetch(`/api/exceptions?${currentFilters()}`);
    if (!result.ok) throw new Error("Unable to load exceptions");
    state.exceptions = await result.json();
  } catch (error) {
    state.exceptions = null;
    state.error = error instanceof Error ? error.message : "Unable to load exceptions";
  } finally {
    state.loading = false;
    render();
  }
}

// --- drawer -----------------------------------------------------------------

function findRow(key: string) {
  const decoded = decodeURIComponent(key);
  return [...state.rows, ...(state.exceptions?.flagged ?? [])].find((row) => keyOf(row) === decoded) ?? null;
}

async function inspectTransaction(key: string) {
  state.selected = findRow(key);
  state.details = null;
  state.detailError = false;
  state.drawerTab = "receipt";
  render();
  try {
    const result = await apiFetch(`/api/transactions/${key}`);
    if (!result.ok) throw new Error("Unable to load details");
    state.details = await result.json();
  } catch {
    state.detailError = true;
  } finally {
    // Patch only the drawer body so the panel doesn't re-mount and replay its open animation.
    const detail = document.querySelector<HTMLDivElement>("#drawer-detail");
    if (detail && state.selected) { detail.innerHTML = drawerBodyMarkup(); bindDrawerBody(); syncUrl(); }
    else render();
  }
}

const closeDrawer = () => { if (!state.selected) return; state.selected = null; state.details = null; render(); };
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });

// Jump from an item in the detail drawer to the transaction list filtered by that article.
function searchByItem(term: string) {
  state.filters.search = term;
  state.view = "transactions";
  state.selected = null;
  state.details = null;
  state.page = 1;
  loadTransactions();
}

// --- events -----------------------------------------------------------------

function postToParent(type: string, payload?: Record<string, string>) {
  if (window.parent === window) return;
  window.parent.postMessage(payload ? { type, payload } : { type }, "*");
}

function wireVirtualKeyboard(input: HTMLInputElement) {
  input.addEventListener("focus", () => postToParent("VIRTUAL_KEYBOARD_OPEN", {
    layout: input.inputMode === "numeric" || input.inputMode === "decimal" ? "numeric" : "text",
  }));
  input.addEventListener("blur", (event) => {
    if (!(event.relatedTarget instanceof HTMLInputElement)) postToParent("VIRTUAL_KEYBOARD_CLOSE");
  });
}

function applyVirtualKey(rawKey: unknown) {
  const input = document.activeElement;
  if (!(input instanceof HTMLInputElement) || input.matches("[data-date-picker]")) return;
  const key = String(rawKey ?? "");

  if (/^(\{bksp\}|backspace)$/i.test(key)) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText("", start === end ? Math.max(0, start - 1) : start, end, "end");
  } else if (/^(\{enter\}|enter)$/i.test(key)) {
    input.form?.requestSubmit();
    return;
  } else {
    const character = /^(\{space\}|space)$/i.test(key) ? " " : key;
    if (character.length !== 1) return;
    input.setRangeText(character, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "VIRTUAL_KEYBOARD_EVENT") applyVirtualKey(event.data.payload?.key);
});

function bindDrawerBody() {
  document.querySelectorAll<HTMLButtonElement>(".drawer-tab").forEach((button) => button.addEventListener("click", () => {
    state.drawerTab = button.dataset.tab as "detail" | "receipt";
    const detail = document.querySelector<HTMLDivElement>("#drawer-detail");
    if (detail) { detail.innerHTML = drawerBodyMarkup(); bindDrawerBody(); }
  }));
  document.querySelector<HTMLButtonElement>(".print-receipt")?.addEventListener("click", () => window.print());
  document.querySelectorAll<HTMLButtonElement>(".search-item").forEach((button) => button.addEventListener("click", () => searchByItem(button.dataset.term!)));
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>(".nav-tab").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.view as View;
    if (view === state.view) return;
    state.view = view;
    state.selected = null;
    state.page = 1;
    loadView();
  }));
  const filters = document.querySelector<HTMLFormElement>("#filters");
  filters?.querySelectorAll<HTMLInputElement>('input:not([data-date-picker])').forEach(wireVirtualKeyboard);
  filters?.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.name) return;
    if (target.name === "paymentType") {
      const selected = Array.from(filters.querySelectorAll<HTMLInputElement>('input[name="paymentType"]:checked')).map((input) => input.value);
      if (selected.length) state.filters.paymentTypes = selected.join(",");
      else delete state.filters.paymentTypes;
      return;
    }
    state.filters[target.name] = target.value;
  });
  document.querySelectorAll<HTMLButtonElement>(".date-picker").forEach((button) => button.addEventListener("click", () => {
    const picker = document.querySelector<HTMLInputElement>(`[data-date-picker="${button.dataset.datePickerButton}"]`);
    if (picker?.showPicker) picker.showPicker();
    else { picker?.focus(); picker?.click(); }
  }));
  document.querySelectorAll<HTMLInputElement>("[data-date-picker]").forEach((picker) => picker.addEventListener("change", () => {
    const name = picker.dataset.datePicker!;
    const display = document.querySelector<HTMLInputElement>(`[data-date-display="${name}"]`);
    if (display) display.value = formatFilterDate(picker.value);
    state.filters[name] = picker.value;
  }));
  filters?.addEventListener("submit", (event) => { event.preventDefault(); syncFilters(); state.range = null; state.page = 1; loadView(); });
  filters?.addEventListener("reset", (event) => { event.preventDefault(); state.filters = {}; defaultFilterDates(); state.range = null; state.page = 1; loadView(); });
  document.querySelectorAll<HTMLButtonElement>(".sort").forEach((button) => button.addEventListener("click", () => { const sort = button.dataset.sort!; state.direction = state.sort === sort && state.direction === "desc" ? "asc" : "desc"; state.sort = sort; state.page = 1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".page").forEach((button) => button.addEventListener("click", () => { state.page += button.dataset.direction === "next" ? 1 : -1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".inspect").forEach((button) => button.addEventListener("click", () => inspectTransaction(button.dataset.key!)));
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((element) => element.addEventListener("click", closeDrawer));
  document.querySelectorAll<HTMLButtonElement>(".range").forEach((button) => button.addEventListener("click", () => { const days = Number(button.dataset.days); const to = new Date(); const from = new Date(); from.setDate(to.getDate() - days); state.filters.dateFrom = from.toISOString().slice(0, 10); state.filters.dateTo = to.toISOString().slice(0, 10); state.range = days; state.page = 1; loadView(); }));
  document.querySelector<HTMLButtonElement>(".export-csv")?.addEventListener("click", exportCsv);
  bindDrawerBody();
}

// Download the filtered result set as CSV via a blob so it works in both the browser and the desktop shell.
async function exportCsv() {
  try {
    const result = await apiFetch(`/api/transactions.csv?${currentFilters()}`);
    if (!result.ok) throw new Error("Export failed");
    const url = URL.createObjectURL(await result.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch {
    /* surface nothing intrusive; the button stays available to retry */
  }
}

// --- init -------------------------------------------------------------------

async function init() {
  readUrl();
  loadFacets();
  loadView().then(() => { if (state.pendingSel) { const key = state.pendingSel; state.pendingSel = null; if (findRow(key)) inspectTransaction(key); } });
}

init();
