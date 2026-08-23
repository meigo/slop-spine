<script lang="ts">
  import {
    document as doc,
    addLayer,
    removeLayer,
    reorderLayer,
    renameLayer,
    toggleVisible,
    duplicateLayer,
    markLayerDirty,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import type { Layer } from "../rig/document";
  import { pixelCommand } from "../core/history";
  import { history } from "../state/history.svelte";
  import { onMount } from "svelte";
  import Sortable from "sortablejs";
  import { Plus, Trash2, Eye, EyeOff, GripVertical, Copy, Eraser } from "@lucide/svelte";

  // Panel shows the topmost layer first; the document array is bottom-to-top (index 0 = bottom).
  let topFirst = $derived([...doc.layers].reverse());
  let selected = $derived(doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null);

  let editingId = $state<number | null>(null);
  let draftName = $state("");
  let listEl: HTMLElement | undefined = $state();
  // Bumped after a Sortable drop so {#key} rebuilds the list from state. Sortable relocates
  // evt.item in the DOM; without this the {#each} teardown can leave a duplicate row.
  let dragNonce = $state(0);

  const headerBtn =
    "size-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent";

  function onAdd() {
    const id = addLayer(`Layer ${doc.layers.length + 1}`);
    ui.selectedLayerId = id;
    ui.selectedBone = null;
  }

  function onSelect(layer: Layer) {
    ui.selectedLayerId = layer.id;
    ui.selectedBone = null;
  }

  function onDuplicate() {
    if (ui.selectedLayerId == null) return;
    const id = duplicateLayer(ui.selectedLayerId);
    if (id != null) {
      ui.selectedLayerId = id;
      ui.selectedBone = null;
    }
  }

  function onRemove() {
    if (ui.selectedLayerId == null) return;
    const id = ui.selectedLayerId;
    removeLayer(id);
    ui.selectedLayerId = null;
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

  onMount(() => {
    if (!listEl) return;
    const sortable = Sortable.create(listEl, {
      handle: ".layer-drag-handle",
      animation: 150,
      // Pointer fallback, not HTML5 DnD: native drag shows the macOS green-plus copy
      // cursor instead of sliding rows. Animator gets the live swap from Sortable's
      // animation; this keeps that without the browser ghost.
      forceFallback: true,
      onEnd(evt) {
        if (evt.oldIndex == null || evt.newIndex == null || evt.oldIndex === evt.newIndex) return;
        const id = Number((evt.item as HTMLElement).dataset.layerId);
        if (!Number.isFinite(id)) return;
        // Visual list is top-first; document.layers is bottom-first.
        const toIndex = doc.layers.length - 1 - evt.newIndex;
        reorderLayer(id, toIndex);
        evt.item.remove();
        dragNonce++;
      },
    });
    return () => sortable.destroy();
  });

  /** Clears the selected layer to fully transparent (`clearRect`, never a white fill — export
   *  trims a layer to its opaque bounding box, so an opaque "clear" would trim to the full page
   *  and destroy the atlas). */
  function onClear() {
    if (ui.selectedLayerId == null) return;
    const id = ui.selectedLayerId;
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

<div class="flex flex-col h-full bg-surface text-sm text-text">
  <div class="flex items-center gap-1 border-b border-border p-1">
    <span class="flex-1 px-1 font-mono text-xs uppercase text-text-secondary">Layers</span>
    <button class={headerBtn} title="Add layer" onclick={onAdd}><Plus size={16} /></button>
    <button
      class={headerBtn}
      title="Duplicate selected layer"
      disabled={selected == null}
      onclick={onDuplicate}><Copy size={16} /></button
    >
    <button
      class={headerBtn}
      title="Clear selected layer"
      disabled={selected == null}
      onclick={onClear}><Eraser size={16} /></button
    >
    <button
      class={headerBtn}
      title="Delete selected layer"
      disabled={selected == null}
      onclick={onRemove}><Trash2 size={16} /></button
    >
  </div>
  <ul bind:this={listEl} class="flex-1 overflow-y-auto">
    {#key dragNonce}
    {#each topFirst as layer (layer.id)}
      <li
        data-layer-id={layer.id}
        class="flex items-center gap-1 border-b border-border-light px-2 py-1 {ui.selectedLayerId === layer.id
          ? 'bg-surface-active'
          : 'hover:bg-surface-hover'}"
      >
        <span class="layer-drag-handle shrink-0 cursor-grab text-text-muted" title="Drag to reorder">
          <GripVertical size={14} />
        </span>
        <button
          class="flex w-5 shrink-0 items-center justify-center text-text-secondary hover:text-text"
          onclick={() => toggleVisible(layer.id)}
          title={layer.visible ? "Visible — click to hide" : "Hidden — click to show"}
        >
          {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
        </button>
        {#if editingId === layer.id}
          <input
            class="min-w-0 flex-1 bg-canvas-bg px-1 text-text"
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
      </li>
    {/each}
    {/key}
  </ul>
</div>
