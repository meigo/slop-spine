<script lang="ts">
  import { onMount } from "svelte";
  import { ui, isPaintTool, type BoneMode } from "../state/ui.svelte";
  import { document as doc, loadDocument } from "../state/doc.svelte";
  import { saveProject, loadProject } from "../persist/project-file";
  import { exportBundle, ExportError } from "../export/bundle";
  import { history, historyState } from "../state/history.svelte";
  import { pressureCurve } from "./draw-dispatch";
  import { createCurveEditor } from "../core/pressure-curve";
  import {
    Paintbrush,
    Eraser,
    PaintBucket,
    SquareDashed,
    Lasso,
    Bone,
    Plus,
    RotateCcw,
    Image,
    Grid3x3,
    Undo2,
    Redo2,
    Save,
    FolderOpen,
    Download,
    Maximize,
    Spline,
  } from "@lucide/svelte";

  let fileInput: HTMLInputElement | undefined = $state();

  // Svelte action: close the pressure-curve popup on a pointerdown outside `node`. Inlined here
  // rather than a shared module — Toolbar.svelte is the only place in this tree with a popup that
  // needs it, and this task's file scope is this component. Capture phase so it still fires if an
  // inner handler (e.g. the curve canvas's own pointerdown) stops propagation.
  function clickOutside(node: HTMLElement, onOutside: () => void) {
    let cb = onOutside;
    function handler(e: PointerEvent) {
      if (!node.contains(e.target as Node)) cb();
    }
    document.addEventListener("pointerdown", handler, true);
    return {
      update(next: () => void) {
        cb = next;
      },
      destroy() {
        document.removeEventListener("pointerdown", handler, true);
      },
    };
  }

  let curveOpen = $state(false);
  let curvePopupEl: HTMLDivElement | undefined = $state();
  let curveEditor: (HTMLElement & { redraw: () => void }) | null = null;

  onMount(() => {
    // No persisted-preference bump on change: this app doesn't persist the curve across reloads
    // (constraint), and the instance is mutated directly by createCurveEditor — draw-dispatch.ts
    // reads it live, so nothing else needs to react to the change.
    curveEditor = createCurveEditor(pressureCurve, () => {});
  });

  $effect(() => {
    if (curvePopupEl && curveEditor) curvePopupEl.appendChild(curveEditor);
  });

  // Keep the popup within the viewport: it's left-anchored to its trigger, but the toolbar wraps,
  // so the trigger can sit near the right (or left) edge. Shift it back into view. The popup is
  // position:fixed (see .curve-popup in app.css), anchored just below its trigger wrapper in
  // viewport coords, then clamped horizontally into view. Adapted from slop-animator's
  // ToolOptions.svelte.
  function positionPopup() {
    if (!curvePopupEl) return;
    const margin = 8;
    const anchor = curvePopupEl.parentElement?.getBoundingClientRect();
    if (!anchor) return;
    curvePopupEl.style.top = `${anchor.bottom + 4}px`;
    curvePopupEl.style.left = `${anchor.left}px`;
    const rect = curvePopupEl.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - margin);
    if (overflowRight > 0) curvePopupEl.style.left = `${anchor.left - overflowRight}px`;
    else if (anchor.left < margin) curvePopupEl.style.left = `${margin}px`;
  }

  $effect(() => {
    if (curveOpen) {
      curveEditor?.redraw();
      requestAnimationFrame(positionPopup);
    }
  });

  const BRUSH_VALUES = ["#000000", "#404040", "#808080", "#b0b0b0", "#e0e0e0", "#ffffff"];

  // Verbatim from slop-animator's Toolbar.svelte — the point of this task is that all three
  // apps agree on the button language.
  const toolBtn =
    "size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover";

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
      alert(e instanceof ExportError ? e.message : "Export failed.");
    }
  }

  function setBoneMode(mode: BoneMode) {
    ui.boneMode = ui.boneMode === mode ? "edit" : mode;
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

  // Bridge for Canvas.svelte's Cmd/Ctrl+S and Cmd/Ctrl+O keybindings — same window-event pattern
  // as Fit View above, since Save/Load's implementations (and the hidden file input) live here.
  onMount(() => {
    const onSaveRequest = () => onSave();
    const onLoadRequest = () => fileInput?.click();
    window.addEventListener("slop-spine:save", onSaveRequest);
    window.addEventListener("slop-spine:load", onLoadRequest);
    return () => {
      window.removeEventListener("slop-spine:save", onSaveRequest);
      window.removeEventListener("slop-spine:load", onLoadRequest);
    };
  });
</script>

<input type="file" accept=".zip" class="hidden" bind:this={fileInput} onchange={onFileChosen} />

<div class="flex flex-wrap items-center gap-2 border-b border-border bg-surface p-2 text-sm text-text">
  <div class="flex overflow-hidden rounded border border-border">
    <button class={toolBtn} title="Save" onclick={onSave}><Save size={18} /></button>
    <button class={toolBtn} title="Load" onclick={() => fileInput?.click()}
      ><FolderOpen size={18} /></button
    >
    <button class={toolBtn} title="Export" onclick={onExport}><Download size={18} /></button>
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class="{toolBtn} disabled:opacity-40 disabled:hover:bg-transparent"
      title={historyState.canUndo ? "Undo" : "Undo — nothing to undo"}
      disabled={!historyState.canUndo}
      onclick={() => history.undo()}
    >
      <Undo2 size={18} />
    </button>
    <button
      class="{toolBtn} disabled:opacity-40 disabled:hover:bg-transparent"
      title={historyState.canRedo ? "Redo" : "Redo — nothing to redo"}
      disabled={!historyState.canRedo}
      onclick={() => history.redo()}
    >
      <Redo2 size={18} />
    </button>
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button class={toolBtn} title="Fit View" onclick={onFitView}><Maximize size={18} /></button>
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class={toolBtn}
      class:bg-surface-active={ui.tool === "brush"}
      title="Brush (B)"
      onclick={() => (ui.tool = "brush")}><Paintbrush size={18} /></button
    >
    <button
      class={toolBtn}
      class:bg-surface-active={ui.tool === "eraser"}
      title="Eraser (E)"
      onclick={() => (ui.tool = "eraser")}><Eraser size={18} /></button
    >
    <button
      class={toolBtn}
      class:bg-surface-active={ui.tool === "fill"}
      title="Fill (G)"
      onclick={() => (ui.tool = "fill")}><PaintBucket size={18} /></button
    >
    <button
      class={toolBtn}
      class:bg-surface-active={ui.tool === "select"}
      title="Select (S)"
      onclick={() => (ui.tool = "select")}><SquareDashed size={18} /></button
    >
    <button
      class={toolBtn}
      class:bg-surface-active={ui.tool === "lasso"}
      title="Lasso (L)"
      onclick={() => (ui.tool = "lasso")}><Lasso size={18} /></button
    >
    <button
      class={toolBtn}
      class:bg-surface-active={ui.tool === "bone"}
      title="Bone (R)"
      onclick={() => (ui.tool = "bone")}><Bone size={18} /></button
    >
  </div>
  {#if ui.tool === "bone"}
    <div class="flex overflow-hidden rounded border border-border">
      <button
        class={toolBtn}
        class:bg-surface-active={ui.boneMode === "create"}
        title="Create bone (Shift-drag). Shift-click a shaft to insert a joint."
        onclick={() => setBoneMode("create")}><Plus size={18} /></button
      >
      <button
        class={toolBtn}
        class:bg-surface-active={ui.boneMode === "pose"}
        title="Pose (Alt-drag). Tip rotates, shaft translates."
        onclick={() => setBoneMode("pose")}><RotateCcw size={18} /></button
      >
    </div>
  {/if}
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class={toolBtn}
      class:bg-surface-active={ui.showDrawings}
      title={ui.showDrawings ? "Drawings visible — click to hide" : "Drawings hidden — click to show"}
      onclick={() => (ui.showDrawings = !ui.showDrawings)}
    >
      <Image size={18} />
    </button>
    <button
      class={toolBtn}
      class:bg-surface-active={ui.showBones}
      title={ui.showBones ? "Bones visible — click to hide" : "Bones hidden — click to show"}
      onclick={() => (ui.showBones = !ui.showBones)}
    >
      <Bone size={18} />
    </button>
    <button
      class={toolBtn}
      class:bg-surface-active={ui.showMeshes}
      title={ui.showMeshes ? "Meshes visible — click to hide" : "Meshes hidden — click to show"}
      onclick={() => (ui.showMeshes = !ui.showMeshes)}
    >
      <Grid3x3 size={18} />
    </button>
  </div>
  {#if isPaintTool(ui.tool)}
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
          class="h-6 w-6 {ui.brushValue === value ? 'ring-2 ring-inset ring-[var(--color-selection)]' : ''}"
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

    {#if ui.tool !== "fill"}
      <div class="relative" use:clickOutside={() => (curveOpen = false)}>
        <button
          class={toolBtn}
          class:bg-surface-active={curveOpen}
          title="Pressure curve"
          onclick={() => (curveOpen = !curveOpen)}
        >
          <Spline size={18} />
        </button>
        <div class="curve-popup" class:open={curveOpen} bind:this={curvePopupEl}></div>
      </div>
    {/if}
  {/if}
</div>
