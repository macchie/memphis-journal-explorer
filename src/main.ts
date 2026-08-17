import "./style.css";

type Transaction = {
  dt_time_stamp_st: string;
  n0_unique_str_no: number;
  n0_terminal_no: string;
  n0_xact_no: number;
  n0_operator_no: string;
  n2_amount_price: number;
  n0_tot_sold_item?: number;
  discount_total?: number | string;
  bl_refund?: string;
  bl_loyalty?: boolean;
};

type Detail = Record<string, unknown>;
type Details = { items: Detail[]; tenders: Detail[]; discounts: Detail[]; vat: Detail[] };
type Facets = { stores: string[]; terminals: string[]; operators: string[] };
type Summary = { total: number; salesTotal: number; refundCount: number; discountTotal: number };
type Series = { label: string; txns: number; revenue: number };
type Bar = Series & { qty: number };
type Insights = { byDay: Series[]; byHour: Series[]; byStore: Bar[]; byOperator: Bar[]; topProducts: Bar[] };
type Flagged = Transaction & { reasons: string[]; score: number };
type Operator = { operator: string; txns: number; voids: number; refunds: number; voidRate: number; risk: number };
type Exceptions = { flagged: Flagged[]; operators: Operator[] };
type View = "transactions" | "insights" | "exceptions";

const app = document.querySelector<HTMLDivElement>("#app")!;
const state = {
  view: "transactions" as View,
  rows: [] as Transaction[],
  summary: { total: 0, salesTotal: 0, refundCount: 0, discountTotal: 0 } as Summary,
  page: 1, sort: "date", direction: "desc", hasMore: false,
  loading: false, error: "",
  range: null as number | null,
  facets: null as Facets | null,
  filters: {} as Record<string, string>,
  insights: null as Insights | null,
  exceptions: null as Exceptions | null,
  selected: null as Transaction | null,
  details: null as Details | null,
  detailError: false,
  drawerTab: "detail" as "detail" | "receipt",
  pendingSel: null as string | null,
};

const formatMoney = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
const formatPercentage = (value: unknown) => `${(Number(value ?? 0) / 100).toFixed(2)}%`;
// The API labels naive POS wall-clock timestamps as UTC (trailing "Z"), so render them in UTC to
// show the stored time verbatim rather than re-projecting into the viewer's local zone.
const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
const clean = (value: unknown) => String(value ?? "-").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
const icon = (name: string) => `<svg class="icon" aria-hidden="true"><use href="#${name}" /></svg>`;
const keyOf = (row: Transaction) => JSON.stringify({ timestamp: row.dt_time_stamp_st, store: row.n0_unique_str_no, terminal: row.n0_terminal_no, transaction: row.n0_xact_no });
const badge = (label: string, tone: "amber" | "sky") => `<span class="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}">${label}</span>`;
const logo = () => `<svg class="brand-mark h-10 w-10" viewBox="0 0 40 40" aria-label="Sales Explorer logo" role="img"><rect width="40" height="40" rx="9" fill="#3b82f6"/><path d="M11 13.5h18M11 20h18M11 26.5h11" stroke="#eff6ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="27" cy="26.5" r="4" fill="#bfdbfe"/><path d="m25.3 26.5 1.15 1.15 2.25-2.35" stroke="#1e3a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// --- toolbar + shared chrome ------------------------------------------------

function toolbarMarkup() {
  const tab = (view: View, label: string, ic: string) => `<button class="nav-tab flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${state.view === view ? "bg-white text-blue-700 shadow-sm" : "text-blue-50 hover:bg-white/10"}" data-view="${view}">${icon(ic)}<span class="hidden sm:inline">${label}</span></button>`;
  return `<header class="border-b border-blue-400 bg-blue-600 text-white shadow-lg"><div class="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8"><div class="flex items-center gap-3">${logo()}<div><p class="font-display text-xl font-semibold leading-none">Sales Explorer</p><p class="mt-1 text-xs tracking-wide text-blue-100">Transaction intelligence</p></div></div><nav class="flex gap-1 rounded-lg bg-white/10 p-1">${tab("transactions", "Transactions", "list")}${tab("insights", "Insights", "chart")}${tab("exceptions", "Exceptions", "alert")}</nav></div></header>`;
}

function pageHeaderMarkup() {
  const meta = {
    transactions: { k: "RDB log", t: "Sales transactions", d: "Inspect sales headers, line items, payments, discounts, and tax detail." },
    insights: { k: "Analytics", t: "Insights", d: "Sales trends across time, stores, operators, and products." },
    exceptions: { k: "Loss prevention", t: "Exceptions", d: "Voids, refunds and heavy discounts — ranked by risk." },
  }[state.view];
  const ranges = `<div class="flex rounded-md border border-blue-200 bg-white p-1 text-sm shadow-sm">${[[0, "Today"], [6, "7 days"], [29, "30 days"]].map(([days, label]) => `<button class="range button-range rounded px-3 py-1.5 ${state.range === days ? "bg-pine text-white shadow-sm hover:bg-blue-600 hover:text-white" : ""}" data-days="${days}">${label}</button>`).join("")}</div>`;
  const exportBtn = state.view === "transactions" ? `<a class="button-secondary flex h-[38px] items-center gap-2 rounded-md px-3 text-sm font-medium" href="/api/transactions.csv?${currentFilters()}">${icon("download")}<span class="hidden sm:inline">Export CSV</span></a>` : "";
  return `<section class="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">${meta.k}</p><h1 class="mt-1 font-display text-3xl font-semibold">${meta.t}</h1><p class="mt-1 text-sm text-slate-500">${meta.d}</p></div><div class="flex items-end gap-2">${ranges}${exportBtn}</div></section>`;
}

function select(name: string, label: string, placeholder: string, options: string[] = []) {
  const current = state.filters[name] ?? "";
  return `<label><span class="label">${label}</span><select class="control appearance-none bg-[right_0.6rem_center] bg-no-repeat pr-8" name="${name}" style="background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m3 4.5 3 3 3-3%22/></svg>')"><option value="">${placeholder}</option>${options.map((value) => `<option value="${clean(value)}" ${current === value ? "selected" : ""}>${clean(value)}</option>`).join("")}</select></label>`;
}

function field(name: string, label: string, attrs: string) {
  return `<label><span class="label">${label}</span><input class="control" name="${name}" value="${clean(state.filters[name] ?? "")}" ${attrs} /></label>`;
}

function filterMarkup() {
  const search = state.filters.search ?? "";
  return `<form id="filters" class="mb-5 rounded-lg border border-blue-100 bg-white p-4 shadow-panel"><div class="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">${icon("sliders")} Refine results</div><div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><label class="xl:col-span-2"><span class="label">Search</span><div class="relative"><input class="control pl-9" name="search" value="${clean(search)}" placeholder="Article, transaction, store..." /><span class="pointer-events-none absolute left-3 top-3 text-blue-400">${icon("search")}</span></div></label><label><span class="label">From</span><input class="control" name="dateFrom" type="date" value="${clean(state.filters.dateFrom ?? "")}" /></label><label><span class="label">To</span><input class="control" name="dateTo" type="date" value="${clean(state.filters.dateTo ?? "")}" /></label>${select("store", "Store", "All stores", state.facets?.stores)}${select("terminal", "Terminal", "All terminals", state.facets?.terminals)}${select("operator", "Operator", "All operators", state.facets?.operators)}${field("minAmount", "Min amount", 'inputmode="decimal" placeholder="0.00"')}${field("maxAmount", "Max amount", 'inputmode="decimal" placeholder="0.00"')}<div class="flex items-end gap-2"><button class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-pine px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">${icon("sliders")}Apply</button><button type="reset" class="button-secondary h-10 rounded-md px-3 text-sm font-medium">Clear</button></div></div></form>`;
}

// --- transactions view ------------------------------------------------------

function summaryMarkup() {
  const s = state.summary;
  const nonRefund = Math.max(0, s.total - s.refundCount);
  const cell = (label: string, value: string, last = false) => `<div class="${last ? "px-5" : "border-r border-[#c7d7ff] px-5 first:pl-0"}"><p class="text-xs font-medium text-slate-600">${label}</p><p class="mt-0.5 text-lg font-semibold tabular-nums">${state.loading ? "…" : value}</p></div>`;
  return `<section class="mb-5 flex flex-wrap gap-y-3 rounded-lg border border-[#cddcff] bg-mist px-5 py-4 shadow-sm">${cell("Transactions", String(s.total))}${cell("Sales total", formatMoney(s.salesTotal))}${cell("Average sale", formatMoney(nonRefund ? s.salesTotal / nonRefund : 0))}${cell("Discounts", s.discountTotal > 0 ? `-${formatMoney(s.discountTotal)}` : formatMoney(0))}${cell("Refunds", String(s.refundCount), true)}</section>`;
}

function tableMarkup() {
  const sortable = [["date", "Date & time"], ["store", "Store"], ["terminal", "Terminal"], ["operator", "Operator"], ["amount", "Amount"], ["discount", "Discount"]];
  const emptyState = state.error
    ? `<tr><td colspan="9" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-clay"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#alert" /></svg><p class="text-sm font-semibold">${clean(state.error)}</p><p class="text-xs text-slate-500">Check the API server and try again.</p></div></td></tr>`
    : `<tr><td colspan="9" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-slate-400"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#inbox" /></svg><p class="text-sm font-medium text-slate-500">No transactions match these filters.</p></div></td></tr>`;
  const discountCell = (row: Transaction) => Number(row.discount_total) > 0 ? `<span class="font-medium text-emerald-600">-${formatMoney(row.discount_total)}</span>` : `<span class="text-slate-300">—</span>`;
  const body = state.loading
    ? Array.from({ length: 8 }, () => `<tr class="border-b border-slate-100 last:border-0">${Array.from({ length: 9 }, () => `<td class="px-5 py-4"><div class="h-3.5 rounded bg-slate-100"></div></td>`).join("")}</tr>`).join("")
    : state.rows.length
    ? state.rows.map((row) => `<tr class="border-b border-slate-100 last:border-0 hover:bg-mist/40"><td class="whitespace-nowrap px-5 py-4 font-medium">${formatDate(row.dt_time_stamp_st)}</td><td class="px-5 py-4 font-semibold tabular-nums text-ink">#${clean(row.n0_xact_no)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_unique_str_no)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_terminal_no)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_operator_no)}</td><td class="whitespace-nowrap px-5 py-4 font-semibold tabular-nums ${Number(row.n2_amount_price) < 0 ? "text-clay" : ""}">${formatMoney(row.n2_amount_price)}${row.bl_refund === "1" ? badge("Refund", "amber") : ""}${row.bl_loyalty ? badge("Loyalty", "sky") : ""}</td><td class="whitespace-nowrap px-5 py-4 tabular-nums">${discountCell(row)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_tot_sold_item)}</td><td class="px-5 py-4 text-right"><button class="inspect ml-auto flex items-center gap-1 font-bold text-pine hover:text-ink" data-key="${encodeURIComponent(keyOf(row))}">View ${icon("chevron")}</button></td></tr>`).join("")
    : emptyState;
  const from = state.rows.length ? (state.page - 1) * 25 + 1 : 0;
  const to = (state.page - 1) * 25 + state.rows.length;
  const count = state.loading ? "…" : `${from.toLocaleString()}–${to.toLocaleString()} of ${state.summary.total.toLocaleString()}`;
  return `${summaryMarkup()}<section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="border-b border-blue-100 bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr>${sortable.map(([key, title]) => `<th class="whitespace-nowrap px-5 py-3.5"><button class="sort inline-flex items-center gap-1 transition hover:text-pine ${state.sort === key ? "text-pine" : ""}" data-sort="${key}">${title}<span class="text-[0.7rem]">${state.sort === key ? (state.direction === "asc" ? "↑" : "↓") : ""}</span></button></th>${key === "date" ? `<th class="px-5 py-3.5">Txn #</th>` : ""}`).join("")}<th class="px-5 py-3.5">Items</th><th class="px-5 py-3.5"></th></tr></thead><tbody>${body}</tbody></table></div><footer class="flex items-center justify-between border-t border-blue-100 bg-[#fbfcff] px-5 py-3"><p class="text-sm text-slate-500">Showing ${count}</p><div class="flex gap-2"><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="prev" ${state.page === 1 ? "disabled" : ""}>Previous</button><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="next" ${!state.hasMore ? "disabled" : ""}>Next</button></div></footer></section>`;
}

// --- insights view ----------------------------------------------------------

const statusCard = (body: string) => `<section class="rounded-lg border border-blue-100 bg-white p-12 text-center text-sm shadow-panel">${body}</section>`;
const card = (title: string, body: string, sub = "") => `<section class="rounded-lg border border-blue-100 bg-white p-5 shadow-panel"><h3 class="mb-4 flex items-baseline justify-between text-sm font-bold text-ink">${title}${sub ? `<span class="text-xs font-medium text-slate-400">${sub}</span>` : ""}</h3>${body}</section>`;
const tile = (label: string, value: string, sub = "") => `<div class="rounded-lg border border-[#cddcff] bg-mist px-5 py-4 shadow-sm"><p class="text-xs font-medium text-slate-600">${label}</p><p class="mt-1 text-2xl font-semibold tabular-nums text-ink">${value}</p>${sub ? `<p class="mt-0.5 truncate text-xs text-slate-500">${sub}</p>` : ""}</div>`;

function vBars(rows: { label: string; value: number; hint: string }[], labelEvery = 1) {
  if (!rows.length) return `<p class="py-10 text-center text-sm text-slate-400">No data.</p>`;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div><div class="flex h-40 items-end gap-[3px]">${rows.map((r) => `<div class="flex-1 rounded-t bg-pine/80 transition-colors hover:bg-pine" style="height:${Math.max(2, Math.round((r.value / max) * 100))}%" title="${clean(r.hint)}"></div>`).join("")}</div><div class="mt-1.5 flex gap-[3px] text-[9px] text-slate-400">${rows.map((r, i) => `<div class="flex-1 truncate text-center">${i % labelEvery === 0 ? clean(r.label) : ""}</div>`).join("")}</div></div>`;
}

function barRows(rows: { label: string; value: number; caption: string }[]) {
  if (!rows.length) return `<p class="py-10 text-center text-sm text-slate-400">No data.</p>`;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="space-y-2">${rows.map((r) => `<div class="flex items-center gap-3"><span class="w-24 shrink-0 truncate text-xs font-medium text-slate-600" title="${clean(r.label)}">${clean(r.label)}</span><div class="h-5 flex-1 overflow-hidden rounded bg-slate-100"><div class="h-5 rounded bg-pine" style="width:${Math.max(3, Math.round((r.value / max) * 100))}%"></div></div><span class="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">${clean(r.caption)}</span></div>`).join("")}</div>`;
}

function insightsMarkup() {
  if (state.loading) return statusCard(`<p class="text-slate-500">Crunching the numbers…</p>`);
  if (state.error || !state.insights) return statusCard(`<div class="flex flex-col items-center gap-2 text-clay"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#alert" /></svg><p class="font-semibold">${clean(state.error || "Unable to load insights.")}</p></div>`);
  const ins = state.insights;
  const totalTxns = ins.byStore.reduce((s, r) => s + r.txns, 0);
  const totalRev = ins.byStore.reduce((s, r) => s + r.revenue, 0);
  const busiest = ins.byHour.reduce((a, b) => (b.revenue > a.revenue ? b : a), ins.byHour[0] ?? { label: "—", revenue: 0, txns: 0 });
  const top = ins.topProducts[0];
  const tiles = `<div class="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">${tile("Transactions", totalTxns.toLocaleString())}${tile("Net revenue", formatMoney(totalRev))}${tile("Busiest hour", busiest.label, `${formatMoney(busiest.revenue)} · ${busiest.txns} txns`)}${tile("Top product", top ? formatMoney(top.revenue) : "—", top ? clean(top.label) : "")}</div>`;
  const byDay = vBars(ins.byDay.map((r) => ({ label: r.label.slice(5), value: r.revenue, hint: `${r.label} · ${formatMoney(r.revenue)} · ${r.txns} txns` })), 5);
  const byHour = vBars(ins.byHour.map((r) => ({ label: r.label.slice(0, 2), value: r.revenue, hint: `${r.label} · ${formatMoney(r.revenue)} · ${r.txns} txns` })), 3);
  const products = barRows(ins.topProducts.map((r) => ({ label: r.label, value: r.revenue, caption: formatMoney(r.revenue) })));
  const stores = barRows(ins.byStore.map((r) => ({ label: `Store ${r.label}`, value: r.revenue, caption: formatMoney(r.revenue) })));
  const operators = barRows(ins.byOperator.map((r) => ({ label: `Op ${r.label}`, value: r.revenue, caption: formatMoney(r.revenue) })));
  return `${tiles}<div class="grid gap-5 xl:grid-cols-2">${card("Revenue by day", byDay, "last 30 days")}${card("Revenue by hour", byHour)}${card("Top products", products)}${card("By store", stores)}${card("By operator", operators, "top 12")}</div>`;
}

// --- exceptions view --------------------------------------------------------

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
    ? flagged.map((f) => `<tr class="border-b border-slate-100 last:border-0 hover:bg-mist/40"><td class="whitespace-nowrap px-5 py-3.5 font-medium">${formatDate(f.dt_time_stamp_st)}</td><td class="px-5 py-3.5 font-semibold tabular-nums text-ink">#${clean(f.n0_xact_no)}</td><td class="px-5 py-3.5 tabular-nums text-slate-500">${clean(f.n0_unique_str_no)} · ${clean(f.n0_terminal_no)}</td><td class="px-5 py-3.5 tabular-nums">${clean(f.n0_operator_no)}</td><td class="whitespace-nowrap px-5 py-3.5 font-semibold tabular-nums ${Number(f.n2_amount_price) < 0 ? "text-clay" : ""}">${formatMoney(f.n2_amount_price)}</td><td class="px-5 py-3.5"><div class="flex flex-wrap gap-1">${f.reasons.map(reasonChip).join("")}</div></td><td class="px-5 py-3.5 text-center"><span class="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums">${f.score}</span></td><td class="px-5 py-3.5 text-right"><button class="inspect font-bold text-pine hover:text-ink" data-key="${encodeURIComponent(keyOf(f))}">View</button></td></tr>`).join("")
    : `<tr><td colspan="8" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-emerald-500"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#inbox" /></svg><p class="text-sm font-medium text-slate-500">No exceptions for these filters — all clean.</p></div></td></tr>`;
  const flagCard = `<section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><h3 class="border-b border-blue-100 px-5 py-3.5 text-sm font-bold text-ink">Flagged transactions <span class="font-medium text-slate-400">by risk score</span></h3><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr><th class="px-5 py-3">Date &amp; time</th><th class="px-5 py-3">Txn #</th><th class="px-5 py-3">Store · Term</th><th class="px-5 py-3">Operator</th><th class="px-5 py-3">Amount</th><th class="px-5 py-3">Flags</th><th class="px-5 py-3 text-center">Score</th><th class="px-5 py-3"></th></tr></thead><tbody>${flagBody}</tbody></table></div></section>`;
  return `${tiles}${operatorCard}${flagCard}`;
}

// --- transaction detail drawer ---------------------------------------------

function section(title: string, rows: Detail[], columns: [string, string][], currencyColumns: string[] = [], percentageColumns: string[] = [], totalKey?: string) {
  const heading = `<h3 class="mb-2 flex items-baseline justify-between text-sm font-bold">${title}<span class="text-xs font-medium text-slate-400">${rows.length} ${rows.length === 1 ? "row" : "rows"}</span></h3>`;
  if (!rows.length) return `<section>${heading}<p class="border-y border-slate-100 py-4 text-sm text-slate-500">No records.</p></section>`;
  const total = totalKey ? rows.reduce((sum, row) => sum + Number(row[totalKey] ?? 0), 0) : null;
  const footer = totalKey ? `<tfoot><tr class="border-t-2 border-slate-200 font-semibold"><td class="px-3 py-2.5 text-slate-500">Total</td>${columns.slice(1).map(([key]) => `<td class="px-3 py-2.5 tabular-nums">${key === totalKey ? formatMoney(total) : ""}</td>`).join("")}</tr></tfoot>` : "";
  return `<section>${heading}<div class="overflow-x-auto border-y border-slate-100"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500"><tr>${columns.map(([, label]) => `<th class="px-3 py-2 font-semibold">${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr class="border-t border-slate-100">${columns.map(([key]) => `<td class="px-3 py-2.5 ${currencyColumns.includes(key) ? "tabular-nums" : ""}">${currencyColumns.includes(key) ? formatMoney(row[key]) : percentageColumns.includes(key) ? formatPercentage(row[key]) : clean(row[key])}</td>`).join("")}</tr>`).join("")}</tbody>${footer}</table></div></section>`;
}

function detailSectionsMarkup() {
  const d = state.details!;
  return `<div class="space-y-6">${section("Items", d.items, [["sz_description", "Description"], ["n0_quantity", "Qty"], ["n2_ext_price", "Line amount"]], ["n2_ext_price"], [], "n2_ext_price")}${section("Payments", d.tenders, [["sz_description", "Method"], ["n2_amount", "Amount"], ["sz_auth_number", "Authorisation"]], ["n2_amount"], [], "n2_amount")}${section("Discounts", d.discounts, [["sz_description", "Description"], ["n0_perc_off", "Rate"], ["n2_disc_amount", "Amount"]], ["n2_disc_amount"], [], "n2_disc_amount")}${section("Tax", d.vat, [["n0_tax_code", "Tax code"], ["n3_vat_percentage", "Rate"], ["n2_vat_amount", "Tax amount"]], ["n2_vat_amount"], ["n3_vat_percentage"], "n2_vat_amount")}</div>`;
}

function receiptMarkup() {
  const d = state.details!, row = state.selected!;
  const line = (left: string, right: string, bold = false) => `<div class="flex justify-between gap-4 ${bold ? "font-bold" : ""}"><span class="truncate">${left}</span><span class="shrink-0 tabular-nums">${right}</span></div>`;
  const rule = `<div class="my-2 border-t border-dashed border-slate-300"></div>`;
  const itemsTotal = d.items.reduce((s, i) => s + Number(i.n2_ext_price ?? 0), 0);
  const discTotal = d.discounts.reduce((s, i) => s + Number(i.n2_disc_amount ?? 0), 0);
  const vatTotal = d.vat.reduce((s, i) => s + Number(i.n2_vat_amount ?? 0), 0);
  const items = d.items.map((i) => line(`${clean(i.n0_quantity)} × ${clean(i.sz_description)}`, formatMoney(i.n2_ext_price))).join("");
  const discounts = d.discounts.map((i) => line(clean(i.sz_description), `-${formatMoney(i.n2_disc_amount)}`)).join("");
  const tenders = d.tenders.map((t) => line(clean(t.sz_description), formatMoney(t.n2_amount))).join("");
  return `<div id="receipt" class="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-6 font-mono text-xs leading-relaxed text-slate-800 shadow-sm"><div class="text-center"><p class="text-sm font-bold tracking-widest">SALES RECEIPT</p><p class="mt-1 text-slate-500">Store ${clean(row.n0_unique_str_no)} · Terminal ${clean(row.n0_terminal_no)}</p><p class="text-slate-500">${formatDate(row.dt_time_stamp_st)}</p><p class="text-slate-500">Txn #${clean(row.n0_xact_no)} · Operator ${clean(row.n0_operator_no)}</p></div>${rule}${items || `<p class="text-slate-400">No items.</p>`}${rule}${line("Subtotal", formatMoney(itemsTotal))}${discTotal ? line("Discounts", `-${formatMoney(discTotal)}`) : ""}${vatTotal ? line("Tax", formatMoney(vatTotal)) : ""}${rule}${line("TOTAL", formatMoney(row.n2_amount_price), true)}${tenders ? rule + tenders : ""}${rule}<p class="text-center text-slate-400">Thank you for your visit</p></div><button class="print-receipt mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-pine px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">${icon("printer")}Print receipt</button>`;
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
  return `<div class="fixed inset-0 z-20 bg-ink/25" data-close></div><aside class="drawer"><header class="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">Transaction detail</p><h2 class="mt-1 flex items-center font-display text-2xl font-semibold">#${clean(row.n0_xact_no)}${row.bl_refund === "1" ? badge("Refund", "amber") : ""}${row.bl_loyalty ? badge("Loyalty", "sky") : ""}</h2><p class="mt-1 text-sm text-slate-500">Store ${clean(row.n0_unique_str_no)} · Terminal ${clean(row.n0_terminal_no)} · ${formatDate(row.dt_time_stamp_st)}</p></div><button class="rounded p-2 text-slate-500 hover:bg-slate-100" data-close aria-label="Close details">${icon("close")}</button></header><div class="p-6"><div class="mb-6 grid grid-cols-2 gap-3 border-y border-slate-100 py-4"><div><p class="text-xs text-slate-500">Total</p><p class="mt-1 text-xl font-semibold">${formatMoney(row.n2_amount_price)}</p></div><div><p class="text-xs text-slate-500">Operator</p><p class="mt-1 text-xl font-semibold">${clean(row.n0_operator_no)}</p></div></div><div id="drawer-detail">${drawerBodyMarkup()}</div></div></aside>`;
}

// --- render + state sync ----------------------------------------------------

function render() {
  const content = state.view === "insights" ? insightsMarkup() : state.view === "exceptions" ? exceptionsMarkup() : tableMarkup();
  app.innerHTML = `${toolbarMarkup()}<main class="mx-auto max-w-[1500px] px-5 py-7 md:px-8">${pageHeaderMarkup()}${filterMarkup()}${content}</main>${drawerMarkup()}`;
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

function readUrl() {
  const query = new URLSearchParams(location.search);
  for (const key of ["store", "terminal", "operator", "dateFrom", "dateTo", "minAmount", "maxAmount", "search"]) {
    const value = query.get(key);
    if (value) state.filters[key] = value;
  }
  const view = query.get("view");
  if (view === "insights" || view === "exceptions") state.view = view;
  if (query.get("sort")) state.sort = query.get("sort")!;
  if (query.get("dir") === "asc") state.direction = "asc";
  state.page = Math.max(1, Number.parseInt(query.get("page") ?? "1", 10) || 1);
  state.pendingSel = query.get("sel");
}

function syncFilters() {
  const form = document.querySelector<HTMLFormElement>("#filters");
  if (!form) return;
  for (const [key, value] of new FormData(form).entries()) state.filters[key] = String(value);
}

// --- data loading -----------------------------------------------------------

async function loadFacets() {
  try {
    const result = await fetch("/api/facets");
    if (!result.ok) return;
    state.facets = await result.json();
    render();
  } catch {
    /* dropdowns fall back to empty; filters still work via query */
  }
}

function loadView() {
  if (state.view === "insights") return loadInsights();
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
    const result = await fetch(`/api/transactions?${query}`);
    if (!result.ok) throw new Error("Unable to load transactions");
    const payload = await result.json();
    state.rows = payload.rows;
    state.hasMore = payload.hasMore;
    state.summary = { total: payload.total, salesTotal: payload.salesTotal, refundCount: payload.refundCount, discountTotal: payload.discountTotal };
  } catch (error) {
    state.rows = [];
    state.hasMore = false;
    state.summary = { total: 0, salesTotal: 0, refundCount: 0, discountTotal: 0 };
    state.error = error instanceof Error ? error.message : "Unable to load transactions";
  } finally {
    state.loading = false;
    render();
  }
}

async function loadInsights() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const result = await fetch(`/api/insights?${currentFilters()}`);
    if (!result.ok) throw new Error("Unable to load insights");
    state.insights = await result.json();
  } catch (error) {
    state.insights = null;
    state.error = error instanceof Error ? error.message : "Unable to load insights";
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
    const result = await fetch(`/api/exceptions?${currentFilters()}`);
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
  state.drawerTab = "detail";
  render();
  try {
    const result = await fetch(`/api/transactions/${key}`);
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

// --- events -----------------------------------------------------------------

function bindDrawerBody() {
  document.querySelectorAll<HTMLButtonElement>(".drawer-tab").forEach((button) => button.addEventListener("click", () => {
    state.drawerTab = button.dataset.tab as "detail" | "receipt";
    const detail = document.querySelector<HTMLDivElement>("#drawer-detail");
    if (detail) { detail.innerHTML = drawerBodyMarkup(); bindDrawerBody(); }
  }));
  document.querySelector<HTMLButtonElement>(".print-receipt")?.addEventListener("click", () => window.print());
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
  filters?.addEventListener("input", (event) => { const target = event.target as HTMLInputElement; if (target.name) state.filters[target.name] = target.value; });
  filters?.addEventListener("submit", (event) => { event.preventDefault(); syncFilters(); state.range = null; state.page = 1; loadView(); });
  filters?.addEventListener("reset", (event) => { event.preventDefault(); state.filters = {}; state.range = null; state.page = 1; loadView(); });
  document.querySelectorAll<HTMLButtonElement>(".sort").forEach((button) => button.addEventListener("click", () => { const sort = button.dataset.sort!; state.direction = state.sort === sort && state.direction === "desc" ? "asc" : "desc"; state.sort = sort; state.page = 1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".page").forEach((button) => button.addEventListener("click", () => { state.page += button.dataset.direction === "next" ? 1 : -1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".inspect").forEach((button) => button.addEventListener("click", () => inspectTransaction(button.dataset.key!)));
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((element) => element.addEventListener("click", closeDrawer));
  document.querySelectorAll<HTMLButtonElement>(".range").forEach((button) => button.addEventListener("click", () => { const days = Number(button.dataset.days); const to = new Date(); const from = new Date(); from.setDate(to.getDate() - days); state.filters.dateFrom = from.toISOString().slice(0, 10); state.filters.dateTo = to.toISOString().slice(0, 10); state.range = days; state.page = 1; loadView(); }));
  bindDrawerBody();
}

// --- init -------------------------------------------------------------------

readUrl();
render();
loadFacets();
loadView().then(() => { if (state.pendingSel) { const key = state.pendingSel; state.pendingSel = null; if (findRow(key)) inspectTransaction(key); } });
