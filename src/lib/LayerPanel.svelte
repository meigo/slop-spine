<script lang="ts">
  import {
    document as doc,
    addLayer,
    removeLayer,
    reorderLayer,
    renameLayer,
    toggleVisible,
    setLayerOpacity,
    markLayerDirty,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import type { Layer } from "../rig/document";
  import { pixelCommand } from "../core/history";
  import { history } from "../state/history.svelte";

  // Panel shows the topmost layer first; the document array is bottom-to-top (index 0 = bottom).
  let topFirst = $derived([...doc.layers].reverse());

  let editingId = $state<number | null>(null);
  let draftName = $state("");
  let draggedId: number | null = null;

  function onAdd() {
    const id = addLayer(`Layer ${doc.layers.length + 1}`);
    ui.selectedLayerId = id;
  }

  function onSelect(layer: Layer) {
    ui.selectedLayerId = layer.id;
  }

  function onRemove(id: number) {
    removeLayer(id);
    if (ui.selectedLayerId === id) ui.selectedLayerId = null;
  }

  function startRename(layer: Layer) {
    editingId = layer.id;
    draftName = layer.name;
  }
  function commitRename() {
    if (editingId !== null) renameLayer(editingId, draftName || "Layer");
    editingId = null;
  }
  function onRenameKey(e: KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") editingId = null;
  }

  function onDragStart(id: number) {
    draggedId = id;
  }
  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function onDrop(targetId: number) {
    if (draggedId === null || draggedId === targetId) return;
    const toIndex = doc.layers.findIndex((l) => l.id === targetId);
    if (toIndex !== -1) reorderLayer(draggedId, toIndex);
    draggedId = null;
  }

  function onOpacityInput(id: number, e: Event) {
    const percent = Number((e.currentTarget as HTMLInputElement).value);
    setLayerOpacity(id, percent / 100);
  }

  /** Clears the layer to fully transparent (`clearRect`, never a white fill — export trims a
   *  layer to its opaque bounding box, so an opaque "clear" would trim to the full page and
   *  destroy the atlas). Pushes an undo command via the same `pixelCommand` primitive
   *  draw-dispatch.ts's pushPixelCommand wraps, since that helper itself is private to
   *  draw-dispatch.ts's closure and out of this task's file scope. */
  function onClear(id: number) {
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    const ctx = layer.canvas.getContext("2d");
    if (!ctx) return;
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    const before = ctx.getImageData(0, 0, w, h);
    ctx.clearRect(0, 0, w, h);
    markLayerDirty(id);
    const after = ctx.getImageData(0, 0, w, h);
    history.push(
      pixelCommand(
        () => {
          ctx.putImageData(before, 0, 0);
          markLayerDirty(id);
        },
        () => {
          ctx.putImageData(after, 0, 0);
          markLayerDirty(id);
        },
        before,
        after,
      ),
    );
  }
</script>

<div class="flex w-56 flex-col border-l border-neutral-800 bg-neutral-900 text-sm text-neutral-200">
  <div class="flex items-center justify-between border-b border-neutral-800 p-2">
    <span class="font-mono text-xs uppercase text-neutral-400">Layers</span>
    <button class="rounded bg-neutral-700 px-2 py-0.5 hover:bg-neutral-600" onclick={onAdd}>+ Add</button>
  </div>
  <ul class="flex-1 overflow-y-auto">
    {#each topFirst as layer (layer.id)}
      <li
        draggable="true"
        ondragstart={() => onDragStart(layer.id)}
        ondragover={onDragOver}
        ondrop={() => onDrop(layer.id)}
        class="flex flex-col gap-1 border-b border-neutral-800 px-2 py-1 {ui.selectedLayerId === layer.id
          ? 'bg-neutral-700'
          : 'hover:bg-neutral-800'}"
      >
        <div class="flex items-center gap-2">
          <button
            class="w-5 shrink-0 text-center"
            onclick={() => toggleVisible(layer.id)}
            title="Toggle visibility"
          >
            {layer.visible ? "●" : "○"}
          </button>
          {#if editingId === layer.id}
            <input
              class="min-w-0 flex-1 bg-neutral-950 px-1 text-neutral-200"
              bind:value={draftName}
              onblur={commitRename}
              onkeydown={onRenameKey}
            />
          {:else}
            <button
              class="min-w-0 flex-1 truncate text-left"
              onclick={() => onSelect(layer)}
              ondblclick={() => startRename(layer)}
            >
              {layer.name}
            </button>
          {/if}
          <button
            class="shrink-0 text-neutral-500 hover:text-neutral-200"
            onclick={() => onRemove(layer.id)}
            title="Remove layer"
          >
            ✕
          </button>
        </div>
        <div class="flex items-center gap-1 pl-7 text-xs text-neutral-400">
          <span>Opacity</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(layer.opacity * 100)}
            oninput={(e) => onOpacityInput(layer.id, e)}
            class="min-w-0 flex-1"
          />
          <span class="w-8 text-right font-mono">{Math.round(layer.opacity * 100)}</span>
          <button
            class="shrink-0 text-neutral-500 hover:text-neutral-200"
            onclick={() => onClear(layer.id)}
            title="Clear layer to transparent"
          >
            Clear
          </button>
        </div>
      </li>
    {/each}
  </ul>
</div>
