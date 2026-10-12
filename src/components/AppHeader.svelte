<script lang="ts">
  import { t } from "../i18n";

  type ExplorerView = "transactions" | "exceptions";

  export let activeView: ExplorerView = "transactions";
  export let onViewChange: (view: ExplorerView) => void;
  export let onRefresh: () => void = () => {};
  export let loading: boolean = false;

  const tabs: { view: ExplorerView; labelKey: string }[] = [
    { view: "transactions", labelKey: "header.tab.transactions" },
    { view: "exceptions",   labelKey: "header.tab.exceptions"   },
  ];

  function selectView(view: ExplorerView) {
    if (view !== activeView) onViewChange(view);
  }
</script>

<header class="app-header">
  <div class="header-brand">
    <span class="header-icon">SE</span>
    <span class="header-title">{$t("app.brand")}</span>
  </div>

  <nav class="header-nav" aria-label="Explorer views">
    {#each tabs as tab}
      <button
        class="header-tab"
        class:header-tab--active={activeView === tab.view}
        aria-pressed={activeView === tab.view}
        title={$t(tab.labelKey)}
        onclick={() => selectView(tab.view)}
      >
        {$t(tab.labelKey)}
        {#if activeView === tab.view}
          <span class="header-tab-bar" aria-hidden="true"></span>
        {/if}
      </button>
    {/each}

    <div class="header-separator" aria-hidden="true"></div>

    <div class="header-actions">
      <button
        class="header-action"
        class:is-busy={loading}
        title={$t("header.refresh")}
        aria-label={$t("header.refresh")}
        disabled={loading}
        onclick={() => onRefresh()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
    </div>
  </nav>
</header>
