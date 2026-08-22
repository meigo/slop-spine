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
  {#if ui.mode === "draw"}
    <div class="flex overflow-hidden rounded border border-neutral-700">
      <button
        class="px-3 py-1 {ui.tool === 'brush' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
        onclick={() => (ui.tool = "brush")}
      >
        Brush
      </button>
      <button
        class="px-3 py-1 {ui.tool === 'eraser' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
        onclick={() => (ui.tool = "eraser")}
      >
        Eraser
      </button>
      <button
        class="px-3 py-1 {ui.tool === 'fill' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
        onclick={() => (ui.tool = "fill")}
      >
        Fill
      </button>
    </div>

    <div class="flex overflow-hidden rounded border border-neutral-700">
      <button
        class="px-3 py-1 {ui.brushType === 'smooth' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
        onclick={() => (ui.brushType = "smooth")}
      >
        Smooth
      </button>
      <button
        class="px-3 py-1 {ui.brushType === 'ink' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
        onclick={() => (ui.brushType = "ink")}
      >
        Ink
      </button>
      <button
        class="px-3 py-1 {ui.brushType === 'pencil' ? 'bg-neutral-700' : 'hover:bg-neutral-800'}"
        onclick={() => (ui.brushType = "pencil")}
      >
        Pencil
      </button>
    </div>

    <label class="flex items-center gap-1">
      Size
      <input type="range" min="1" max="64" bind:value={ui.brushSize} />
      <span class="w-6 text-right font-mono text-xs">{ui.brushSize}</span>
    </label>

    <label class="flex items-center gap-1">
      Opacity
      <input type="range" min="1" max="100" bind:value={ui.brushOpacity} />
      <span class="w-8 text-right font-mono text-xs">{ui.brushOpacity}</span>
    </label>
  {/if}
</div>
