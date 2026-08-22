<script lang="ts">
  import { ui } from "../state/ui.svelte";
</script>

<div class="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-200">
  <div class="flex overflow-hidden rounded border border-neutral-700">
    <button
      class="px-3 py-1 {ui.mode === 'draw' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
      onclick={() => (ui.mode = "draw")}
    >
      Draw
    </button>
    <button
      class="px-3 py-1 {ui.mode === 'rig' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
      onclick={() => (ui.mode = "rig")}
    >
      Rig
    </button>
  </div>
  <!-- Task 9 adds the draw-mode tool buttons here. -->
</div>
