<script lang="ts">
  import { onMount } from "svelte";
  import AppHeader from "./components/AppHeader.svelte";
  import Explorer from "./components/Explorer.svelte";
  import { createSalesExplorer, type View } from "./main";

  let explorer: ReturnType<typeof createSalesExplorer> | null = null;
  let activeView: View = "transactions";
  let revision = 0;

  onMount(() => {
    explorer = createSalesExplorer(() => {
      if (explorer) activeView = explorer.state.view;
      revision += 1;
    });
    explorer.init();

    return () => explorer?.destroy();
  });

  function changeView(view: View) {
    explorer?.setView(view);
  }
</script>

<svelte:window onkeydown={(event) => explorer?.onKeydown(event)} />

<AppHeader {activeView} onViewChange={changeView} />

{#if explorer}
  <Explorer state={explorer.state} controller={explorer} {revision} />
{/if}