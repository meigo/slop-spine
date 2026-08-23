<script lang="ts">
  import { ui } from "../state/ui.svelte";
  import { document as doc, loadDocument } from "../state/doc.svelte";
  import { saveProject, loadProject } from "../persist/project-file";
  import { exportBundle } from "../export/bundle";
  import { history, historyState } from "../state/history.svelte";

  let fileInput: HTMLInputElement | undefined = $state();

  const BRUSH_VALUES = ["#000000", "#404040", "#808080", "#b0b0b0", "#e0e0e0", "#ffffff"];

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onSave() {
    try {
      downloadBlob(await saveProject(doc), "project.zip");
    } catch (e) {
      console.error("save failed", e);
    }
  }

  async function onExport() {
    try {
      downloadBlob(await exportBundle(doc), "character.zip");
    } catch (e) {
      console.error("export failed", e);
    }
  }

  async function onFileChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      loadDocument(await loadProject(file));
    } catch (err) {
      console.error("load failed", err);
    }
  }

  // Canvas.svelte owns the Viewport instance (created against its own anchor element in
  // onMount) and isn't in this task's file scope, so a plain window event is the smallest
  // bridge from this button to `viewport.fitView()` — see Canvas.svelte's matching listener.
  function onFitView() {
    window.dispatchEvent(new Event("slop-spine:fit-view"));
  }
</script>

<input type="file" accept=".zip" class="hidden" bind:this={fileInput} onchange={onFileChosen} />

<div class="flex flex-wrap items-center gap-2 border-b border-border bg-surface p-2 text-sm text-text">
  <div class="flex overflow-hidden rounded border border-border">
    <button class="px-3 py-1 hover:bg-surface-hover" onclick={onSave}>Save</button>
    <button class="px-3 py-1 hover:bg-surface-hover" onclick={() => fileInput?.click()}>Load</button>
    <button class="px-3 py-1 hover:bg-surface-hover" onclick={onExport}>Export</button>
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class="px-3 py-1 hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={!historyState.canUndo}
      onclick={() => history.undo()}
    >
      Undo
    </button>
    <button
      class="px-3 py-1 hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={!historyState.canRedo}
      onclick={() => history.redo()}
    >
      Redo
    </button>
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button class="px-3 py-1 hover:bg-surface-hover" onclick={onFitView}>Fit View</button>
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class="px-3 py-1 {ui.mode === 'draw' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
      onclick={() => (ui.mode = "draw")}
    >
      Draw
    </button>
    <button
      class="px-3 py-1 {ui.mode === 'rig' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
      onclick={() => (ui.mode = "rig")}
    >
      Rig
    </button>
  </div>
  {#if ui.mode === "draw"}
    <div class="flex overflow-hidden rounded border border-border">
      <button
        class="px-3 py-1 {ui.tool === 'brush' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
        onclick={() => (ui.tool = "brush")}
      >
        Brush
      </button>
      <button
        class="px-3 py-1 {ui.tool === 'eraser' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
        onclick={() => (ui.tool = "eraser")}
      >
        Eraser
      </button>
      <button
        class="px-3 py-1 {ui.tool === 'fill' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
        onclick={() => (ui.tool = "fill")}
      >
        Fill
      </button>
    </div>

    <div class="flex overflow-hidden rounded border border-border">
      <button
        class="px-3 py-1 {ui.brushType === 'smooth' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
        onclick={() => (ui.brushType = "smooth")}
      >
        Smooth
      </button>
      <button
        class="px-3 py-1 {ui.brushType === 'ink' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
        onclick={() => (ui.brushType = "ink")}
      >
        Ink
      </button>
      <button
        class="px-3 py-1 {ui.brushType === 'pencil' ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
        onclick={() => (ui.brushType = "pencil")}
      >
        Pencil
      </button>
    </div>

    <div class="flex overflow-hidden rounded border border-border">
      {#each BRUSH_VALUES as value (value)}
        <button
          class="h-6 w-6 {ui.brushValue === value ? 'ring-2 ring-inset ring-blue-400' : ''}"
          style="background-color: {value};"
          aria-label="Value {value}"
          onclick={() => (ui.brushValue = value)}
        ></button>
      {/each}
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
