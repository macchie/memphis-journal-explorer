<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import Checkbox from "flowbite-svelte/Checkbox.svelte";
  import Datepicker from "flowbite-svelte/Datepicker.svelte";
  import Dropdown from "flowbite-svelte/Dropdown.svelte";
  import DropdownItem from "flowbite-svelte/DropdownItem.svelte";
  import Input from "flowbite-svelte/Input.svelte";
  import Select from "flowbite-svelte/Select.svelte";
  import { intlTag, t } from "../i18n";
  import type { ExplorerController, ExplorerState } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const paymentTypes = () => (state.filters.paymentTypes ?? "").split(",").filter(Boolean);
  const toDate = (value: string | undefined) => value ? new Date(`${value}T12:00:00`) : undefined;
  const toIsoDate = (value: Date | undefined) => value ? [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-") : "";

  let rangeFrom = toDate(state.filters.dateFrom);
  let rangeTo   = toDate(state.filters.dateTo);

  function onInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    controller.updateFilter(input.name, input.value);
  }

  function applyDateRange() {
    controller.updateFilter("dateFrom", toIsoDate(rangeFrom));
    controller.updateFilter("dateTo",   toIsoDate(rangeTo));
  }

  function resetDateRange() {
    rangeFrom = toDate(state.filters.dateFrom);
    rangeTo   = toDate(state.filters.dateTo);
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    applyDateRange();
    controller.applyFilters();
  }
</script>

<div class="filter-bar">
  <form
    class="mx-auto max-w-[1500px] px-5 py-3 md:px-8 flex flex-col gap-3"
    onsubmit={onSubmit}
    onreset={() => { controller.resetFilters(); resetDateRange(); }}
  >
    <!-- Row 1: search · type · date · actions -->
    <div class="grid grid-cols-12 gap-3 items-center">
      <div class="col-span-12 lg:col-span-4">
        <Input
          size="sm"
          name="search"
          value={state.filters.search ?? ""}
          oninput={onInput}
          placeholder={$t("filters.search.placeholder")}
          aria-label={$t("filters.search.aria")}
        />
      </div>
      <div class="col-span-6 lg:col-span-2">
        <Select
          size="sm"
          name="type"
          value={state.filters.type ?? ""}
          onchange={onInput}
          aria-label={$t("filters.type.aria")}
          placeholder={$t("filters.type.all")}
        >
          <option value="sale">{$t("filters.type.sale")}</option>
          <option value="refund">{$t("filters.type.refund")}</option>
          <option value="voided">{$t("filters.type.voided")}</option>
        </Select>
      </div>
      <div class="col-span-6 lg:col-span-4 filter-date-compact">
        <Datepicker
          bind:rangeFrom
          bind:rangeTo
          range
          locale={$intlTag}
          dateFormat={{ day: "2-digit", month: "short", year: "numeric" }}
          placeholder={$t("filters.date.placeholder")}
          inputProps={{ "aria-label": $t("filters.date.aria") }}
          onapply={applyDateRange}
          onclear={applyDateRange}
        />
      </div>
      <div class="col-span-12 lg:col-span-2 flex items-center justify-end gap-2">
        <Button type="reset"  color="alternative" class="ui-btn">{$t("filters.reset")}</Button>
        <Button type="submit" color="blue"        class="ui-btn">{$t("filters.apply")}</Button>
      </div>
    </div>

    <!-- Row 2: payment · loyalty · amount -->
    <div class="grid grid-cols-12 gap-3 items-center">
      <div class="col-span-6 lg:col-span-3">
        <Button
          type="button"
          color="alternative"
          class="ui-btn ui-btn--block ui-btn--between"
          aria-label={$t("filters.payment.aria")}
        >
          <span class="truncate">
            {#if paymentTypes().length === 0}
              {$t("filters.payment.placeholder")}
            {:else if paymentTypes().length === 1}
              {$t("filters.payment.one", { count: 1 })}
            {:else}
              {$t("filters.payment.many", { count: paymentTypes().length })}
            {/if}
          </span>
          <svg class="ms-1 h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 0 1 1.09 1.03l-4.26 4.52a.75.75 0 0 1-1.09 0L5.2 8.26a.75.75 0 0 1 .03-1.05Z" clip-rule="evenodd" />
          </svg>
        </Button>
        <Dropdown simple placement="bottom-start" class="max-h-80 overflow-y-auto">
          {#each state.facets?.paymentTypes ?? [] as paymentType}
            <DropdownItem onclick={() => controller.togglePaymentType(paymentType)} class="ui-dropdown-item">
              <Checkbox class="pointer-events-none h-5 w-5" checked={paymentTypes().includes(paymentType)} />
              <span>{paymentType}</span>
            </DropdownItem>
          {:else}
            <li class="px-4 py-3" style="color: var(--text-subtle)">{$t("filters.payment.loading")}</li>
          {/each}
        </Dropdown>
      </div>
      <div class="col-span-6 lg:col-span-3">
        <Input
          size="sm"
          name="loyaltyCard"
          value={state.filters.loyaltyCard ?? ""}
          oninput={onInput}
          inputmode="numeric"
          placeholder={$t("filters.loyalty.placeholder")}
          aria-label={$t("filters.loyalty.aria")}
        />
      </div>
      <div class="col-span-12 lg:col-span-4 flex items-center gap-2">
        <Input
          size="sm"
          name="minAmount"
          value={state.filters.minAmount ?? ""}
          oninput={onInput}
          inputmode="decimal"
          placeholder={$t("filters.amount.min.placeholder")}
          aria-label={$t("filters.amount.min.aria")}
        />
        <span class="shrink-0 text-xs" style="color: var(--text-subtle)">–</span>
        <Input
          size="sm"
          name="maxAmount"
          value={state.filters.maxAmount ?? ""}
          oninput={onInput}
          inputmode="decimal"
          placeholder={$t("filters.amount.max.placeholder")}
          aria-label={$t("filters.amount.max.aria")}
        />
      </div>
    </div>
  </form>
</div>
