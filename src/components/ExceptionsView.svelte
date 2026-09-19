<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import Badge from "flowbite-svelte/Badge.svelte";
  import type { ExplorerController, ExplorerState } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const money = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value ?? 0) / 100);
  const date = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  $: exceptions = state.exceptions;
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
    <div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="bg-slate-50 text-xs font-bold uppercase text-slate-500"><tr><th class="px-4 py-2.5">Operator</th><th class="px-4 py-2.5">Txns</th><th class="px-4 py-2.5">Voids</th><th class="px-4 py-2.5">Refunds</th><th class="px-4 py-2.5">Risk</th></tr></thead><tbody>
      {#each exceptions.operators as operator}<tr class="border-t border-slate-100"><td class="px-4 py-2.5 font-semibold text-slate-800">{operator.operator}</td><td class="px-4 py-2.5">{operator.txns}</td><td class="px-4 py-2.5">{operator.voids}</td><td class="px-4 py-2.5">{operator.refunds}</td><td class="px-4 py-2.5"><Badge rounded color="yellow">{operator.risk}</Badge></td></tr>{:else}<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">No operators with enough volume.</td></tr>{/each}
    </tbody></table></div>
  </section>
  <section class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel">
    <h3 class="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-800">Flagged transactions</h3>
    <div class="overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="bg-slate-50 text-xs font-bold uppercase text-slate-500"><tr><th class="px-5 py-3">Date</th><th class="px-5 py-3">Txn #</th><th class="px-5 py-3">Operator</th><th class="px-5 py-3">Amount</th><th class="px-5 py-3">Flags</th><th></th></tr></thead><tbody>
      {#each exceptions.flagged as row}<tr class="border-b border-slate-100"><td class="px-5 py-3.5">{date(row.dt_time_stamp_st)}</td><td class="px-5 py-3.5 font-semibold">#{row.n0_xact_no}</td><td class="px-5 py-3.5">{row.sz_employee_no}</td><td class="px-5 py-3.5 font-semibold">{money(row.n2_amount_price)}</td><td class="px-5 py-3.5"><div class="flex flex-wrap gap-1">{#each row.reasons as reason}<Badge rounded color="yellow">{reason}</Badge>{/each}</div></td><td class="px-5 py-3.5"><Button color="alternative" size="xs" class="border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onclick={() => controller.inspect(encodeURIComponent(controller.transactionKey(row)))}>View</Button></td></tr>{:else}<tr><td colspan="6" class="px-5 py-16 text-center text-slate-500">No exceptions for these filters.</td></tr>{/each}
    </tbody></table></div>
  </section>
{/if}