<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import Drawer from "flowbite-svelte/Drawer.svelte";
  import Skeleton from "flowbite-svelte/Skeleton.svelte";
  import TabItem from "flowbite-svelte/TabItem.svelte";
  import Tabs from "flowbite-svelte/Tabs.svelte";
  import { fmt, t } from "../i18n";
  import type { ExplorerController, ExplorerState } from "../main";

  export let state: ExplorerState;
  export let controller: ExplorerController;

  const text  = (value: unknown) => String(value ?? "—");
  const cell  = (row: Record<string, unknown>, key: string) => text(row[key]);

  // Column tuples hold [dataKey, i18nKey]; the label is translated at render.
  const itemColumns: [string, string][] = [
    ["sz_description", "detail.col.description"],
    ["n0_quantity",    "detail.col.qty"],
    ["n2_ext_price",   "detail.col.lineAmount"],
  ];

  $: money = $fmt.money;
  $: date  = $fmt.date;
  $: details  = state.details;
  $: sections = details ? [
    { title: "detail.section.items",     rows: details.items,     columns: itemColumns,                                                                                                  currency: ["n2_ext_price"]    },
    { title: "detail.section.payments",  rows: details.tenders,   columns: [["sz_description","detail.col.method"],     ["n2_amount","detail.col.amount"],    ["sz_auth_number","detail.col.auth"]], currency: ["n2_amount"]       },
    { title: "detail.section.discounts", rows: details.discounts, columns: [["sz_description","detail.col.description"],["n0_perc_off","detail.col.rate"],    ["n2_disc_amount","detail.col.amount"]], currency: ["n2_disc_amount"]  },
    { title: "detail.section.tax",       rows: details.vat,       columns: [["n0_tax_code","detail.col.taxCode"],      ["n3_vat_percentage","detail.col.rate"],["n2_vat_amount","detail.col.taxAmount"]], currency: ["n2_vat_amount"]   },
  ] : [];
</script>

{#if state.selected}
  <Drawer
    open={true}
    placement="right"
    onclose={() => controller.closeDrawer()}
    class="w-full max-w-[680px] p-0 detail-drawer border-l"
    aria-label="Transaction detail"
  >
    <!-- Sticky header -->
    <header
      class="sticky top-0 z-10 flex items-start justify-between px-6 py-5"
      style="background: var(--panel); border-bottom: 1px solid var(--border);"
    >
      <div>
        <p class="text-[0.8125rem] font-semibold uppercase tracking-wide" style="color: var(--text-subtle)">{$t("detail.eyebrow")}</p>
        <h2 class="mt-1 text-2xl font-semibold" style="color: var(--text)">#{state.selected.n0_xact_no}</h2>
        <p class="mt-0.5 text-base" style="color: var(--text-muted)">
          {$t("detail.meta", { store: state.selected.n0_unique_str_no, terminal: state.selected.n0_terminal_no, date: date(state.selected.dt_time_stamp_st) })}
        </p>
      </div>
      <Button color="alternative" class="ui-btn" onclick={() => controller.closeDrawer()} aria-label={$t("detail.closeAria")}>{$t("detail.close")}</Button>
    </header>

    <!-- Content -->
    <div class="p-6">
      {#if state.detailError}
        <p class="py-12 text-center text-base" style="color: var(--danger)">{$t("detail.error")}</p>

      {:else if !details}
        <Skeleton />

      {:else}
        <Tabs tabStyle="underline">
          <TabItem open title={$t("detail.tab.receipt")}>
            <pre
              id="receipt"
              class="whitespace-pre-wrap rounded-lg p-5 font-mono text-base leading-relaxed"
              style="background: var(--panel-alt); border: 1px solid var(--border); color: var(--text);"
            >{details.receipt.map((line) => text(line.val).replace(/''/g, "'")).join("\n") || $t("detail.receipt.empty")}</pre>
          </TabItem>

          <TabItem title={$t("detail.tab.detail")}>
            <div class="space-y-6">
              <!-- Summary row -->
              <div
                class="grid grid-cols-2 gap-3 py-4"
                style="border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);"
              >
                <div>
                  <p class="text-sm" style="color: var(--text-subtle)">{$t("detail.summary.total")}</p>
                  <p class="mt-1 text-xl font-semibold" style="color: var(--text)">{money(state.selected.n2_amount_price)}</p>
                </div>
                <div>
                  <p class="text-sm" style="color: var(--text-subtle)">{$t("detail.summary.operator")}</p>
                  <p class="mt-1 text-xl font-semibold" style="color: var(--text)">{state.selected.sz_employee_no}</p>
                </div>
              </div>

              <!-- Detail sections -->
              {#each sections as section}
                <section>
                  <h3 class="mb-2 text-base font-bold" style="color: var(--text)">{$t(section.title)}</h3>
                  <div
                    class="overflow-x-auto"
                    style="border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);"
                  >
                    <table class="min-w-full text-base">
                      <thead style="background: var(--panel-alt); text-align: left;">
                        <tr>
                          {#each section.columns as column}
                            <th class="px-4 py-3 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-subtle)">{$t(column[1])}</th>
                          {/each}
                        </tr>
                      </thead>
                      <tbody>
                        {#each section.rows as row}
                          <tr style="border-top: 1px solid var(--border);">
                            {#each section.columns as column}
                              <td class="px-4 py-3.5" style="color: var(--text)">{section.currency.includes(column[0]) ? money(row[column[0]]) : cell(row, column[0])}</td>
                            {/each}
                          </tr>
                        {:else}
                          <tr>
                            <td colspan={section.columns.length} class="px-4 py-4" style="color: var(--text-subtle)">{$t("detail.noRecords")}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </section>
              {/each}
            </div>
          </TabItem>
        </Tabs>
      {/if}
    </div>
  </Drawer>
{/if}
