<script lang="ts">
  import {
    document as doc,
    addLayer,
    removeLayer,
    reorderLayer,
    renameLayer,
    toggleVisible,
    toggleAlphaLock,
    duplicateLayer,
    setLayerOpacity,
    clearLayerPixels,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import type { Layer } from "../rig/document";
  import { onMount } from "svelte";
  import Sortable from "sortablejs";
  import { isDoubleTap, type Tap } from "./double-tap";
  import { sliderFill } from "./slider-fill";
  import {
    Plus,
    Trash2,
    Eye,
    EyeOff,
    GripVertical,
    Copy,
    Eraser,
    Grid2x2,
    Blend,
    Pencil,
  } from "@lucide/svelte";

  // Panel shows the topmost layer first; the document array is bottom-to-top (index 0 = bottom).
  let topFirst = $derived([...doc.layers].reverse());
  let selected = $derived(doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null);

  let editingId = $state<number | null>(null);
  let draftName = $state("");
  let listEl: HTMLElement | undefined = $state();
  // Bumped after a Sortable drop so {#key} rebuilds the list from state. Sortable relocates
  // evt.item in the DOM; without this the {#each} teardown can leave a duplicate row.
  let dragNonce = $state(0);

  // 28px list actions, borderless, as slop-paint's header. aria-disabled (not `disabled`) so the
  // status bar can still read the reason off the title.
  const headerBtn =
    "flex size-7 cursor-pointer items-center justify-center rounded text-text-secondary hover:bg-surface-hover aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";
  // Every row toggle gets a real 20px box, as slop-paint's.
  const rowBtn = "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded";

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
    if (editingId !== null) renameLayer(editingId, draftName.trim() || "Layer");
    editingId = null;
  }
  function onRenameKey(e: KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") editingId = null;
    e.stopPropagation();
  }

  // Double-tap renames too: iPad doesn't fire dblclick reliably (lib/double-tap.ts).
  let lastTap: Tap | null = null;
  function onNamePointerDown(e: PointerEvent, layer: Layer) {
    const tap: Tap = { target: `layer:${layer.id}`, t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (isDoubleTap(lastTap, tap)) {
      e.preventDefault();
      lastTap = null;
      startRename(layer);
      return;
    }
    lastTap = tap;
  }

  /** Svelte action: draw a layer's pixels into its thumbnail. Re-runs when the revision (bumped on
   *  every pixel change) moves. */
  function thumbnail(node: HTMLCanvasElement, arg: { canvas: HTMLCanvasElement; rev: number }) {
    let src = arg.canvas;
    const draw = () => {
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, node.width, node.height);
      // Letterboxed, so a wide page doesn't squash into the square.
      const k = Math.min(node.width / src.width, node.height / src.height);
      const w = src.width * k;
      const h = src.height * k;
      ctx.drawImage(src, (node.width - w) / 2, (node.height - h) / 2, w, h);
    };
    draw();
    return {
      update(next: { canvas: HTMLCanvasElement; rev: number }) {
        src = next.canvas;
        draw();
      },
    };
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

  function onClear() {
    if (ui.selectedLayerId != null) clearLayerPixels(ui.selectedLayerId);
  }
</script>

<div class="flex h-full flex-col bg-surface text-sm text-text">
  <!-- h-10: the tool-options row's height, as slop-paint's header. Grouped create │ clear │
       destroy, so a mis-tap on Clear can't delete. -->
  <div
    class="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface-bar px-2.5 text-xs font-semibold text-text-secondary"
  >
    <span>Layers</span>
    <div class="flex items-center gap-1">
      <button class={headerBtn} title="Add layer" onclick={onAdd}><Plus size={16} /></button>
      <button
        class={headerBtn}
        title={selected ? "Duplicate layer" : "Duplicate — select a layer first"}
        aria-disabled={selected == null}
        onclick={onDuplicate}><Copy size={16} /></button
      >
      <span class="-mx-0.5 h-5 w-px shrink-0 bg-border" role="presentation"></span>
      <button
        class={headerBtn}
        title={selected ? "Clear layer" : "Clear — select a layer first"}
        aria-disabled={selected == null}
        onclick={onClear}><Eraser size={16} /></button
      >
      <span class="-mx-0.5 h-5 w-px shrink-0 bg-border" role="presentation"></span>
      <button
        class={headerBtn}
        title={selected ? "Delete layer" : "Delete — select a layer first"}
        aria-disabled={selected == null}
        onclick={onRemove}><Trash2 size={16} /></button
      >
    </div>
  </div>
  <!-- Properties strip for the selected layer, as slop-paint's: ONE compact row, fixed height so
       the list never shifts. Opacity is a preview only: export ignores it by design (see
       setLayerOpacity), which is what makes a dimmed tracing layer safe — hide it before export. -->
  <div
    class="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface pr-[6px] pl-2.5 text-text-secondary"
  >
    {#if selected}
      {@const pct = Math.round(selected.opacity * 100)}
      <span
        class="flex shrink-0 items-center gap-1"
        title="Opacity of the selected layer — editor preview only, never exported"
      >
        <Blend size={13} class="shrink-0" />
        <input
          type="range"
          class="w-20"
          min="0"
          max="100"
          style={sliderFill(pct, 0, 100)}
          value={pct}
          oninput={(e) => setLayerOpacity(selected.id, Number(e.currentTarget.value) / 100)}
        />
        <span class="w-6 text-[11px] text-text-muted">{pct}</span>
      </span>
      <span class="flex-1"></span>
      <button
        class="{rowBtn} text-text-secondary hover:text-text"
        title="Rename the selected layer"
        onclick={() => startRename(selected)}><Pencil size={13} /></button
      >
    {:else}
      <span class="text-[11px] text-text-muted">No layer selected</span>
    {/if}
  </div>
  <ul bind:this={listEl} class="flex-1 overflow-y-auto">
    {#key dragNonce}
      {#each topFirst as layer (layer.id)}
        <!-- ONE line, as slop-paint's: identity on the left (grip, thumbnail, name), state on the
             right in fixed 20px columns (alpha lock, eye) so it lines up across rows. -->
        <li
          data-layer-id={layer.id}
          class="flex min-w-0 cursor-pointer items-center gap-1 border-b border-border-light py-1 pr-[6px] pl-2 text-sm transition-colors hover:bg-surface-hover {ui.selectedLayerId ===
          layer.id
            ? 'ui-selected text-text'
            : 'text-text-secondary'}"
          title="Tap to draw on this layer · double-tap the name to rename"
          onclick={() => onSelect(layer)}
          role="presentation"
        >
          <span
            class="layer-drag-handle shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
            title="Drag to reorder"
          >
            <GripVertical size={14} />
          </span>
          <!-- 20px, drawn at 40 so it stays sharp on a retina screen. -->
          <canvas
            class="thumb-checkerboard size-5 shrink-0 rounded-sm border border-border"
            width="40"
            height="40"
            use:thumbnail={{ canvas: layer.canvas, rev: layer.revision }}
          ></canvas>
          {#if editingId === layer.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="layer-rename-input"
              bind:value={draftName}
              autofocus
              onblur={commitRename}
              onkeydown={onRenameKey}
              onclick={(e) => e.stopPropagation()}
              onpointerdown={(e) => e.stopPropagation()}
            />
          {:else}
            <span
              class="min-w-0 flex-1 truncate"
              ondblclick={(e) => {
                e.stopPropagation();
                startRename(layer);
              }}
              onpointerdown={(e) => onNamePointerDown(e, layer)}
              role="presentation">{layer.name}</span
            >
          {/if}
          <!-- Alpha lock ("lock transparency") is the checkerboard glyph, fainter when off, as
               slop-paint and slop-animator. -->
          <button
            class="{rowBtn} {layer.alphaLock
              ? 'text-accent'
              : 'text-text-muted/50 hover:text-text'}"
            aria-pressed={!!layer.alphaLock}
            title={layer.alphaLock
              ? "Alpha lock on — paint lands only on existing pixels; click to turn off"
              : "Alpha lock off — click to paint only over existing pixels"}
            onclick={(e) => {
              e.stopPropagation();
              toggleAlphaLock(layer.id);
            }}><Grid2x2 size={15} /></button
          >
          <button
            class="{rowBtn} {layer.visible ? 'text-text-muted hover:text-text' : 'text-warn'}"
            title={layer.visible ? "Visible — click to hide" : "Hidden — click to show"}
            onclick={(e) => {
              e.stopPropagation();
              toggleVisible(layer.id);
            }}
          >
            {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
          </button>
        </li>
      {/each}
    {/key}
  </ul>
</div>
