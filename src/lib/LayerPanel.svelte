<script lang="ts">
  import { document as doc, addLayer, removeLayer, reorderLayer, renameLayer, toggleVisible } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import type { Layer } from "../rig/document";

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
        class="flex items-center gap-2 border-b border-neutral-800 px-2 py-1 {ui.selectedLayerId === layer.id
          ? 'bg-neutral-700'
          : 'hover:bg-neutral-800'}"
      >
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
      </li>
    {/each}
  </ul>
</div>
