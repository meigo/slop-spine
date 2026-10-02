<script lang="ts">
  import { Link, Unlink } from "@lucide/svelte";
  import { document as doc } from "../state/doc.svelte";
  import { linkedSize, MAX_DOC_PX } from "../core/resize";

  /** "canvas": crop or extend around the anchor (moves nothing); "scale": resize the drawing. */
  export type ResizeMode = "canvas" | "scale";

  let {
    open = false,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: (
      width: number,
      height: number,
      anchorX: number,
      anchorY: number,
      mode: ResizeMode,
    ) => void;
    onCancel: () => void;
  } = $props();

  let width = $state(doc.canvas.width);
  let height = $state(doc.canvas.height);
  let anchorX = $state(0.5);
  let anchorY = $state(0.5);
  let mode = $state<ResizeMode>("canvas");
  /** Keep the document's width : height while typing one side (2026-10-02). Kept between
   *  openings this session; off at first. Always on in Scale mode: scaling the drawing unevenly
   *  would stretch it and skew the rig, so Scale is uniform; Crop / extend can change one side. */
  let lockedChoice = $state(false);
  const locked = $derived(mode === "scale" || lockedChoice);

  // Reset values when dialog opens
  $effect(() => {
    if (open) {
      width = doc.canvas.width;
      height = doc.canvas.height;
      anchorX = 0.5;
      anchorY = 0.5;
    }
  });

  function onWidthInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (locked && Number.isFinite(v)) height = linkedSize(v, doc.canvas.width, doc.canvas.height);
  }
  function onHeightInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (locked && Number.isFinite(v)) width = linkedSize(v, doc.canvas.height, doc.canvas.width);
  }
  function toggleLock() {
    lockedChoice = !lockedChoice;
    // Locking takes the ratio from the document: bring the height in line with the width.
    if (locked) height = linkedSize(width, doc.canvas.width, doc.canvas.height);
  }
  function setMode(m: ResizeMode) {
    mode = m;
    if (locked) height = linkedSize(width, doc.canvas.width, doc.canvas.height);
  }

  const anchors: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
    { x: 0.5, y: 1 },
    { x: 1, y: 1 },
  ];

  function confirm() {
    const w = Math.max(16, Math.min(MAX_DOC_PX, Math.round(width)));
    const h = Math.max(16, Math.min(MAX_DOC_PX, Math.round(height)));
    onConfirm(w, h, anchorX, anchorY, mode);
  }

  function onWindowKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      confirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }
</script>

<!-- On the window, not the backdrop: the backdrop never has focus, so its keydown never fired.
     Guarded by `open` so a closed dialog doesn't swallow the app's shortcuts. -->
<svelte:window onkeydown={onWindowKey} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onpointerdown={(e: PointerEvent) => {
      if (e.target === e.currentTarget) onCancel();
    }}
  >
    <div class="flex w-80 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xl">
      <h2 class="text-sm font-semibold text-text">Resize</h2>

      <!-- Scale the drawing with the page, or change the page around the drawing. -->
      <div class="flex gap-px rounded-md border border-border p-px text-xs">
        <button
          class="h-7 flex-1 rounded {mode === 'scale'
            ? 'ui-on'
            : 'text-text-secondary hover:bg-surface-hover'}"
          aria-pressed={mode === "scale"}
          title="Scale the drawing and its rig to the new size — bones, reach and mesh density scale with it; the ratio is kept"
          onclick={() => setMode("scale")}>Scale drawing</button
        >
        <button
          class="h-7 flex-1 rounded {mode === 'canvas'
            ? 'ui-on'
            : 'text-text-secondary hover:bg-surface-hover'}"
          aria-pressed={mode === "canvas"}
          title="Change the canvas around the drawing — crops or adds space at the anchor; the drawing and its bones keep their size"
          onclick={() => setMode("canvas")}>Crop / extend</button
        >
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-[11px] text-text-muted"
          >Current: {doc.canvas.width} x {doc.canvas.height}</span
        >
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Width
          <input
            type="number"
            min="16"
            max="8192"
            bind:value={width}
            oninput={onWidthInput}
            class="h-7 flex-1 rounded border border-border bg-surface px-2 text-xs text-text"
            onkeydown={(e: KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== "Escape") e.stopPropagation();
            }}
          />
          <span class="text-text-muted">px</span>
        </label>
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Height
          <input
            type="number"
            min="16"
            max="8192"
            bind:value={height}
            oninput={onHeightInput}
            class="h-7 flex-1 rounded border border-border bg-surface px-2 text-xs text-text"
            onkeydown={(e: KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== "Escape") e.stopPropagation();
            }}
          />
          <span class="text-text-muted">px</span>
        </label>
        <button
          class="flex h-7 w-fit items-center gap-1.5 rounded border px-2 text-xs disabled:opacity-60 {locked
            ? 'ui-on'
            : 'border-border text-text-secondary hover:bg-surface-hover'}"
          aria-pressed={locked}
          disabled={mode === "scale"}
          title={mode === "scale"
            ? "Scaling always keeps the ratio, so the drawing and its rig aren't stretched"
            : locked
              ? "Ratio locked — typing one side sets the other; tap to unlock"
              : "Lock the ratio: keep the document's width to height while typing one side"}
          onclick={toggleLock}
        >
          {#if locked}<Link size={14} />{:else}<Unlink size={14} />{/if}
          Keep ratio
        </button>
      </div>

      <!-- Dimmed, not removed, in Scale mode, so nothing moves: scaling keeps the whole drawing. -->
      <div
        class="flex flex-col gap-1.5 {mode === 'scale' ? 'pointer-events-none opacity-40' : ''}"
        aria-disabled={mode === "scale"}
        title={mode === "scale"
          ? "Anchor — not used when scaling: the whole drawing scales with the page"
          : "Anchor — where the drawing stays when the canvas is cropped or extended"}
      >
        <span class="text-[11px] text-text-muted">Anchor</span>
        <div class="grid w-16 grid-cols-3 gap-1">
          {#each anchors as a (`${a.x},${a.y}`)}
            <button
              aria-label="Anchor {a.x},{a.y}"
              class="size-4 rounded-sm border transition-colors
                     {anchorX === a.x && anchorY === a.y
                ? 'ui-on border-accent'
                : 'border-border bg-surface-hover hover:border-text-muted'}"
              onclick={() => {
                anchorX = a.x;
                anchorY = a.y;
              }}
            ></button>
          {/each}
        </div>
      </div>

      <p class="text-[11px] text-warn">
        This clears the undo history. The Spine export's origin stays at the canvas centre, so a
        resize that isn't centred moves the character in skeleton space.
      </p>

      <div class="flex justify-end gap-2 pt-1">
        <button
          class="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
          onclick={onCancel}>Cancel</button
        >
        <button
          class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90"
          onclick={confirm}>Resize</button
        >
      </div>
    </div>
  </div>
{/if}
