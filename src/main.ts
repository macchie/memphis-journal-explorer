import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
  bl_voided?: string | number;
};

type Detail = Record<string, unknown>;
type Details = { items: Detail[]; tenders: Detail[]; discounts: Detail[]; vat: Detail[]; info: Detail[]; loyalty: Detail[]; alerts: Detail[] };
type Facets = { stores: string[]; terminals: string[]; operators: string[] };
type Summary = { total: number; salesTotal: number; refundCount: number; voidCount: number; discountTotal: number };
type Flagged = Transaction & { reasons: string[]; score: number };
type Operator = { operator: string; txns: number; voids: number; refunds: number; voidRate: number; risk: number };
type Exceptions = { flagged: Flagged[]; operators: Operator[] };
type View = "transactions" | "exceptions";
type Server = { id: string; name: string; address: string };

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
  servers: [] as Server[],
  selectedServerId: null as string | null,
  serversReady: false,
  manageOpen: false,
  editingId: null as string | null,
};

// In the browser the API is same-origin (Vite proxies /api); inside the Tauri desktop shell the UI is
// served from tauri:// and talks to the bundled Bun sidecar on localhost:3000.
const IN_TAURI = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__ || (window as any).__TAURI_IPC__);
const API_BASE = IN_TAURI ? "http://localhost:3000" : "";
const api = (path: string) => `${API_BASE}${path}`;
async function apiFetch(path: string, init?: RequestInit) {
  const attempts = IN_TAURI ? 10 : 1; // tolerate the sidecar still booting on desktop cold start
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fetch(api(path), init); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 400)); }
  }
  throw lastError;
}

// --- server list persistence ------------------------------------------------
// Desktop: stored in a JSON file in the OS config dir via Tauri commands. Browser: localStorage fallback.
const SERVER_ADDRESS = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
const STORE_KEY = "rdblog.servers";
type StoredConfig = { servers: Server[]; selectedId: string | null };
const invoke = (cmd: string, args?: Record<string, unknown>) => (window as unknown as { __TAURI__: { core: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__.core.invoke(cmd, args);

async function loadServerConfig(): Promise<StoredConfig> {
  try {
    const raw = IN_TAURI ? (await invoke("load_servers") as string) : localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) as StoredConfig : null;
    if (parsed && Array.isArray(parsed.servers)) return { servers: parsed.servers, selectedId: parsed.selectedId ?? null };
  } catch { /* fall through to empty */ }
  return { servers: [], selectedId: null };
}

async function saveServerConfig() {
  const raw = JSON.stringify({ servers: state.servers, selectedId: state.selectedServerId });
  try {
    if (IN_TAURI) await invoke("save_servers", { data: raw });
    else localStorage.setItem(STORE_KEY, raw);
  } catch { /* best effort */ }
}

const selectedServer = () => state.servers.find((s) => s.id === state.selectedServerId) ?? null;

// Point the backend at the chosen remote host before running any queries.
async function activateServer(address: string) {
  try {
    await apiFetch("/api/server", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) });
  } catch { /* the backend may be booting; subsequent queries surface the error */ }
}

async function connectTo(id: string | null) {
  state.selectedServerId = id;
  state.facets = null;
  await saveServerConfig();
  const server = selectedServer();
  render();
  if (!server) return;
  await activateServer(server.address);
  loadFacets();
  loadView();
}

async function addServer(name: string, address: string) {
  const server: Server = { id: crypto.randomUUID(), name: name.trim(), address: address.trim() };
  state.servers.push(server);
  await saveServerConfig();
  return server;
}

async function updateServer(id: string, name: string, address: string) {
  const server = state.servers.find((s) => s.id === id);
  if (!server) return;
  server.name = name.trim();
  server.address = address.trim();
  state.editingId = null;
  await saveServerConfig();
  if (state.selectedServerId === id) await activateServer(server.address);
  render();
}

async function deleteServer(id: string) {
  state.servers = state.servers.filter((s) => s.id !== id);
  if (state.editingId === id) state.editingId = null;
  if (state.selectedServerId === id) {
    await connectTo(state.servers[0]?.id ?? null);
    return;
  }
  await saveServerConfig();
  render();
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

let isMaximized = false;
if (IN_TAURI) {
  try {
    const appWin = getCurrentWindow();
    appWin.isMaximized().then((max) => { isMaximized = max; });
    appWin.onResized(() => {
      appWin.isMaximized().then((max) => {
        if (isMaximized !== max) {
          isMaximized = max;
          updateWinControls();
        }
      });
    });
  } catch { /* best effort */ }
}

function updateWinControls() {
  const btn = document.querySelector<HTMLButtonElement>("#win-maximize");
  if (btn) {
    const maxIcon = isMaximized ? "win-restore" : "win-maximize";
    const maxTitle = isMaximized ? "Restore window" : "Maximize window";
    btn.title = maxTitle;
    btn.setAttribute("aria-label", maxTitle);
    btn.innerHTML = icon(maxIcon);
  }
}

function windowControlsMarkup() {
  if (!IN_TAURI) return "";
  const maxIcon = isMaximized ? "win-restore" : "win-maximize";
  const maxTitle = isMaximized ? "Restore window" : "Maximize window";
  return `<div class="flex items-center h-full shrink-0 select-none border-l border-slate-800 ml-2 pl-1"><button class="win-ctrl-btn" id="win-minimize" title="Minimize window" aria-label="Minimize window">${icon("win-minimize")}</button><button class="win-ctrl-btn" id="win-maximize" title="${maxTitle}" aria-label="${maxTitle}">${icon(maxIcon)}</button><button class="win-ctrl-close" id="win-close" title="Close window" aria-label="Close window">${icon("win-close")}</button></div>`;
}

function serverSwitcherMarkup() {
  if (!state.servers.length) return "";
  const options = state.servers.map((s) => `<option value="${clean(s.id)}" ${s.id === state.selectedServerId ? "selected" : ""}>${clean(s.name)}</option>`).join("");
  return `<div class="flex items-center gap-1.5"><div class="relative flex items-center"><span class="pointer-events-none absolute left-2 text-slate-400">${icon("server")}</span><select class="server-select h-7 rounded border border-slate-700/60 bg-slate-800/80 pl-7 pr-6 text-xs font-medium text-slate-200 outline-none transition hover:border-slate-600 hover:bg-slate-700/80 focus:border-blue-500 [&>option]:bg-slate-900 [&>option]:text-slate-100" aria-label="Active server">${options}</select></div><button class="manage-servers flex h-7 w-7 items-center justify-center rounded border border-slate-700/60 bg-slate-800/80 text-slate-400 transition hover:bg-slate-700/80 hover:text-slate-200" title="Manage servers" aria-label="Manage servers">${icon("settings")}</button></div>`;
}

function toolbarMarkup() {
  const tab = (view: View, label: string, ic: string) => `<button class="nav-tab flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition ${state.view === view ? "bg-slate-800 text-white shadow-sm border-b-2 border-blue-500" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"}" data-view="${view}">${icon(ic)}<span>${label}</span></button>`;
  const nav = selectedServer() ? `<nav class="flex gap-1 rounded-md border border-slate-800/80 bg-slate-900/60 p-0.5">${tab("transactions", "Transactions", "list")}${tab("exceptions", "Exceptions", "alert")}</nav>` : "";
  // `data-tauri-drag-region` is applied to the non-interactive layout containers so the titlebar can be
  // dragged (and double-clicked to maximize) exactly like a native title bar; interactive children
  // (buttons, nav, select) deliberately omit it so their own clicks are not swallowed by the drag.
  const drag = IN_TAURI ? " data-tauri-drag-region" : "";
  return `<header${drag} class="app-titlebar sticky top-0 z-30 flex h-10 w-full select-none items-center justify-between border-b border-slate-800 bg-slate-950 px-3 text-slate-200 shadow-md"><div${drag} class="flex items-center gap-3 shrink-0"><div${drag} class="flex items-center gap-2">${logo()}<span${drag} class="font-display text-sm font-semibold tracking-tight text-white">Sales Explorer</span></div>${serverSwitcherMarkup()}</div><div${drag} class="flex items-center gap-3 ml-auto">${nav}${windowControlsMarkup()}</div></header>`;
}

function interstitialMarkup() {
  const existing = state.servers.length
    ? `<div class="mt-6 border-t border-slate-100 pt-5"><div class="mb-2 flex items-center justify-between"><p class="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Saved servers</p><button class="manage-servers text-xs font-semibold text-pine hover:text-ink">Manage</button></div><div class="space-y-2">${state.servers.map((s) => `<button class="pick-server flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2.5 text-left text-sm transition hover:border-pine hover:bg-mist/50" data-id="${clean(s.id)}"><span class="min-w-0 truncate"><span class="font-semibold text-ink">${clean(s.name)}</span> <span class="text-slate-400">${clean(s.address)}</span></span><span class="text-pine">${icon("chevron")}</span></button>`).join("")}</div></div>`
    : "";
  return `<main class="mx-auto flex min-h-[72vh] max-w-lg flex-col justify-center px-5 py-10"><div class="rounded-xl border border-blue-100 bg-white p-8 shadow-panel"><div class="mb-6 flex items-center gap-3"><span class="flex h-11 w-11 items-center justify-center rounded-lg bg-mist text-pine">${icon("server")}</span><div><h1 class="font-display text-2xl font-semibold">Connect a server</h1><p class="text-sm text-slate-500">Add a database server to start exploring transactions.</p></div></div><form id="server-form" class="space-y-3"><label class="block"><span class="label">Server name</span><input class="control" name="name" placeholder="e.g. Production" autocomplete="off" required /></label><label class="block"><span class="label">Server address</span><input class="control" name="address" placeholder="e.g. demo.elvispos.com or 192.168.1.123" autocomplete="off" required /></label><p class="server-error hidden text-xs font-medium text-clay"></p><button class="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-pine px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">${icon("plus")}Add &amp; connect</button></form>${existing}</div></main>`;
}

function manageModalMarkup() {
  if (!state.manageOpen) return "";
  const editing = state.servers.find((s) => s.id === state.editingId) ?? null;
  const list = state.servers.length
    ? state.servers.map((s) => `<div class="flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 ${s.id === state.selectedServerId ? "border-pine bg-mist/40" : "border-slate-200"}"><div class="min-w-0"><p class="truncate text-sm font-semibold text-ink">${clean(s.name)}${s.id === state.selectedServerId ? badge("Active", "sky") : ""}</p><p class="truncate text-xs text-slate-500">${clean(s.address)}</p></div><div class="flex shrink-0 gap-1"><button class="edit-server rounded p-1.5 text-slate-500 transition hover:bg-slate-100" data-id="${clean(s.id)}" title="Edit" aria-label="Edit server">${icon("pencil")}</button><button class="delete-server rounded p-1.5 text-clay transition hover:bg-red-50" data-id="${clean(s.id)}" title="Delete" aria-label="Delete server">${icon("trash")}</button></div></div>`).join("")
    : `<p class="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">No servers yet.</p>`;
  return `<div class="fixed inset-0 z-40 bg-ink/30" data-close-modal></div><div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"><div class="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl"><header class="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 class="font-display text-lg font-semibold">Manage servers</h2><button class="rounded p-2 text-slate-500 hover:bg-slate-100" data-close-modal aria-label="Close">${icon("close")}</button></header><div class="max-h-[46vh] space-y-2 overflow-y-auto px-5 py-4">${list}</div><form id="manage-form" class="space-y-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4"><p class="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">${editing ? "Edit server" : "Add server"}</p><label class="block"><span class="label">Name</span><input class="control" name="name" value="${clean(editing?.name ?? "")}" placeholder="Production" autocomplete="off" required /></label><label class="block"><span class="label">Address</span><input class="control" name="address" value="${clean(editing?.address ?? "")}" placeholder="demo.elvispos.com or 192.168.1.123" autocomplete="off" required /></label><p class="server-error hidden text-xs font-medium text-clay"></p><div class="flex gap-2"><button class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-pine px-4 text-sm font-bold text-white transition hover:bg-blue-600">${editing ? "Save changes" : `${icon("plus")}Add server`}</button>${editing ? `<button type="button" class="cancel-edit button-secondary h-10 rounded-md px-3 text-sm font-medium">Cancel</button>` : ""}</div></form></div></div>`;
}

function pageHeaderMarkup() {
  const meta = {
    transactions: { k: "RDB log", t: "Sales transactions", d: "Inspect sales headers, line items, payments, discounts, and tax detail." },
    exceptions: { k: "Loss prevention", t: "Exceptions", d: "Voids, refunds and heavy discounts — ranked by risk." },
  }[state.view];
  const ranges = `<div class="flex rounded-md border border-blue-200 bg-white p-1 text-sm shadow-sm">${[[0, "Today"], [6, "7 days"], [29, "30 days"]].map(([days, label]) => `<button class="range button-range rounded px-3 py-1.5 ${state.range === days ? "bg-pine text-white shadow-sm hover:bg-blue-600 hover:text-white" : ""}" data-days="${days}">${label}</button>`).join("")}</div>`;
  const exportBtn = state.view === "transactions" ? `<button class="export-csv button-secondary flex h-[38px] items-center gap-2 rounded-md px-3 text-sm font-medium" ${state.summary.total ? "" : "disabled"}>${icon("download")}<span class="hidden sm:inline">Export CSV</span></button>` : "";
  // return `<section class="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">${meta.k}</p><h1 class="mt-1 font-display text-3xl font-semibold">${meta.t}</h1><p class="mt-1 text-sm text-slate-500">${meta.d}</p></div><div class="flex items-end gap-2">${ranges}${exportBtn}</div></section>`;
  return `<section class="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">${meta.k}</p><h1 class="mt-1 font-display text-3xl font-semibold">${meta.t}</h1><p class="mt-1 text-sm text-slate-500">${meta.d}</p></div><div class="flex items-end gap-2">${exportBtn}</div></section>`;
}

function select(name: string, label: string, placeholder: string, options: (string | [string, string])[] = []) {
  const current = state.filters[name] ?? "";
  const option = (opt: string | [string, string]) => { const [value, text] = Array.isArray(opt) ? opt : [opt, opt]; return `<option value="${clean(value)}" ${current === value ? "selected" : ""}>${clean(text)}</option>`; };
  return `<label><span class="label">${label}</span><select class="control appearance-none bg-[right_0.6rem_center] bg-no-repeat pr-8" name="${name}" style="background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m3 4.5 3 3 3-3%22/></svg>')"><option value="">${placeholder}</option>${options.map(option).join("")}</select></label>`;
}

function field(name: string, label: string, attrs: string) {
  return `<label><span class="label">${label}</span><input class="control" name="${name}" value="${clean(state.filters[name] ?? "")}" ${attrs} /></label>`;
}

function filterMarkup() {
  const search = state.filters.search ?? "";
  return `<form id="filters" class="mb-5 rounded-lg border border-blue-100 bg-white p-4 shadow-panel"><div class="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">${icon("sliders")} Refine results</div><div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><label class="xl:col-span-2"><span class="label">Search</span><div class="relative"><input class="control pl-9" name="search" value="${clean(search)}" placeholder="Article, transaction, store..." /><span class="pointer-events-none absolute left-3 top-3 text-blue-400">${icon("search")}</span></div></label><label><span class="label">From</span><input class="control" name="dateFrom" type="date" value="${clean(state.filters.dateFrom ?? "")}" /></label><label><span class="label">To</span><input class="control" name="dateTo" type="date" value="${clean(state.filters.dateTo ?? "")}" /></label>${select("store", "Store", "All stores", state.facets?.stores)}${select("terminal", "Terminal", "All terminals", state.facets?.terminals)}${select("operator", "Operator", "All operators", state.facets?.operators)}${select("type", "Type", "All types", [["sale", "Sale"], ["refund", "Refund"], ["voided", "Voided"]])}${field("minAmount", "Min amount", 'inputmode="decimal" placeholder="0.00"')}${field("maxAmount", "Max amount", 'inputmode="decimal" placeholder="0.00"')}<div class="flex items-end gap-2"><button class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-pine px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">${icon("sliders")}Apply</button><button type="reset" class="button-secondary h-10 rounded-md px-3 text-sm font-medium">Clear</button></div></div></form>`;
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
    ? `<tr><td colspan="9" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-clay"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#alert" /></svg><p class="text-sm font-semibold">${clean(state.error)}</p><p class="text-xs text-slate-500">Check the API server and try again.</p></div></td></tr>`
    : `<tr><td colspan="9" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-slate-400"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#inbox" /></svg><p class="text-sm font-medium text-slate-500">No transactions match these filters.</p></div></td></tr>`;
  const discountCell = (row: Transaction) => Number(row.discount_total) > 0 ? `<span class="font-medium text-emerald-600">-${formatMoney(row.discount_total)}</span>` : `<span class="text-slate-300">—</span>`;
  const body = state.loading
    ? Array.from({ length: 8 }, () => `<tr class="border-b border-slate-100 last:border-0">${Array.from({ length: 9 }, () => `<td class="px-5 py-4"><div class="h-3.5 rounded bg-slate-100"></div></td>`).join("")}</tr>`).join("")
    : state.rows.length
    ? state.rows.map((row) => { const voided = isVoided(row); return `<tr class="border-b border-slate-100 last:border-0 hover:bg-mist/40 ${voided ? "bg-red-50/40 text-slate-400" : ""}"><td class="whitespace-nowrap px-5 py-4 font-medium">${formatDate(row.dt_time_stamp_st)}</td><td class="px-5 py-4 font-semibold tabular-nums ${voided ? "text-slate-400" : "text-ink"}">#${clean(row.n0_xact_no)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_unique_str_no)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_terminal_no)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_operator_no)}</td><td class="whitespace-nowrap px-5 py-4 font-semibold tabular-nums ${voided ? "text-slate-400 line-through decoration-red-400" : Number(row.n2_amount_price) < 0 ? "text-clay" : ""}">${formatMoney(row.n2_amount_price)}${voided ? badge("Voided", "red") : ""}${row.bl_refund === "1" ? badge("Refund", "amber") : ""}${row.bl_loyalty ? badge("Loyalty", "sky") : ""}</td><td class="whitespace-nowrap px-5 py-4 tabular-nums">${discountCell(row)}</td><td class="px-5 py-4 tabular-nums">${clean(row.n0_tot_sold_item)}</td><td class="px-5 py-4 text-right"><button class="inspect ml-auto flex items-center gap-1 font-bold text-pine hover:text-ink" data-key="${encodeURIComponent(keyOf(row))}">View ${icon("chevron")}</button></td></tr>`; }).join("")
    : emptyState;
  const from = state.rows.length ? (state.page - 1) * 25 + 1 : 0;
  const to = (state.page - 1) * 25 + state.rows.length;
  const count = state.loading ? "…" : `${from.toLocaleString()}–${to.toLocaleString()} of ${state.summary.total.toLocaleString()}`;
  return `${summaryMarkup()}<section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="border-b border-blue-100 bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr>${sortable.map(([key, title]) => `<th class="whitespace-nowrap px-5 py-3.5"><button class="sort inline-flex items-center gap-1 transition hover:text-pine ${state.sort === key ? "text-pine" : ""}" data-sort="${key}">${title}<span class="text-[0.7rem]">${state.sort === key ? (state.direction === "asc" ? "↑" : "↓") : ""}</span></button></th>${key === "date" ? `<th class="px-5 py-3.5">Txn #</th>` : ""}`).join("")}<th class="px-5 py-3.5">Items</th><th class="px-5 py-3.5"></th></tr></thead><tbody>${body}</tbody></table></div><footer class="flex items-center justify-between border-t border-blue-100 bg-[#fbfcff] px-5 py-3"><p class="text-sm text-slate-500">Showing ${count}</p><div class="flex gap-2"><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="prev" ${state.page === 1 ? "disabled" : ""}>Previous</button><button class="page button-secondary rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" data-direction="next" ${!state.hasMore ? "disabled" : ""}>Next</button></div></footer></section>`;
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
    ? flagged.map((f) => `<tr class="border-b border-slate-100 last:border-0 hover:bg-mist/40"><td class="whitespace-nowrap px-5 py-3.5 font-medium">${formatDate(f.dt_time_stamp_st)}</td><td class="px-5 py-3.5 font-semibold tabular-nums text-ink">#${clean(f.n0_xact_no)}</td><td class="px-5 py-3.5 tabular-nums text-slate-500">${clean(f.n0_unique_str_no)} · ${clean(f.n0_terminal_no)}</td><td class="px-5 py-3.5 tabular-nums">${clean(f.n0_operator_no)}</td><td class="whitespace-nowrap px-5 py-3.5 font-semibold tabular-nums ${Number(f.n2_amount_price) < 0 ? "text-clay" : ""}">${formatMoney(f.n2_amount_price)}</td><td class="px-5 py-3.5"><div class="flex flex-wrap gap-1">${f.reasons.map(reasonChip).join("")}</div></td><td class="px-5 py-3.5 text-center"><span class="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums">${f.score}</span></td><td class="px-5 py-3.5 text-right"><button class="inspect font-bold text-pine hover:text-ink" data-key="${encodeURIComponent(keyOf(f))}">View</button></td></tr>`).join("")
    : `<tr><td colspan="8" class="px-5 py-16 text-center"><div class="mx-auto flex max-w-sm flex-col items-center gap-2 text-emerald-500"><svg class="h-8 w-8 fill-none stroke-current" style="stroke-width:1.6"><use href="#inbox" /></svg><p class="text-sm font-medium text-slate-500">No exceptions for these filters — all clean.</p></div></td></tr>`;
  const flagCard = `<section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel"><h3 class="border-b border-blue-100 px-5 py-3.5 text-sm font-bold text-ink">Flagged transactions <span class="font-medium text-slate-400">by risk score</span></h3><div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="bg-[#f8faff] text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr><th class="px-5 py-3">Date &amp; time</th><th class="px-5 py-3">Txn #</th><th class="px-5 py-3">Store · Term</th><th class="px-5 py-3">Operator</th><th class="px-5 py-3">Amount</th><th class="px-5 py-3">Flags</th><th class="px-5 py-3 text-center">Score</th><th class="px-5 py-3"></th></tr></thead><tbody>${flagBody}</tbody></table></div></section>`;
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
  return `<div class="fixed inset-0 z-20 bg-ink/25" data-close></div><aside class="drawer"><header class="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">Transaction detail</p><h2 class="mt-1 flex items-center font-display text-2xl font-semibold">#${clean(row.n0_xact_no)}${isVoided(row) ? badge("Voided", "red") : ""}${row.bl_refund === "1" ? badge("Refund", "amber") : ""}${row.bl_loyalty ? badge("Loyalty", "sky") : ""}</h2><p class="mt-1 text-sm text-slate-500">Store ${clean(row.n0_unique_str_no)} · Terminal ${clean(row.n0_terminal_no)} · ${formatDate(row.dt_time_stamp_st)}</p></div><button class="rounded p-2 text-slate-500 hover:bg-slate-100" data-close aria-label="Close details">${icon("close")}</button></header><div class="p-6"><div class="mb-6 grid grid-cols-2 gap-3 border-y border-slate-100 py-4"><div><p class="text-xs text-slate-500">Total</p><p class="mt-1 text-xl font-semibold ${isVoided(row) ? "text-slate-400 line-through decoration-red-400" : ""}">${formatMoney(row.n2_amount_price)}</p>${isVoided(row) ? `<p class="text-[11px] font-semibold uppercase tracking-wide text-red-600">Voided · not counted</p>` : ""}</div><div><p class="text-xs text-slate-500">Operator</p><p class="mt-1 text-xl font-semibold">${clean(row.n0_operator_no)}</p></div></div><div id="drawer-detail">${drawerBodyMarkup()}</div></div></aside>`;
}

// --- render + state sync ----------------------------------------------------

function render() {
  if (!state.serversReady) { app.innerHTML = ""; return; }
  if (!selectedServer()) {
    app.innerHTML = `${toolbarMarkup()}${interstitialMarkup()}${manageModalMarkup()}`;
    bindEvents();
    return;
  }
  const content = state.view === "exceptions" ? exceptionsMarkup() : tableMarkup();
  app.innerHTML = `${toolbarMarkup()}<main class="mx-auto max-w-[1500px] px-5 py-7 md:px-8">${pageHeaderMarkup()}${filterMarkup()}${content}</main>${drawerMarkup()}${manageModalMarkup()}`;
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
  for (const key of ["store", "terminal", "operator", "type", "dateFrom", "dateTo", "minAmount", "maxAmount", "search"]) {
    const value = query.get(key);
    if (value) state.filters[key] = value;
  }
  if (query.get("view") === "exceptions") state.view = "exceptions";
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
  state.drawerTab = "detail";
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
  filters?.addEventListener("input", (event) => { const target = event.target as HTMLInputElement; if (target.name) state.filters[target.name] = target.value; });
  filters?.addEventListener("submit", (event) => { event.preventDefault(); syncFilters(); state.range = null; state.page = 1; loadView(); });
  filters?.addEventListener("reset", (event) => { event.preventDefault(); state.filters = {}; state.range = null; state.page = 1; loadView(); });
  document.querySelectorAll<HTMLButtonElement>(".sort").forEach((button) => button.addEventListener("click", () => { const sort = button.dataset.sort!; state.direction = state.sort === sort && state.direction === "desc" ? "asc" : "desc"; state.sort = sort; state.page = 1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".page").forEach((button) => button.addEventListener("click", () => { state.page += button.dataset.direction === "next" ? 1 : -1; loadTransactions(); }));
  document.querySelectorAll<HTMLButtonElement>(".inspect").forEach((button) => button.addEventListener("click", () => inspectTransaction(button.dataset.key!)));
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((element) => element.addEventListener("click", closeDrawer));
  document.querySelectorAll<HTMLButtonElement>(".range").forEach((button) => button.addEventListener("click", () => { const days = Number(button.dataset.days); const to = new Date(); const from = new Date(); from.setDate(to.getDate() - days); state.filters.dateFrom = from.toISOString().slice(0, 10); state.filters.dateTo = to.toISOString().slice(0, 10); state.range = days; state.page = 1; loadView(); }));
  document.querySelector<HTMLButtonElement>(".export-csv")?.addEventListener("click", exportCsv);
  if (IN_TAURI) {
    // Custom window controls, per the official Tauri v2 window-customization guide: call the window API
    // directly. Dragging and double-click-to-maximize are handled natively via `data-tauri-drag-region`.
    const appWin = getCurrentWindow();
    document.querySelector<HTMLButtonElement>("#win-minimize")?.addEventListener("click", () => {
      appWin.minimize().catch((err) => console.error("minimize failed", err));
    });
    document.querySelector<HTMLButtonElement>("#win-maximize")?.addEventListener("click", async () => {
      try {
        await appWin.toggleMaximize();
        isMaximized = await appWin.isMaximized();
        updateWinControls();
      } catch (err) {
        console.error("toggle maximize failed", err);
      }
    });
    document.querySelector<HTMLButtonElement>("#win-close")?.addEventListener("click", () => {
      appWin.close().catch((err) => console.error("close failed", err));
    });
  }
  bindServerEvents();
  bindDrawerBody();
}

function readServerForm(form: HTMLFormElement): { name: string; address: string } | null {
  const data = new FormData(form);
  const name = String(data.get("name") ?? "").trim();
  const address = String(data.get("address") ?? "").trim();
  const error = form.querySelector<HTMLElement>(".server-error");
  const fail = (message: string) => { if (error) { error.textContent = message; error.classList.remove("hidden"); } return null; };
  if (!name) return fail("Please enter a server name.");
  if (!SERVER_ADDRESS.test(address)) return fail("Enter a valid host or IP, e.g. demo.elvispos.com or 192.168.1.123");
  return { name, address };
}

function bindServerEvents() {
  document.querySelector<HTMLSelectElement>(".server-select")?.addEventListener("change", (event) => connectTo((event.target as HTMLSelectElement).value));
  document.querySelectorAll<HTMLButtonElement>(".manage-servers").forEach((button) => button.addEventListener("click", () => { state.manageOpen = true; state.editingId = null; render(); }));
  document.querySelectorAll<HTMLElement>("[data-close-modal]").forEach((element) => element.addEventListener("click", () => { state.manageOpen = false; state.editingId = null; render(); }));
  document.querySelectorAll<HTMLButtonElement>(".edit-server").forEach((button) => button.addEventListener("click", () => { state.editingId = button.dataset.id!; render(); }));
  document.querySelector<HTMLButtonElement>(".cancel-edit")?.addEventListener("click", () => { state.editingId = null; render(); });
  document.querySelectorAll<HTMLButtonElement>(".delete-server").forEach((button) => button.addEventListener("click", () => deleteServer(button.dataset.id!)));
  document.querySelectorAll<HTMLButtonElement>(".pick-server").forEach((button) => button.addEventListener("click", () => connectTo(button.dataset.id!)));
  document.querySelector<HTMLFormElement>("#server-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readServerForm(event.target as HTMLFormElement);
    if (!values) return;
    const server = await addServer(values.name, values.address);
    connectTo(server.id);
  });
  document.querySelector<HTMLFormElement>("#manage-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const values = readServerForm(form);
    if (!values) return;
    if (state.editingId) { await updateServer(state.editingId, values.name, values.address); return; }
    await addServer(values.name, values.address);
    render();
  });
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
  const config = await loadServerConfig();
  state.servers = config.servers;
  state.selectedServerId = config.selectedId && config.servers.some((s) => s.id === config.selectedId) ? config.selectedId : null;
  state.serversReady = true;
  render();
  const server = selectedServer();
  if (!server) return; // first-run interstitial handles server creation
  await activateServer(server.address);
  loadFacets();
  loadView().then(() => { if (state.pendingSel) { const key = state.pendingSel; state.pendingSel = null; if (findRow(key)) inspectTransaction(key); } });
}

init();
