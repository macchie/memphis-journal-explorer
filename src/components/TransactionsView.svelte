<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import Badge from "flowbite-svelte/Badge.svelte";
  import { Table, type DataTableOptions } from "@flowbite-svelte-plugins/datatable";
  import { ArrowDownOutline, ArrowUpDownOutline, ArrowUpOutline, ChevronLeftOutline, ChevronRightOutline, EyeOutline } from "flowbite-svelte-icons";
  import type { ExplorerController, ExplorerState } from "../main";
  import { isVoided } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const money = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
  const date = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const tableOptions: DataTableOptions = { searchable: false, paging: false, sortable: false };
  const sortColumns = [{ key: "date", label: "Date & time" }, { key: "operator", label: "Operator" }, { key: "amount", label: "Amount" }, { key: "discount", label: "Discount" }];
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
  {#if state.loading}
    <div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><tbody>{#each Array(8) as _}<tr class="border-b border-slate-100">{#each Array(6) as _}<td class="px-5 py-4"><div class="h-3.5 rounded bg-slate-100"></div></td>{/each}</tr>{/each}</tbody></table></div>
  {:else if state.rows.length}
    <Table dataTableOptions={tableOptions} divClass="transaction-datatable relative overflow-x-auto">
      <thead><tr>
        {#each sortColumns as column}
          <th><button type="button" class:active={state.sort === column.key} class="transaction-sort-button" onclick={() => controller.setSort(column.key)}><span>{column.label}</span>{#if state.sort === column.key}{#if state.direction === "asc"}<ArrowUpOutline class="sort-icon" ariaLabel="Sorted ascending" />{:else}<ArrowDownOutline class="sort-icon" ariaLabel="Sorted descending" />{/if}{:else}<ArrowUpDownOutline class="sort-icon text-slate-400" ariaLabel="Not sorted" />{/if}</button></th>
        {/each}
        <th>Txn #</th><th>Items</th><th><span class="sr-only">View transaction</span></th>
      </tr></thead><tbody>
        {#each state.rows as row}
          <tr class:bg-red-50={isVoided(row)}><td class="whitespace-nowrap font-medium text-slate-800">{date(row.dt_time_stamp_st)}</td><td class="tabular-nums text-slate-600">{row.sz_employee_no}</td><td class="whitespace-nowrap font-semibold tabular-nums text-slate-800" class:line-through={isVoided(row)}>{money(row.n2_amount_price)}</td><td class="tabular-nums text-slate-600">{Number(row.discount_total) > 0 ? `-${money(row.discount_total)}` : "-"}</td><td class="font-semibold text-slate-700">#{row.n0_xact_no}</td><td class="text-slate-600">{row.n0_tot_sold_item ?? "-"}</td><td class="text-right"><Button color="alternative" size="xs" class="border-slate-300 bg-white text-slate-700 hover:bg-slate-50" title="View transaction" aria-label="View transaction" onclick={() => controller.inspect(encodeURIComponent(controller.transactionKey(row)))}><EyeOutline class="h-4 w-4" /></Button></td></tr>
        {/each}
      </tbody>
    </Table>
  {:else}
    <p class="px-5 py-16 text-center text-sm text-slate-500">{state.error || "No transactions match these filters."}</p>
  {/if}
  <footer class="datatable-bottom"><p class="datatable-info">Showing {state.loading ? "..." : `${state.rows.length ? (state.page - 1) * 25 + 1 : 0}-${(state.page - 1) * 25 + state.rows.length} of ${state.summary.total}`}</p><nav class="datatable-pagination"><div class="flex gap-1"><Button color="alternative" size="sm" disabled={state.page === 1} title="Previous page" aria-label="Previous page" onclick={() => controller.setPage("prev")}><ChevronLeftOutline class="h-4 w-4" /></Button><Button color="alternative" size="sm" disabled={!state.hasMore} title="Next page" aria-label="Next page" onclick={() => controller.setPage("next")}><ChevronRightOutline class="h-4 w-4" /></Button></div></nav></footer>
</section>