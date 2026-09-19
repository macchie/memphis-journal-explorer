<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import Badge from "flowbite-svelte/Badge.svelte";
  import type { ExplorerController, ExplorerState } from "../main";
  import { isVoided } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const money = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
  const date = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  $: sales = Math.max(0, state.summary.total - state.summary.refundCount - state.summary.voidCount);
</script>

<section class="mb-5 overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel">
  <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3.5"><div><h1 class="text-sm font-semibold text-slate-800">Sales ledger</h1><p class="mt-0.5 text-xs text-slate-500">A complete view of the current filtered transaction set.</p></div><Badge rounded color="blue">{state.loading ? "Refreshing" : `${state.summary.total} records`}</Badge></div>
  <div class="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-6">
  {#each [["Transactions", String(state.summary.total)], ["Sales total", money(state.summary.salesTotal)], ["Average sale", money(sales ? state.summary.salesTotal / sales : 0)], ["Discounts", money(state.summary.discountTotal)], ["Refunds", String(state.summary.refundCount)], ["Voided", String(state.summary.voidCount)]] as summary}
    <div class="px-5 py-4"><p class="text-xs font-medium text-slate-500">{summary[0]}</p><p class="mt-1 text-lg font-semibold tabular-nums text-slate-900">{state.loading ? "..." : summary[1]}</p></div>
  {/each}
  </div>
</section>
<section class="overflow-hidden rounded-lg border border-blue-100 bg-white shadow-panel">
  <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3.5"><h2 class="text-sm font-semibold text-slate-800">Transactions</h2><span class="text-xs text-slate-500">Newest activity first</span></div>
  <div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-[0.07em] text-slate-500"><tr>
    {#each [["date", "Date & time"], ["operator", "Operator"], ["amount", "Amount"], ["discount", "Discount"]] as column}
      <th class="whitespace-nowrap px-5 py-3.5"><Button color="alternative" size="xs" class={state.sort === column[0] ? "text-pine" : ""} onclick={() => controller.setSort(column[0])}>{column[1]} {state.sort === column[0] ? state.direction === "asc" ? "up" : "down" : ""}</Button></th>
    {/each}
    <th class="px-5 py-3.5">Txn #</th><th class="px-5 py-3.5">Items</th><th></th>
  </tr></thead><tbody>
    {#if state.loading}
      {#each Array(8) as _}<tr class="border-b border-slate-100">{#each Array(7) as _}<td class="px-5 py-4"><div class="h-3.5 rounded bg-slate-100"></div></td>{/each}</tr>{/each}
    {:else if state.rows.length}
      {#each state.rows as row}
        <tr class:bg-red-50={isVoided(row)} class="border-b border-slate-100 transition-colors hover:bg-blue-50/50"><td class="whitespace-nowrap px-5 py-4 font-medium text-slate-800">{date(row.dt_time_stamp_st)}</td><td class="px-5 py-4 tabular-nums text-slate-600">{row.sz_employee_no}</td><td class="whitespace-nowrap px-5 py-4 font-semibold tabular-nums text-slate-800" class:line-through={isVoided(row)}>{money(row.n2_amount_price)}</td><td class="px-5 py-4 tabular-nums text-slate-600">{Number(row.discount_total) > 0 ? `-${money(row.discount_total)}` : "-"}</td><td class="px-5 py-4 font-semibold text-slate-700">#{row.n0_xact_no}</td><td class="px-5 py-4 text-slate-600">{row.n0_tot_sold_item ?? "-"}</td><td class="px-5 py-4 text-right"><Button color="alternative" size="xs" class="border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onclick={() => controller.inspect(encodeURIComponent(controller.transactionKey(row)))}>View</Button></td></tr>
      {/each}
    {:else}<tr><td colspan="7" class="px-5 py-16 text-center text-slate-500">{state.error || "No transactions match these filters."}</td></tr>{/if}
  </tbody></table></div>
  <footer class="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-5 py-3"><p class="text-sm text-slate-500">Showing {state.loading ? "..." : `${state.rows.length ? (state.page - 1) * 25 + 1 : 0}-${(state.page - 1) * 25 + state.rows.length} of ${state.summary.total}`}</p><div class="flex gap-2"><Button color="alternative" size="sm" class="border-slate-300 bg-white text-slate-700 hover:bg-slate-50" disabled={state.page === 1} onclick={() => controller.setPage("prev")}>Previous</Button><Button color="alternative" size="sm" class="border-slate-300 bg-white text-slate-700 hover:bg-slate-50" disabled={!state.hasMore} onclick={() => controller.setPage("next")}>Next</Button></div></footer>
</section>