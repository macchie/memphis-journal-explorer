<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import Drawer from "flowbite-svelte/Drawer.svelte";
  import type { ExplorerController, ExplorerState } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const money = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
  const date = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const text = (value: unknown) => String(value ?? "-");
  const cell = (row: Record<string, unknown>, key: string) => text(row[key]);
  const itemColumns: [string, string][] = [["sz_description", "Description"], ["n0_quantity", "Qty"], ["n2_ext_price", "Line amount"]];
  $: details = state.details;
  $: sections = details ? [
    { title: "Items", rows: details.items, columns: itemColumns, currency: ["n2_ext_price"] },
    { title: "Payments", rows: details.tenders, columns: [["sz_description", "Method"], ["n2_amount", "Amount"], ["sz_auth_number", "Authorisation"]], currency: ["n2_amount"] },
    { title: "Discounts", rows: details.discounts, columns: [["sz_description", "Description"], ["n0_perc_off", "Rate"], ["n2_disc_amount", "Amount"]], currency: ["n2_disc_amount"] },
    { title: "Tax", rows: details.vat, columns: [["n0_tax_code", "Tax code"], ["n3_vat_percentage", "Rate"], ["n2_vat_amount", "Tax amount"]], currency: ["n2_vat_amount"] },
  ] : [];
</script>

{#if state.selected}
  <Drawer open={true} placement="right" onclose={() => controller.closeDrawer()} class="w-full max-w-[640px] bg-[#fcfdfd] p-0" aria-label="Transaction detail"><header class="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5"><div><p class="text-xs font-bold uppercase tracking-[0.12em] text-pine">Transaction detail</p><h2 class="mt-1 font-display text-2xl font-semibold">#{state.selected.n0_xact_no}</h2><p class="mt-1 text-sm text-slate-500">Store {state.selected.n0_unique_str_no} · Terminal {state.selected.n0_terminal_no} · {date(state.selected.dt_time_stamp_st)}</p></div><Button color="alternative" size="xs" onclick={() => controller.closeDrawer()} aria-label="Close details">Close</Button></header>
    <div class="p-6"><div class="mb-5 flex gap-1 rounded-md bg-slate-100 p-1 text-sm"><Button color={state.drawerTab === "receipt" ? "blue" : "alternative"} size="sm" class="flex-1" onclick={() => controller.setDrawerTab("receipt")}>Receipt</Button><Button color={state.drawerTab === "detail" ? "blue" : "alternative"} size="sm" class="flex-1" onclick={() => controller.setDrawerTab("detail")}>Detail</Button></div>
      {#if state.detailError}<p class="py-12 text-center text-clay">Unable to load transaction details.</p>
      {:else if !details}<div class="space-y-2 py-8">{#each Array(5) as _}<div class="h-4 rounded bg-slate-100"></div>{/each}</div>
      {:else if state.drawerTab === "receipt"}<pre id="receipt" class="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-5 font-mono text-xs leading-relaxed text-slate-800">{details.receipt.map((line) => text(line.val).replace(/''/g, "'")).join("\n") || "No printed receipt was recorded for this transaction."}</pre>
      {:else}<div class="space-y-6"><div class="grid grid-cols-2 gap-3 border-y border-slate-100 py-4"><div><p class="text-xs text-slate-500">Total</p><p class="mt-1 text-xl font-semibold">{money(state.selected.n2_amount_price)}</p></div><div><p class="text-xs text-slate-500">Operator</p><p class="mt-1 text-xl font-semibold">{state.selected.sz_employee_no}</p></div></div>{#each sections as section}<section><h3 class="mb-2 text-sm font-bold">{section.title}</h3><div class="overflow-x-auto border-y border-slate-100"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500"><tr>{#each section.columns as column}<th class="px-3 py-2">{column[1]}</th>{/each}</tr></thead><tbody>{#each section.rows as row}<tr class="border-t border-slate-100">{#each section.columns as column}<td class="px-3 py-2.5">{section.currency.includes(column[0]) ? money(row[column[0]]) : cell(row, column[0])}</td>{/each}</tr>{:else}<tr><td colspan={section.columns.length} class="px-3 py-4 text-slate-500">No records.</td></tr>{/each}</tbody></table></div></section>{/each}</div>{/if}
    </div>
  </Drawer>
{/if}