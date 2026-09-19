<script lang="ts">
  import Badge from "flowbite-svelte/Badge.svelte";
  import { Table, type DataTableOptions } from "@flowbite-svelte-plugins/datatable";
  import type { ExplorerController, ExplorerState } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const money = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
  const date = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const tableOptions: DataTableOptions = { searchable: false, perPage: 10, perPageSelect: [10, 25, 50] };
  $: exceptions = state.exceptions;
  $: operatorRows = (exceptions?.operators ?? []).map((operator) => ({ operator: operator.operator, transactions: operator.txns, voids: operator.voids, refunds: operator.refunds, risk: operator.risk }));
  $: flaggedRows = (exceptions?.flagged ?? []).map((row) => ({ date: date(row.dt_time_stamp_st), transaction: `#${row.n0_xact_no}`, operator: row.sz_employee_no, amount: money(row.n2_amount_price), flags: row.reasons.join(", ") }));

  function inspectFlaggedRow(rowIndex: number) {
    const row = exceptions?.flagged[rowIndex];
    if (row) void controller.inspect(encodeURIComponent(controller.transactionKey(row)));
  }
</script>

{#if state.loading}
  <section class="rounded-lg border border-blue-100 bg-white p-12 text-center text-sm shadow-panel">Scanning for exceptions...</section>
{:else if !exceptions}
  <section class="rounded-lg border border-blue-100 bg-white p-12 text-center text-sm text-clay shadow-panel">{state.error || "Unable to load exceptions."}</section>
{:else}
  <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {#each [["Flagged", exceptions.flagged.length], ["Voids", exceptions.flagged.filter((item) => item.reasons.some((reason) => /void/i.test(reason))).length], ["Refunds", exceptions.flagged.filter((item) => item.reasons.some((reason) => /refund/i.test(reason))).length], ["Heavy discounts", exceptions.flagged.filter((item) => item.reasons.some((reason) => /discount/i.test(reason))).length]] as tile}
      <div class="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"><p class="text-xs font-medium text-slate-500">{tile[0]}</p><p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{tile[1]}</p></div>
    {/each}
  </div>
  <section class="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel">
    <h3 class="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-800">Operator risk</h3>
    {#if operatorRows.length}
      <Table items={operatorRows} dataTableOptions={tableOptions} class="min-w-full text-left text-sm" />
    {:else}
      <p class="px-4 py-8 text-center text-sm text-slate-400">No operators with enough volume.</p>
    {/if}
  </section>
  <section class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel">
    <h3 class="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-800">Flagged transactions</h3>
    {#if flaggedRows.length}
      <Table items={flaggedRows} dataTableOptions={tableOptions} selectable={true} multiSelect={false} onSelectRow={inspectFlaggedRow} class="min-w-full text-left text-sm" />
    {:else}
      <p class="px-5 py-16 text-center text-sm text-slate-500">No exceptions for these filters.</p>
    {/if}
  </section>
{/if}