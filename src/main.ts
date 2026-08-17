import "./style.css";

type Transaction = {
  dt_time_stamp_st: string;
  n0_unique_str_no: number;
  n0_terminal_no: string;
  n0_xact_no: number;
  n0_operator_no: string;
  n2_amount_price: number;
  n0_tot_sold_item: number;
  bl_refund?: string;
};

type Detail = Record<string, unknown>;
type Details = { items: Detail[]; tenders: Detail[]; discounts: Detail[]; vat: Detail[] };

const app = document.querySelector<HTMLDivElement>("#app")!;
const state = { rows: [] as Transaction[], page: 1, sort: "date", direction: "desc", hasMore: false, loading: false, selected: null as Transaction | null, details: null as Details | null };
const formatMoney = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
const formatPercentage = (value: unknown) => `${(Number(value ?? 0) / 100).toFixed(2)}%`;
const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const clean = (value: unknown) => String(value ?? "-").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
const icon = (name: string) => `<svg class="icon" aria-hidden="true"><use href="#${name}" /></svg>`;
const logo = () => `<svg class="brand-mark h-10 w-10" viewBox="0 0 40 40" aria-label="Sales Explorer logo" role="img"><rect width="40" height="40" rx="9" fill="#3b82f6"/><path d="M11 13.5h18M11 20h18M11 26.5h11" stroke="#eff6ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="27" cy="26.5" r="4" fill="#bfdbfe"/><path d="m25.3 26.5 1.15 1.15 2.25-2.35" stroke="#1e3a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function toolbarMarkup() {
  return `<header class="border-b border-blue-400 bg-blue-600 text-white shadow-lg"><div class="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 md:px-8"><div class="flex items-center gap-3">${logo()}<div><p class="font-display text-xl font-semibold leading-none">Sales Explorer</p><p class="mt-1 text-xs tracking-wide text-blue-100">Transaction intelligence</p></div></div><p class="hidden items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-blue-50 sm:flex"><span class="h-1.5 w-1.5 rounded-full bg-sky-200"></span>Live database</p></div></header>`;
}

function filterMarkup() {
  return `<form id="filters" class="mb-5 rounded-lg border border-blue-100 bg-white p-4 shadow-panel"><div class="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">${icon("sliders")} Refine results</div><div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><label class="xl:col-span-2"><span class="label">Search</span><div class="relative"><input class="control pl-9" name="search" placeholder="Article, transaction, store..." /><span class="pointer-events-none absolute left-3 top-3 text-blue-400">${icon("search")}</span></div></label><label><span class="label">From</span><input class="control" name="dateFrom" type="date" /></label><label><span class="label">To</span><input class="control" name="dateTo" type="date" /></label><label><span class="label">Store</span><input class="control" name="store" inputmode="numeric" placeholder="All stores" /></label><label><span class="label">Terminal</span><input class="control" name="terminal" inputmode="numeric" placeholder="All terminals" /></label><label><span class="label">Operator</span><input class="control" name="operator" inputmode="numeric" placeholder="All operators" /></label><label><span class="label">Min amount</span><input class="control" name="minAmount" inputmode="decimal" placeholder="0.00" /></label><label><span class="label">Max amount</span><input class="control" name="maxAmount" inputmode="decimal" placeholder="0.00" /></label><div class="flex items-end gap-2"><button class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-pine px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-600">${icon("sliders")}Apply</button><button type="reset" class="button-secondary h-10 rounded-md px-3 text-sm font-medium">Clear</button></div></div></form>`;
}

function tableMarkup() {
  const pageTotal = state.rows.reduce((total, row) => total + Number(row.n2_amount_price), 0);
  const sortable = [["date", "Date & time"], ["store", "Store"], ["terminal", "Terminal"], ["operator", "Operator"], ["amount", "Amount"]];
  const body = state.loading ? `<tr><td colspan="7" class="px-5 py-14 text-center text-slate-500">Loading transactions...</td></tr>` : state.rows.length ? state.rows.map((row) => `<tr class="border-b border-slate-100 last:border-0 hover:bg-mist/40"><td class="whitespace-nowrap px-5 py-4 font-medium">${formatDate(row.dt_time_stamp_st)}</td><td class="px-5 py-4">${clean(row.n0_unique_str_no)}</td><td class="px-5 py-4">${clean(row.n0_terminal_no)}</td><td class="px-5 py-4">${clean(row.n0_operator_no)}</td><td class="px-5 py-4 font-semibold ${Number(row.n2_amount_price) < 0 ? "text-clay" : ""}">${formatMoney(row.n2_amount_price)}${row.bl_refund === "1" ? `<span class="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-700">Refund</span>` : ""}</td><td class="px-5 py-4">${clean(row.n0_tot_sold_item)}</td><td class="px-5 py-4"><button class="inspect flex items-center gap-1 font-bold text-pine hover:text-[#064e4a]" data-key="${encodeURIComponent(JSON.stringify({ timestamp: row.dt_time_stamp_st, store: row.n0_unique_str_no, terminal: row.n0_terminal_no, transaction: row.n0_xact_no }))}">View ${icon("chevron")}</button></td></tr>`).join("") : `<tr><td colspan="7" class="px-5 py-14 text-center text-slate-500">No transactions match these filters.</td></tr>`;
  return `<section class="mb-5 flex flex-wrap gap-0 rounded-lg border border-[#cddcff] bg-mist px-5 py-4 shadow-sm"><div class="border-r border-[#c7d7ff] pr-5"><p class="text-xs font-medium text-slate-600">Transactions</p><p class="mt-0.5 text-lg font-semibold">${state.loading ? "..." : state.rows.length}</p></div><div class="border-r border-[#c7d7ff] px-5"><p class="text-xs font-medium text-slate-600">Page total</p><p class="mt-0.5 text-lg font-semibold">${state.loading ? "..." : formatMoney(pageTotal)}</p></div><div class="px-5"><p class="text-xs font-medium text-slate-600">Average sale</p><p class="mt-0.5 text-lg font-semibold">${state.loading ? "..." : formatMoney(state.rows.length ? pageTotal / state.rows.length : 0)}</p></div></section><section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="border-b border-blue-100 bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr>${sortable.map(([key, title]) => `<th class="whitespace-nowrap px-5 py-3.5"><button class="sort hover:text-pine" data-sort="${key}">${title}${state.sort === key ? ` ${state.direction === "asc" ? "↑" : "↓"}` : ""}</button></th>`).join("")}<th class="px-5 py-3.5">Items</th><th class="px-5 py-3.5"></th></tr></thead><tbody>${body}</tbody></table></div><footer class="flex items-center justify-between border-t border-blue-100 bg-[#fbfcff] px-5 py-3"><p class="text-sm text-slate-500">Page ${state.page}</p><div class="flex gap-2"><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="prev" ${state.page === 1 ? "disabled" : ""}>Previous</button><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="next" ${!state.hasMore ? "disabled" : ""}>Next</button></div></footer></section>`;
}

function section(title: string, rows: Detail[], columns: [string, string][], currencyColumns: string[] = [], percentageColumns: string[] = []) {
  if (!rows.length) return `<section><h3 class="mb-2 text-sm font-bold">${title}</h3><p class="border-y border-slate-100 py-4 text-sm text-slate-500">No records.</p></section>`;
  return `<section><h3 class="mb-2 text-sm font-bold">${title}</h3><div class="overflow-x-auto border-y border-slate-100"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500"><tr>${columns.map(([, label]) => `<th class="px-3 py-2 font-semibold">${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr class="border-t border-slate-100">${columns.map(([key]) => `<td class="px-3 py-2.5">${currencyColumns.includes(key) ? formatMoney(row[key]) : percentageColumns.includes(key) ? formatPercentage(row[key]) : clean(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
}

function drawerMarkup() {
  if (!state.selected) return "";
  const row = state.selected;
  const details = state.details;
  const body = !details ? `<p class="py-12 text-center text-sm text-slate-500">Loading transaction details...</p>` : `<div class="space-y-6">${section("Items", details.items, [["sz_description", "Description"], ["n0_quantity", "Qty"], ["n2_ext_price", "Line amount"]], ["n2_ext_price"])}${section("Payments", details.tenders, [["sz_description", "Method"], ["n2_amount", "Amount"], ["sz_auth_number", "Authorisation"]], ["n2_amount"])}${section("Discounts", details.discounts, [["sz_description", "Description"], ["n0_perc_off", "Rate"], ["n2_perc_off_amount", "Amount"]], ["n2_perc_off_amount"])}${section("Tax", details.vat, [["n0_tax_code", "Tax code"], ["n3_vat_percentage", "Rate"], ["n2_vat_amount", "Tax amount"]], ["n2_vat_amount"], ["n3_vat_percentage"])}</div>`;
  return `<div class="fixed inset-0 z-20 bg-ink/25" data-close></div><aside class="drawer"><header class="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">Transaction detail</p><h2 class="mt-1 font-display text-2xl font-semibold">#${clean(row.n0_xact_no)}</h2><p class="mt-1 text-sm text-slate-500">Store ${clean(row.n0_unique_str_no)} · Terminal ${clean(row.n0_terminal_no)} · ${formatDate(row.dt_time_stamp_st)}</p></div><button class="rounded p-2 text-slate-500 hover:bg-slate-100" data-close aria-label="Close details">${icon("close")}</button></header><div class="p-6"><div class="mb-6 grid grid-cols-2 gap-3 border-y border-slate-100 py-4"><div><p class="text-xs text-slate-500">Total</p><p class="mt-1 text-xl font-semibold">${formatMoney(row.n2_amount_price)}</p></div><div><p class="text-xs text-slate-500">Operator</p><p class="mt-1 text-xl font-semibold">${clean(row.n0_operator_no)}</p></div></div>${body}</div></aside>`;
}

function render() {
  app.innerHTML = `${toolbarMarkup()}<main class="mx-auto max-w-[1500px] px-5 py-7 md:px-8"><section class="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">RDB log</p><h1 class="mt-1 font-display text-3xl font-semibold">Sales transactions</h1><p class="mt-1 text-sm text-slate-500">Inspect sales headers, line items, payments, discounts, and tax detail.</p></div><div class="flex rounded-md border border-blue-200 bg-white p-1 text-sm shadow-sm"><button class="range button-range rounded px-3 py-1.5" data-days="0">Today</button><button class="range button-range rounded px-3 py-1.5" data-days="6">7 days</button><button class="range button-range rounded px-3 py-1.5" data-days="29">30 days</button></div></section>${filterMarkup()}${tableMarkup()}</main>${drawerMarkup()}`;
  bindEvents();
}

function currentFilters() {
  const form = document.querySelector<HTMLFormElement>("#filters")!;
  return new URLSearchParams(Array.from(new FormData(form).entries()).map(([key, value]) => [key, String(value)]));
}

async function loadTransactions() {
  const query = currentFilters();
  state.loading = true;
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
  } catch {
    state.rows = [];
    state.hasMore = false;
  } finally {
    state.loading = false;
    render();
  }
}

async function inspectTransaction(key: string) {
  state.selected = state.rows.find((row) => JSON.stringify({ timestamp: row.dt_time_stamp_st, store: row.n0_unique_str_no, terminal: row.n0_terminal_no, transaction: row.n0_xact_no }) === decodeURIComponent(key)) ?? null;
  state.details = null;
  render();
  try {
    const result = await fetch(`/api/transactions/${key}`);
    if (!result.ok) throw new Error("Unable to load details");
    state.details = await result.json();
  } finally {
    render();
  }
}

function bindEvents() {
  document.querySelector<HTMLFormElement>("#filters")?.addEventListener("submit", (event) => { event.preventDefault(); state.page = 1; loadTransactions(); });
  document.querySelector<HTMLFormElement>("#filters")?.addEventListener("reset", () => { window.setTimeout(() => { state.page = 1; loadTransactions(); }); });
  document.querySelectorAll<HTMLButtonElement>(".sort").forEach((button) => button.addEventListener("click", () => { const sort = button.dataset.sort!; state.direction = state.sort === sort && state.direction === "desc" ? "asc" : "desc"; state.sort = sort; state.page = 1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".page").forEach((button) => button.addEventListener("click", () => { state.page += button.dataset.direction === "next" ? 1 : -1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".inspect").forEach((button) => button.addEventListener("click", () => inspectTransaction(button.dataset.key!)));
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((element) => element.addEventListener("click", () => { state.selected = null; state.details = null; render(); }));
  document.querySelectorAll<HTMLButtonElement>(".range").forEach((button) => button.addEventListener("click", () => { const to = new Date(); const from = new Date(); from.setDate(to.getDate() - Number(button.dataset.days)); const form = document.querySelector<HTMLFormElement>("#filters")!; form.dateFrom.value = from.toISOString().slice(0, 10); form.dateTo.value = to.toISOString().slice(0, 10); state.page = 1; loadTransactions(); }));
}

render();
loadTransactions();