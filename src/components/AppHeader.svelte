<script lang="ts">
  import Button from "flowbite-svelte/Button.svelte";
  import ButtonGroup from "flowbite-svelte/ButtonGroup.svelte";

  type ExplorerView = "transactions" | "exceptions";

  export let activeView: ExplorerView = "transactions";
  export let onViewChange: (view: ExplorerView) => void;

  function selectView(view: ExplorerView) {
    if (view !== activeView) onViewChange(view);
  }
</script>

<header class="app-titlebar sticky top-0 z-30 flex min-h-14 w-full items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 text-slate-200 shadow-md">
  <div class="titlebar-primary flex min-w-0 items-center gap-3">
    <div class="brand-mark flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-sm font-bold text-white" aria-hidden="true">SE</div>
    <span class="font-display text-sm font-semibold text-white">Sales Explorer</span>
  </div>

  <nav class="titlebar-nav ml-auto" aria-label="Explorer views">
    <ButtonGroup size="sm" class="inline-flex rounded-md shadow-none">
      <Button
        id="transactions-tab"
        color={activeView === "transactions" ? "blue" : "dark"}
        class="border-slate-700 focus:ring-blue-500"
        aria-pressed={activeView === "transactions"}
        title="Browse and inspect sale transactions"
        onclick={() => selectView("transactions")}
      >
        Transactions
      </Button>
      <Button
        id="exceptions-tab"
        color={activeView === "exceptions" ? "blue" : "dark"}
        class="border-slate-700 focus:ring-blue-500"
        aria-pressed={activeView === "exceptions"}
        title="Review high-risk transactions"
        onclick={() => selectView("exceptions")}
      >
        Exceptions
      </Button>
    </ButtonGroup>
  </nav>
</header>
