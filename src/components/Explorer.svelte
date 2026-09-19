<script lang="ts">
  import type { ExplorerController, ExplorerState } from "../main";
  import DetailDrawer from "./DetailDrawer.svelte";
  import ExceptionsView from "./ExceptionsView.svelte";
  import FilterToolbar from "./FilterToolbar.svelte";
  import TransactionsView from "./TransactionsView.svelte";

  export let state: ExplorerState;
  export let controller: ExplorerController;
  export let revision = 0;

  $: if (revision >= 0) state = state;
</script>

<FilterToolbar {state} {controller} />

<div class="app-content">
  <main class="mx-auto max-w-[1500px] px-5 py-7 md:px-8">
    {#if state.view === "transactions"}
      <TransactionsView {state} {controller} />
    {:else}
      <ExceptionsView {state} {controller} />
    {/if}
  </main>
</div>

<DetailDrawer {state} {controller} />