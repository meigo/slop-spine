<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerPanel from "./lib/LayerPanel.svelte";
  import RigPanel from "./lib/RigPanel.svelte";
  import { ui } from "./state/ui.svelte";
</script>

<main class="flex h-dvh w-dvw flex-col bg-neutral-900 text-neutral-200">
  <Toolbar />
  <div class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1">
      <Canvas />
    </div>
    {#if ui.mode === "rig"}
      <RigPanel />
    {:else}
      <LayerPanel />
    {/if}
  </div>
</main>
