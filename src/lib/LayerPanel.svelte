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
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import type { Layer } from "../rig/document";
  import { autoScrollStep, ghostTop, pastThreshold, slideOffsets } from "./layer-drag-visual";
  import { dropTarget, type Drop, type RowBox } from "./layer-drop";
  import { isDoubleTap, type Tap } from "./double-tap";
  import { sliderFill } from "./slider-fill";
  import { clearSelectedLayer } from "./draw-dispatch";
  import { selectionCommands } from "../state/selection-commands";
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
  /** A press on a grip; `live` once it has travelled past the threshold and become a drag. Rows,
   *  the grab offset, the row height and the content height are measured then, once
   *  (SLOP-LAYER-DRAG.md rule 1): sliding rows must not move the targets they are measured
   *  against. */
  let dragging: {
    id: number;
    pointerId: number;
    row: HTMLElement;
    startX: number;
    startY: number;
    clientY: number;
    live: boolean;
    boxes: RowBox[];
    grab: number;
    rowPx: number;
    contentHeight: number;
  } | null = null;
  let drop = $state<Drop | null>(null);
  /** The floating copy of the grabbed row, in content coordinates. */
  let ghost = $state.raw<{ top: number; layer: Layer; height: number } | null>(null);
  /** How far each row slides: the dragged row's place to the drop slot, the rows passed close up. */
  let shifted = $state.raw<Map<number, number>>(new Map());
  let scrollFrame = 0;

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
    // A lifted selection's pixels aren't in the layer yet: bake them, or the copy gets the hole.
    selectionCommands.applyFloat?.();
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

  // Row drag (2026-10-01, SLOP-LAYER-DRAG.md): pointer events on the grip, drawn over the pure
  // `dropTarget`; nothing moves a DOM node, and the document changes once, on drop, through
  // `reorderLayer`. Replaces SortableJS, whose DOM moves needed a {#key} remount after each drop.

  /** Every row, in the list's content coordinates. */
  function rows(): RowBox[] {
    if (!listEl) return [];
    const off = listEl.scrollTop - listEl.getBoundingClientRect().top;
    return [...listEl.querySelectorAll<HTMLElement>("[data-layer-id]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: Number(el.dataset.layerId), top: r.top + off, bottom: r.bottom + off };
    });
  }

  function startDrag(e: PointerEvent, id: number) {
    if (e.button !== 0) return;
    const row = (e.currentTarget as Element | null)?.closest<HTMLElement>("[data-layer-id]");
    if (!row) return;
    e.preventDefault();
    try {
      if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; moves still arrive while the pointer stays on the grip.
    }
    dragging = {
      id,
      pointerId: e.pointerId,
      row,
      startX: e.clientX,
      startY: e.clientY,
      clientY: e.clientY,
      live: false,
      boxes: [],
      grab: 0,
      rowPx: 0,
      contentHeight: 0,
    };
    drop = null;
  }

  /** The press became a drag: measure once, lift the copy and start the edge scroll. */
  function lift(d: NonNullable<typeof dragging>) {
    const layer = doc.layers.find((l) => l.id === d.id);
    if (!listEl || !layer) return;
    d.live = true;
    d.boxes = rows();
    const r = d.row.getBoundingClientRect();
    d.grab = d.startY - r.top;
    d.rowPx = r.height;
    d.contentHeight = listEl.scrollHeight;
    ghost = { top: 0, layer, height: r.height };
    document.documentElement.classList.add("layer-dragging");
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  function update(d: NonNullable<typeof dragging>) {
    if (!listEl || !ghost) return;
    const y = d.clientY - listEl.getBoundingClientRect().top + listEl.scrollTop;
    drop = dropTarget(d.boxes, y, d.id);
    shifted = slideOffsets(d.boxes, d.id, drop ? d.boxes.length - 1 - drop.index : null);
    ghost = { ...ghost, top: ghostTop(y, d.grab, d.contentHeight, d.rowPx) };
    document.documentElement.classList.toggle("layer-drop-refused", drop === null);
  }

  /** Near the list's top or bottom edge, scroll it — once a frame while the drag lasts. */
  function edgeScroll() {
    const d = dragging;
    if (!d) return;
    if (!listEl) return finishDrag();
    const view = listEl.getBoundingClientRect();
    const step = autoScrollStep(d.clientY, view.top, view.bottom);
    const max = Math.max(d.contentHeight - listEl.clientHeight, 0);
    const next = Math.min(Math.max(listEl.scrollTop + step, 0), max);
    if (next !== listEl.scrollTop) {
      listEl.scrollTop = next;
      update(d);
    }
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  // The cursor classes sit on <html>, outside this component: never leave them behind.
  $effect(() => () => finishDrag());

  /** Puts everything back as it was before the press. */
  function finishDrag() {
    cancelAnimationFrame(scrollFrame);
    dragging = null;
    drop = null;
    ghost = null;
    shifted = new Map();
    document.documentElement.classList.remove("layer-dragging", "layer-drop-refused");
  }

  function moveDrag(e: PointerEvent) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    if (!d.live) {
      if (!pastThreshold(e.clientX - d.startX, e.clientY - d.startY)) return;
      lift(d);
    }
    update(d);
  }

  function endDrag(e: PointerEvent, apply: boolean) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    // A press that never became a drag lands nothing.
    if (apply && d.live) update(d);
    const target = apply && d.live ? drop : null;
    const id = d.id;
    // Clear the slides and their transition in the same tick as the commit, or the re-ordered
    // rows animate back from the gap (rule 3).
    finishDrag();
    if (target) reorderLayer(id, target.index);
  }

  const slide = (id: number) => {
    const dy = ghost ? shifted.get(id) : undefined;
    return dy ? `translateY(${dy}px)` : null;
  };
  const slideTransition = $derived(ghost ? "transform 150ms ease" : null);
</script>

<svelte:window
  onkeydowncapture={(e) => {
    // Capture phase, so the app's own Escape doesn't also run (rule 6).
    if (e.key !== "Escape" || !dragging) return;
    finishDrag();
    e.preventDefault();
    e.stopPropagation();
  }}
/>

<div class="flex h-full flex-col bg-surface text-sm text-text">
  <!-- h-10: the tool-options row's height, as slop-paint's header. Grouped create │ clear │
       destroy, so a mis-tap on Clear can't delete. -->
  <div
    class="flex h-10 shrink-0 items-center justify-between border-b border-border px-2.5 text-xs font-semibold text-text-secondary"
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
        onclick={clearSelectedLayer}><Eraser size={16} /></button
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
  <!-- The scroller is `relative` so the dragged row's floating copy sits in its content. -->
  <div bind:this={listEl} class="relative min-h-0 flex-1 overflow-y-auto">
    <ul>
      {#each topFirst as layer (layer.id)}
        <!-- ONE line, as slop-paint's: identity on the left (grip, thumbnail, name), state on the
             right in fixed 20px columns (alpha lock, eye) so it lines up across rows. -->
        <li
          data-layer-id={layer.id}
          class="flex min-w-0 cursor-pointer items-center gap-1 border-b border-border-light py-1 pr-[6px] pl-2 text-sm transition-colors hover:bg-surface-hover {ui.selectedLayerId ===
          layer.id
            ? 'ui-selected text-text'
            : 'text-text-secondary'} {ghost?.layer.id === layer.id ? 'opacity-40' : ''}"
          style:transform={slide(layer.id)}
          style:transition={slideTransition}
          title="Tap to draw on this layer · double-tap the name to rename"
          onclick={() => onSelect(layer)}
          role="presentation"
        >
          <span
            class="shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
            style="touch-action: none"
            title="Drag to reorder"
            role="presentation"
            onpointerdown={(e) => startDrag(e, layer.id)}
            onpointermove={moveDrag}
            onpointerup={(e) => endDrag(e, true)}
            onpointercancel={(e) => endDrag(e, false)}
            onlostpointercapture={(e) => endDrag(e, false)}
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
    </ul>
    {#if ghost}
      <!-- The grabbed row, following the pointer. -->
      <div
        data-drag-ghost
        class="pointer-events-none absolute inset-x-0 z-10 flex items-center gap-1 border-y border-accent bg-surface-raised pr-[6px] pl-2 text-sm text-text shadow-lg"
        style="top: {ghost.top}px; height: {ghost.height}px"
      >
        <span class="shrink-0 text-text-muted"><GripVertical size={14} /></span>
        <canvas
          class="thumb-checkerboard size-5 shrink-0 rounded-sm border border-border"
          width="40"
          height="40"
          use:thumbnail={{ canvas: ghost.layer.canvas, rev: ghost.layer.revision }}
        ></canvas>
        <span class="min-w-0 flex-1 truncate">{ghost.layer.name}</span>
      </div>
    {/if}
  </div>
</div>
