<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import Checkbox from "flowbite-svelte/Checkbox.svelte";
  import Datepicker from "flowbite-svelte/Datepicker.svelte";
  import Dropdown from "flowbite-svelte/Dropdown.svelte";
  import Input from "flowbite-svelte/Input.svelte";
  import InputAddon from "flowbite-svelte/InputAddon.svelte";
  import Select from "flowbite-svelte/Select.svelte";
  import type { ExplorerController, ExplorerState } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const paymentTypes = () => (state.filters.paymentTypes ?? "").split(",").filter(Boolean);
  const toDate = (value: string | undefined) => value ? new Date(`${value}T12:00:00`) : undefined;
  const toIsoDate = (value: Date | undefined) => value ? [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-") : "";

  let rangeFrom = toDate(state.filters.dateFrom);
  let rangeTo = toDate(state.filters.dateTo);

  function onInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    controller.updateFilter(input.name, input.value);
  }

  function applyDateRange() {
    controller.updateFilter("dateFrom", toIsoDate(rangeFrom));
    controller.updateFilter("dateTo", toIsoDate(rangeTo));
  }

  function resetDateRange() {
    rangeFrom = toDate(state.filters.dateFrom);
    rangeTo = toDate(state.filters.dateTo);
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    applyDateRange();
    controller.applyFilters();
  }
</script>

<div class="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-[0_8px_22px_rgba(15,23,42,0.06)] backdrop-blur">
  <form class="toolbar-panel mx-auto max-w-[1500px] px-5 py-4 md:px-8" onsubmit={onSubmit} onreset={() => { controller.resetFilters(); resetDateRange(); }}>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><p class="text-sm font-semibold text-slate-800">Transaction filters</p><p class="text-xs text-slate-500">Refine the ledger without losing your current view.</p></div>
      <div class="flex items-center gap-2">
        <Button type="reset" color="alternative" size="sm" class="border-slate-300 bg-white text-slate-700 hover:bg-slate-50">Reset</Button>
        <Button type="submit" color="blue" size="sm" class="px-4 shadow-sm">Apply filters</Button>
      </div>
    </div>

    <div class="grid gap-3 lg:grid-cols-12">
      <label class="filter-field lg:col-span-5"><span>Find transactions</span><Input name="search" value={state.filters.search ?? ""} oninput={onInput} placeholder="Article, transaction number, or reference" aria-label="Search transactions" /></label>
      <label class="filter-field lg:col-span-2"><span>Transaction type</span><Select name="type" value={state.filters.type ?? ""} onchange={onInput} aria-label="Transaction type" placeholder="All types"><option value="sale">Sales only</option><option value="refund">Refunds only</option><option value="voided">Voided only</option></Select></label>
      <label class="filter-field lg:col-span-5"><span>Trading period</span><Datepicker bind:rangeFrom bind:rangeTo range locale="en-GB" dateFormat={{ day: "2-digit", month: "short", year: "numeric" }} placeholder="Select a date range" inputClass="toolbar-datepicker" inputProps={{ "aria-label": "Transaction date range" }} onapply={applyDateRange} onclear={applyDateRange} /></label>

      <div class="filter-field lg:col-span-4"><span>Payment method</span><Button type="button" color="alternative" size="sm" class="filter-multiselect">{paymentTypes().length ? `${paymentTypes().length} payment method${paymentTypes().length === 1 ? "" : "s"} selected` : "All payment methods"}<svg class="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 0 1 1.09 1.03l-4.26 4.52a.75.75 0 0 1-1.09 0L5.2 8.26a.75.75 0 0 1 .03-1.05Z" clip-rule="evenodd" /></svg></Button><Dropdown simple placement="bottom-start" class="max-h-72 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
        {#each state.facets?.paymentTypes ?? [] as paymentType}
          <li class="px-1"><Checkbox class="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded px-2 text-sm text-slate-700 hover:bg-blue-50" checked={paymentTypes().includes(paymentType)} onchange={() => controller.togglePaymentType(paymentType)}><span class="truncate">{paymentType}</span></Checkbox></li>
        {:else}<li class="px-3 py-4 text-sm text-slate-500">Payment methods are loading.</li>{/each}
      </Dropdown></div>
      <label class="filter-field lg:col-span-3"><span>Loyalty card</span><Input name="loyaltyCard" value={state.filters.loyaltyCard ?? ""} oninput={onInput} inputmode="numeric" placeholder="Card number" aria-label="Loyalty card number" /></label>
      <div class="filter-field lg:col-span-5"><span>Amount range</span><div class="flex items-center gap-2"><InputAddon>EUR</InputAddon><Input name="minAmount" value={state.filters.minAmount ?? ""} oninput={onInput} inputmode="decimal" placeholder="Minimum" aria-label="Minimum amount" /><span class="text-sm text-slate-400">to</span><Input name="maxAmount" value={state.filters.maxAmount ?? ""} oninput={onInput} inputmode="decimal" placeholder="Maximum" aria-label="Maximum amount" /></div></div>
    </div>
  </form>
</div>