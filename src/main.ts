export type View = "transactions" | "exceptions";
export type DateFilterName = "dateFrom" | "dateTo";
export type DrawerTab = "detail" | "receipt";
export type Transaction = { dt_time_stamp_st: string; n0_unique_str_no: number; n0_terminal_no: string; n0_xact_no: number; sz_employee_no: string; n2_amount_price: number; n0_tot_sold_item?: number; discount_total?: number | string; bl_refund?: string; bl_loyalty?: boolean; bl_voided?: string | number };
export type Detail = Record<string, unknown>;
export type Details = { items: Detail[]; tenders: Detail[]; discounts: Detail[]; vat: Detail[]; info: Detail[]; loyalty: Detail[]; alerts: Detail[]; receipt: Detail[] };
export type Facets = { stores: string[]; terminals: string[]; operators: string[]; paymentTypes: string[] };
export type Summary = { total: number; salesTotal: number; refundCount: number; voidCount: number; discountTotal: number };
export type Flagged = Transaction & { reasons: string[]; score: number };
export type Operator = { operator: string; txns: number; voids: number; refunds: number; voidRate: number; risk: number };
export type Exceptions = { flagged: Flagged[]; operators: Operator[] };
export type ExplorerState = { view: View; rows: Transaction[]; summary: Summary; page: number; sort: string; direction: "asc" | "desc"; hasMore: boolean; loading: boolean; error: string; facets: Facets | null; filters: Record<string, string>; exceptions: Exceptions | null; selected: Transaction | null; details: Details | null; detailError: boolean; drawerTab: DrawerTab; calendarMonths: Partial<Record<DateFilterName, string>>; calendarOpen: DateFilterName | null };
export type ExplorerController = {
  state: ExplorerState;
  init(): void;
  destroy(): void;
  setView(view: View): void;
  updateFilter(name: string, value: string): void;
  togglePaymentType(value: string): void;
  applyFilters(): void;
  resetFilters(): void;
  setSort(sort: string): void;
  setPage(direction: "prev" | "next"): void;
  inspect(key: string): Promise<void>;
  closeDrawer(): void;
  setDrawerTab(tab: DrawerTab): void;
  searchByItem(term: string): void;
  onKeydown(event: KeyboardEvent): void;
  transactionKey(row: Transaction): string;
};

type Row = Record<string, string | number | boolean | null | unknown[]>;
type Filters = Record<string, string | undefined>;
const num = (value: unknown) => Number(value ?? 0);
const isInteger = (value: string | undefined) => Boolean(value && /^\d+$/.test(value));
const isNumber = (value: string | undefined) => Boolean(value && /^-?\d+(\.\d+)?$/.test(value));
const escapeLiteral = (value: string) => value.replaceAll("'", "''");
const today = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
export const transactionKey = (row: Transaction) => JSON.stringify({ timestamp: row.dt_time_stamp_st, store: row.n0_unique_str_no, terminal: row.n0_terminal_no, transaction: row.n0_xact_no });
export const isVoided = (row: Transaction) => row.bl_voided === "1" || row.bl_voided === 1;

const remoteServer = import.meta.env.VITE_REMOTE_LOOKUP_SERVER ?? (!["localhost", "127.0.0.1"].includes(window.location.hostname) ? window.location.hostname : "142.132.232.189");
const remoteLookupUrl = `http://${remoteServer.includes(":") ? remoteServer : `${remoteServer}:7392`}/api/db-operations/remote-lookup`;
const DISCOUNT_TOTAL = "COALESCE((SELECT SUM(COALESCE(d.n2_allowance, 0) + COALESCE(d.n2_perc_off_amount, 0)) FROM public.rdb_log_discount d WHERE d.dt_time_stamp = h.dt_time_stamp_st AND d.n0_unique_str_no = h.n0_unique_str_no AND d.n0_terminal_no = h.n0_terminal_no AND d.n0_xact_no = h.n0_xact_no AND COALESCE(d.bl_voided, 0) <> 1), 0)";
const SORT_COLUMNS: Record<string, string> = { date: "h.dt_time_stamp_st", amount: "h.n2_amount_price", store: "h.n0_unique_str_no", terminal: "h.n0_terminal_no", operator: "h.sz_employee_no", discount: "discount_total" };

async function remoteQuery(query: string): Promise<Row[]> {
  let response: Response;
  try { response = await fetch(remoteLookupUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: { command: 1003, query } }), signal: AbortSignal.timeout(15_000) }); } catch { throw new Error(`Could not reach ${remoteServer}`); }
  if (!response.ok) throw new Error(`Remote database returned ${response.status}`);
  const result = (await response.text()).trim();
  if (!result || result.startsWith("NO DATA") || result.startsWith("NO RECORD FOUND")) return [];
  if (result.startsWith("SQL ERROR")) throw new Error("Query rejected by remote database");
  return JSON.parse(result) as Row[];
}

function transactionWhere(filters: Filters) {
  const clauses = ["h.n0_trans_type = 0", "h.bl_suspended = 0", "h.bl_training = 0"];
  if (isInteger(filters.store)) clauses.push(`h.n0_unique_str_no = ${filters.store}`);
  if (isInteger(filters.terminal)) clauses.push(`h.n0_terminal_no = ${filters.terminal}`);
  if (filters.operator?.trim()) clauses.push(`TRIM(COALESCE(h.sz_employee_no, '')) = '${escapeLiteral(filters.operator.trim())}'`);
  if (filters.type === "voided") clauses.push("COALESCE(h.bl_voided, 0) = 1"); else if (filters.type === "refund") clauses.push("COALESCE(h.bl_refund, 0) = 1"); else if (filters.type === "sale") clauses.push("COALESCE(h.bl_refund, 0) <> 1 AND COALESCE(h.bl_voided, 0) <> 1");
  if (filters.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) clauses.push(`h.dt_time_stamp_st >= '${filters.dateFrom}'::date`);
  if (filters.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) clauses.push(`h.dt_time_stamp_st < ('${filters.dateTo}'::date + interval '1 day')`);
  if (isNumber(filters.minAmount)) clauses.push(`h.n2_amount_price >= ${Math.round(Number(filters.minAmount) * 100)}`);
  if (isNumber(filters.maxAmount)) clauses.push(`h.n2_amount_price <= ${Math.round(Number(filters.maxAmount) * 100)}`);
  const match = (table: string) => `${table}.dt_time_stamp = h.dt_time_stamp_st AND ${table}.n0_unique_str_no = h.n0_unique_str_no AND ${table}.n0_terminal_no = h.n0_terminal_no AND ${table}.n0_xact_no = h.n0_xact_no`;
  const payments = [...new Set((filters.paymentTypes ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
  if (payments.length) clauses.push(`EXISTS (SELECT 1 FROM public.rdb_log_tender t WHERE ${match("t")} AND TRIM(COALESCE(t.sz_description, t.sz_tender_type, '')) IN (${payments.map((value) => `'${escapeLiteral(value)}'`).join(", ")}))`);
  if (filters.loyaltyCard?.trim()) clauses.push(`EXISTS (SELECT 1 FROM public.rdb_log_cust_account c WHERE ${match("c")} AND TRIM(COALESCE(c.sz_customer_no, '')) ILIKE '%${escapeLiteral(filters.loyaltyCard.trim())}%')`);
  if (filters.search?.trim()) { const term = escapeLiteral(filters.search.trim()); clauses.push(`(CAST(h.n0_xact_no AS text) ILIKE '%${term}%' OR CAST(h.n0_unique_str_no AS text) ILIKE '%${term}%' OR EXISTS (SELECT 1 FROM public.rdb_log_item i WHERE i.dt_time_stamp = h.dt_time_stamp_st AND i.n0_unique_str_no = h.n0_unique_str_no AND i.n0_terminal_no = h.n0_terminal_no AND i.n0_xact_no = h.n0_xact_no AND (i.sz_description ILIKE '%${term}%' OR TRIM(i.sz_item_ref_no) ILIKE '%${term}%')))`); }
  return clauses.join(" AND ");
}

const listSelect = (where: string, sort: string, direction: string, limit: number, offset = 0) => `SELECT h.dt_time_stamp_st, h.n0_unique_str_no, h.n0_terminal_no, h.n0_xact_no, h.sz_employee_no, h.n2_amount_price, h.n0_tot_sold_item, h.bl_refund, h.bl_loyalty, h.bl_voided, ${DISCOUNT_TOTAL} AS discount_total FROM public.rdb_log h WHERE ${where} ORDER BY ${sort} ${direction}, h.dt_time_stamp_st DESC LIMIT ${limit} OFFSET ${offset}`;

async function fetchTransactions(filters: Filters) {
  const where = transactionWhere(filters), sort = SORT_COLUMNS[filters.sort ?? "date"] ?? SORT_COLUMNS.date, direction = filters.direction === "asc" ? "ASC" : "DESC", page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const [rows, summary, discount] = await Promise.all([remoteQuery(listSelect(where, sort, direction, 26, (page - 1) * 25)), remoteQuery(`SELECT count(*) total, COALESCE(SUM(h.n2_amount_price) FILTER (WHERE h.bl_refund <> '1' AND COALESCE(h.bl_voided, 0) <> 1), 0) sales, count(*) FILTER (WHERE h.bl_refund = '1' AND COALESCE(h.bl_voided, 0) <> 1) refunds, count(*) FILTER (WHERE COALESCE(h.bl_voided, 0) = 1) voids FROM public.rdb_log h WHERE ${where}`), remoteQuery(`SELECT COALESCE(SUM(COALESCE(d.n2_allowance, 0) + COALESCE(d.n2_perc_off_amount, 0)), 0) disc FROM public.rdb_log_discount d JOIN public.rdb_log h ON h.dt_time_stamp_st = d.dt_time_stamp AND h.n0_unique_str_no = d.n0_unique_str_no AND h.n0_terminal_no = d.n0_terminal_no AND h.n0_xact_no = d.n0_xact_no WHERE ${where} AND COALESCE(d.bl_voided, 0) <> 1 AND COALESCE(h.bl_voided, 0) <> 1`)]);
  return { rows: rows.slice(0, 25) as Transaction[], hasMore: rows.length > 25, total: num(summary[0]?.total), salesTotal: num(summary[0]?.sales), refundCount: num(summary[0]?.refunds), voidCount: num(summary[0]?.voids), discountTotal: num(discount[0]?.disc) };
}

async function fetchExceptions(filters: Filters): Promise<Exceptions> {
  const where = transactionWhere(filters);
  const [candidates, operatorsRaw] = await Promise.all([remoteQuery(`SELECT h.dt_time_stamp_st, h.n0_unique_str_no store, h.n0_terminal_no term, h.n0_xact_no xact, h.sz_employee_no oper, h.n2_amount_price amount, h.bl_refund, h.bl_voided, ${DISCOUNT_TOTAL} disc FROM public.rdb_log h WHERE ${where} AND (h.bl_refund = '1' OR COALESCE(h.bl_voided, 0) = 1 OR h.n2_amount_price <= 0 OR (${DISCOUNT_TOTAL}) > h.n2_amount_price / 2) ORDER BY h.dt_time_stamp_st DESC LIMIT 200`), remoteQuery(`SELECT TRIM(COALESCE(h.sz_employee_no, '')) oper, count(*) txns, count(*) FILTER (WHERE h.bl_refund = '1') refunds, count(*) FILTER (WHERE h.bl_voided = '1') voids FROM public.rdb_log h WHERE ${where} GROUP BY 1`)]);
  const flagged = candidates.map((row) => { const reasons: string[] = []; if (num(row.bl_voided) === 1) reasons.push("Voided transaction"); if (num(row.bl_refund) === 1) reasons.push("Refund"); if (num(row.amount) <= 0) reasons.push("Non-positive amount"); if (num(row.amount) > 0 && num(row.disc) > num(row.amount) / 2) reasons.push("Heavy discount"); return { dt_time_stamp_st: String(row.dt_time_stamp_st ?? ""), n0_unique_str_no: num(row.store), n0_terminal_no: String(row.term ?? ""), n0_xact_no: num(row.xact), sz_employee_no: String(row.oper ?? ""), n2_amount_price: num(row.amount), discount_total: num(row.disc), bl_refund: String(row.bl_refund ?? ""), bl_voided: String(row.bl_voided ?? ""), reasons, score: reasons.length * 25 }; }).sort((left, right) => right.score - left.score);
  const operators = operatorsRaw.map((row) => { const txns = num(row.txns), voids = num(row.voids), refunds = num(row.refunds); return { operator: String(row.oper), txns, voids, refunds, voidRate: txns ? voids / txns : 0, risk: txns ? Math.round((voids * 40 + refunds * 30) / txns) : 0 }; }).filter((operator) => operator.txns >= 5).sort((left, right) => right.risk - left.risk).slice(0, 10);
  return { flagged, operators };
}

async function fetchDetails(key: string): Promise<Details> {
  const parsed = JSON.parse(decodeURIComponent(key)) as Record<string, string | number>, date = String(parsed.timestamp ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isInteger(String(parsed.store)) || !isInteger(String(parsed.terminal)) || !isInteger(String(parsed.transaction))) throw new Error("Invalid transaction key");
  const range = (column: string) => `${column} >= '${date}'::date AND ${column} < '${date}'::date + interval '1 day'`, match = `n0_unique_str_no = ${parsed.store} AND n0_terminal_no = ${parsed.terminal} AND n0_xact_no = ${parsed.transaction}`, where = `${range("dt_time_stamp")} AND ${match}`;
  const [items, tenders, discounts, vat, info, loyalty, alerts, receiptRows] = await Promise.all([remoteQuery(`SELECT n0_sequence_no, sz_description, sz_item_ref_no, n0_quantity, n2_amount_price, n2_ext_price, bl_return FROM public.rdb_log_item WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, sz_description, sz_tender_type, n2_amount, sz_auth_number FROM public.rdb_log_tender WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, sz_description, n0_perc_off, (COALESCE(n2_allowance, 0) + COALESCE(n2_perc_off_amount, 0)) n2_disc_amount FROM public.rdb_log_discount WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_tax_code, n2_sold_amount, n2_vat_amount, n3_vat_percentage FROM public.rdb_log_vat WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, dt_time_stamp, sz_info_data FROM public.rdb_log_info WHERE ${where} ORDER BY dt_time_stamp, n0_sequence_no`), remoteQuery(`SELECT n0_sequence_no, sz_customer_no, sz_action, sz_entity_descr, n0_entity_value FROM public.rdb_log_cust_account WHERE ${where} ORDER BY n0_sequence_no`), remoteQuery(`SELECT dt_time_stamp, n0_alert_severity, sz_alert_code, sz_alert_log, sz_source FROM public.rdb_log_alert WHERE ${where} ORDER BY dt_time_stamp`), remoteQuery(`SELECT j_receipt_line FROM public.rdb_log_receipt WHERE ${where} ORDER BY dt_time_stamp`)]);
  return { items, tenders, discounts, vat, info, loyalty, alerts, receipt: receiptRows.flatMap((row) => Array.isArray(row.j_receipt_line) ? row.j_receipt_line : []) as Detail[] };
}

export function createSalesExplorer(onRender: () => void): ExplorerController {
  const state: ExplorerState = { view: "transactions", rows: [], summary: { total: 0, salesTotal: 0, refundCount: 0, voidCount: 0, discountTotal: 0 }, page: 1, sort: "date", direction: "desc", hasMore: false, loading: false, error: "", facets: null, filters: { dateFrom: today(), dateTo: today() }, exceptions: null, selected: null, details: null, detailError: false, drawerTab: "receipt", calendarMonths: {}, calendarOpen: null };
  const filters = () => ({ ...state.filters, page: String(state.page), sort: state.sort, direction: state.direction });
  const syncUrl = () => { const query = new URLSearchParams(); for (const [key, value] of Object.entries(state.filters)) if (value.trim()) query.set(key, value); if (state.view !== "transactions") query.set("view", state.view); if (state.sort !== "date") query.set("sort", state.sort); if (state.direction !== "desc") query.set("dir", state.direction); if (state.page > 1) query.set("page", String(state.page)); if (state.selected) query.set("sel", encodeURIComponent(transactionKey(state.selected))); history.replaceState(null, "", query.size ? `?${query}` : location.pathname); };
  const notify = () => { document.documentElement.classList.toggle("scroll-locked", Boolean(state.selected)); syncUrl(); onRender(); };
  const load = async () => { state.loading = true; state.error = ""; notify(); try { if (state.view === "transactions") { const result = await fetchTransactions(filters()); state.rows = result.rows; state.hasMore = result.hasMore; state.summary = result; } else state.exceptions = await fetchExceptions(filters()); } catch (error) { state.error = error instanceof Error ? error.message : "Unable to load data"; if (state.view === "transactions") state.rows = []; else state.exceptions = null; } finally { state.loading = false; notify(); } };
  const loadFacets = async () => { try { const [stores, terminals, operators, paymentTypes] = await Promise.all([remoteQuery("SELECT DISTINCT n0_unique_str_no value FROM public.rdb_log WHERE n0_trans_type = 0 ORDER BY 1"), remoteQuery("SELECT DISTINCT n0_terminal_no value FROM public.rdb_log WHERE n0_trans_type = 0 ORDER BY 1"), remoteQuery("SELECT DISTINCT TRIM(COALESCE(sz_employee_no, '')) value FROM public.rdb_log WHERE n0_trans_type = 0 AND TRIM(COALESCE(sz_employee_no, '')) <> '' ORDER BY 1"), remoteQuery("SELECT DISTINCT TRIM(COALESCE(sz_description, sz_tender_type, '')) value FROM public.rdb_log_tender WHERE TRIM(COALESCE(sz_description, sz_tender_type, '')) <> '' ORDER BY 1")]); state.facets = { stores: stores.map((row) => String(row.value)), terminals: terminals.map((row) => String(row.value)), operators: operators.map((row) => String(row.value)), paymentTypes: paymentTypes.map((row) => String(row.value)) }; notify(); } catch { /* filters remain usable */ } };
  const init = () => { const query = new URLSearchParams(location.search); for (const key of Object.keys(state.filters)) { const value = query.get(key); if (value) state.filters[key] = value; } state.view = query.get("view") === "exceptions" ? "exceptions" : "transactions"; state.sort = query.get("sort") ?? "date"; state.direction = query.get("dir") === "asc" ? "asc" : "desc"; state.page = Math.max(1, Number(query.get("page")) || 1); void loadFacets(); void load(); };
  return { state, init, destroy: () => document.documentElement.classList.remove("scroll-locked"), setView: (view: View) => { if (view !== state.view) { state.view = view; state.selected = null; state.page = 1; void load(); } }, updateFilter: (name: string, value: string) => { state.filters[name] = value; notify(); }, togglePaymentType: (value: string) => { const selected = new Set((state.filters.paymentTypes ?? "").split(",").filter(Boolean)); selected.has(value) ? selected.delete(value) : selected.add(value); state.filters.paymentTypes = [...selected].join(","); notify(); }, applyFilters: () => { state.page = 1; void load(); }, resetFilters: () => { state.filters = { dateFrom: today(), dateTo: today() }; state.page = 1; void load(); }, setSort: (sort: string) => { state.direction = state.sort === sort && state.direction === "desc" ? "asc" : "desc"; state.sort = sort; state.page = 1; void load(); }, setPage: (direction: "prev" | "next") => { state.page += direction === "next" ? 1 : -1; void load(); }, inspect: async (key: string) => { state.selected = [...state.rows, ...(state.exceptions?.flagged ?? [])].find((row) => transactionKey(row) === decodeURIComponent(key)) ?? null; state.details = null; state.detailError = false; state.drawerTab = "receipt"; notify(); try { state.details = await fetchDetails(key); } catch { state.detailError = true; } finally { notify(); } }, closeDrawer: () => { state.selected = null; state.details = null; notify(); }, setDrawerTab: (tab: DrawerTab) => { state.drawerTab = tab; notify(); }, searchByItem: (term: string) => { state.filters.search = term; state.view = "transactions"; state.selected = null; state.page = 1; void load(); }, onKeydown: (event: KeyboardEvent) => { if (event.key === "Escape") { state.selected = null; notify(); } }, transactionKey };
}