<script lang="ts">
  import Badge from "flowbite-svelte/Badge.svelte";
  import Button from "flowbite-svelte/Button.svelte";
  import Skeleton from "flowbite-svelte/Skeleton.svelte";
  import { ArrowDownOutline, ArrowUpDownOutline, ArrowUpOutline, ChevronLeftOutline, ChevronRightOutline, EyeOutline } from "flowbite-svelte-icons";
  import { fmt, t } from "../i18n";
  import type { ExplorerController, ExplorerState } from "../main";
  import { isVoided } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  $: money = $fmt.money;
  $: date  = $fmt.date;
  const sortColumns = [
    { key: "date",     labelKey: "txn.col.datetime" },
    { key: "operator", labelKey: "txn.col.operator" },
    { key: "amount",   labelKey: "txn.col.amount"   },
    { key: "discount", labelKey: "txn.col.discount" },
  ];
  $: sales = Math.max(0, state.summary.total - state.summary.refundCount - state.summary.voidCount);
</script>

<!-- Stats panel -->
<div class="panel mb-4">
  <div class="panel-header">
    <div>
      <p class="panel-title">{$t("txn.ledger.title")}</p>
      <p class="panel-subtitle">{$t("txn.ledger.subtitle")}</p>
    </div>
    <Badge rounded color="blue">{state.loading ? $t("txn.badge.refreshing") : $t("txn.badge.records", { count: state.summary.total })}</Badge>
  </div>

  <div class="stat-grid">
    {#each [
      [$t("txn.stat.transactions"), String(state.summary.total)],
      [$t("txn.stat.salesTotal"),   money(state.summary.salesTotal)],
      [$t("txn.stat.averageSale"),  money(sales ? state.summary.salesTotal / sales : 0)],
      [$t("txn.stat.discounts"),    money(state.summary.discountTotal)],
      [$t("txn.stat.refunds"),      String(state.summary.refundCount)],
      [$t("txn.stat.voided"),       String(state.summary.voidCount)],
    ] as [label, value]}
      <div class="stat-tile">
        <p class="stat-label">{label}</p>
        <p class="stat-value">{state.loading ? "—" : value}</p>
      </div>
    {/each}
  </div>
</div>

<!-- Transactions panel -->
<div class="panel">
  <div class="panel-header">
    <h2 class="panel-title">{$t("txn.table.title")}</h2>
    <span class="text-sm" style="color: var(--text-subtle)">{$t("txn.table.newestFirst")}</span>
  </div>

  {#if state.loading}
    <div class="p-5">
      <Skeleton />
    </div>

  {:else if state.rows.length}
    <div class="relative overflow-x-auto">
      <table class="dark-table">
      <thead>
        <tr>
          {#each sortColumns as column}
            <th>
              <button
                type="button"
                class="transaction-sort-button"
                class:active={state.sort === column.key}
                onclick={() => controller.setSort(column.key)}
              >
                {$t(column.labelKey)}
                {#if state.sort === column.key}
                  {#if state.direction === "asc"}
                    <ArrowUpOutline   class="sort-icon" ariaLabel={$t("txn.sort.asc")}  />
                  {:else}
                    <ArrowDownOutline class="sort-icon" ariaLabel={$t("txn.sort.desc")} />
                  {/if}
                {:else}
                  <ArrowUpDownOutline class="sort-icon" ariaLabel={$t("txn.sort.none")} />
                {/if}
              </button>
            </th>
          {/each}
          <th>{$t("txn.col.txnNo")}</th>
          <th>{$t("txn.col.items")}</th>
          <th><span class="sr-only">{$t("txn.col.view")}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each state.rows as row}
          <tr style={isVoided(row) ? "opacity: 0.45;" : ""}>
            <td class="whitespace-nowrap font-medium">{date(row.dt_time_stamp_st)}</td>
            <td class="tabular-nums" style="color: var(--text-muted)">{row.sz_employee_no}</td>
            <td class="whitespace-nowrap font-semibold tabular-nums" class:line-through={isVoided(row)}>{money(row.n2_amount_price)}</td>
            <td class="tabular-nums" style="color: var(--text-muted)">{Number(row.discount_total) > 0 ? `-${money(row.discount_total)}` : "—"}</td>
            <td class="font-semibold" style="color: var(--text-muted)">#{row.n0_xact_no}</td>
            <td style="color: var(--text-muted)">{row.n0_tot_sold_item ?? "—"}</td>
            <td class="text-right">
              <Button
                color="alternative"
                class="ui-btn ui-btn--icon"
                title={$t("txn.view.aria")}
                aria-label={$t("txn.view.aria")}
                onclick={() => controller.inspect(encodeURIComponent(controller.transactionKey(row)))}
              >
                <EyeOutline class="h-5 w-5" />
              </Button>
            </td>
          </tr>
        {/each}
      </tbody>
      </table>
    </div>

  {:else}
    <p class="empty-state">{state.error || $t("txn.empty")}</p>
  {/if}

  <!-- Pagination footer -->
  <div class="panel-footer">
    <p class="text-sm" style="color: var(--text-subtle)">
      {#if state.loading}
        {$t("txn.pagination.showing", { range: "…", total: "…" })}
      {:else}
        {$t("txn.pagination.showing", {
          range: `${state.rows.length ? (state.page - 1) * 25 + 1 : 0}–${(state.page - 1) * 25 + state.rows.length}`,
          total: state.summary.total,
        })}
      {/if}
    </p>
    <div class="flex gap-2">
      <Button color="alternative" class="ui-btn ui-btn--icon" disabled={state.page === 1} aria-label={$t("txn.pagination.prev")} onclick={() => controller.setPage("prev")}><ChevronLeftOutline  class="h-5 w-5" /></Button>
      <Button color="alternative" class="ui-btn ui-btn--icon" disabled={!state.hasMore}   aria-label={$t("txn.pagination.next")} onclick={() => controller.setPage("next")}><ChevronRightOutline class="h-5 w-5" /></Button>
    </div>
  </div>
</div>
