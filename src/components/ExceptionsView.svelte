<script lang="ts">
  import Badge from "flowbite-svelte/Badge.svelte";
  import { Table, type DataTableOptions } from "@flowbite-svelte-plugins/datatable";
  import { fmt, t } from "../i18n";
  import type { ExplorerController, ExplorerState } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const tableOptions: DataTableOptions = { searchable: false, perPage: 10, perPageSelect: [10, 25, 50] };

  // Column headers are derived from the object keys, so localise the keys.
  $: money = $fmt.money;
  $: date  = $fmt.date;
  $: exceptions   = state.exceptions;
  $: operatorRows = (exceptions?.operators ?? []).map((op) => ({
    [$t("exc.opcol.operator")]: op.operator,
    [$t("exc.opcol.transactions")]: op.txns,
    [$t("exc.opcol.voids")]: op.voids,
    [$t("exc.opcol.refunds")]: op.refunds,
    [$t("exc.opcol.risk")]: op.risk,
  }));
  $: flaggedRows  = (exceptions?.flagged ?? []).map((row) => ({
    [$t("exc.flcol.date")]: date(row.dt_time_stamp_st),
    [$t("exc.flcol.transaction")]: `#${row.n0_xact_no}`,
    [$t("exc.flcol.operator")]: row.sz_employee_no,
    [$t("exc.flcol.amount")]: money(row.n2_amount_price),
    [$t("exc.flcol.flags")]: row.reasons.map((code) => $t(`exc.reason.${code}`)).join(", "),
  }));

  function inspectFlaggedRow(rowIndex: number) {
    const row = exceptions?.flagged[rowIndex];
    if (row) void controller.inspect(encodeURIComponent(controller.transactionKey(row)));
  }
</script>

{#if state.loading}
  <div class="panel empty-state">{$t("exc.loading")}</div>

{:else if !exceptions}
  <div class="panel empty-state" style="color: var(--danger)">{state.error || $t("exc.error")}</div>

{:else}
  <!-- Metric tiles -->
  <div class="panel mb-4">
    <div class="panel-header">
      <div>
        <p class="panel-title">{$t("exc.overview.title")}</p>
        <p class="panel-subtitle">{$t("exc.overview.subtitle")}</p>
      </div>
      <Badge rounded color="red">{$t("exc.badge.flagged", { count: exceptions.flagged.length })}</Badge>
    </div>

    <div class="stat-grid" style="--stat-cols: 4">
      {#each [
        [$t("exc.stat.flagged"),         exceptions.flagged.length],
        [$t("exc.stat.voids"),           exceptions.flagged.filter((i) => i.reasons.includes("voided")).length],
        [$t("exc.stat.refunds"),         exceptions.flagged.filter((i) => i.reasons.includes("refund")).length],
        [$t("exc.stat.heavyDiscounts"),  exceptions.flagged.filter((i) => i.reasons.includes("heavyDiscount")).length],
      ] as [label, value]}
        <div class="stat-tile">
          <p class="stat-label">{label}</p>
          <p class="stat-value">{value}</p>
        </div>
      {/each}
    </div>
  </div>

  <!-- Operator risk panel -->
  <div class="panel mb-4">
    <p class="panel-section-title">{$t("exc.operator.title")}</p>
    {#if operatorRows.length}
      <Table items={operatorRows} dataTableOptions={tableOptions} class="min-w-full text-left" />
    {:else}
      <p class="empty-state">{$t("exc.operator.empty")}</p>
    {/if}
  </div>

  <!-- Flagged transactions panel -->
  <div class="panel">
    <p class="panel-section-title">{$t("exc.flagged.title")}</p>
    {#if flaggedRows.length}
      <Table items={flaggedRows} dataTableOptions={tableOptions} selectable={true} multiSelect={false} onSelectRow={inspectFlaggedRow} class="min-w-full text-left" />
    {:else}
      <p class="empty-state">{$t("exc.flagged.empty")}</p>
    {/if}
  </div>
{/if}
