<script lang="ts">
  import { onMount } from "svelte";
  import {
    ui,
    isPaintTool,
    isSelectTool,
    bumpCurve,
    whyNotEditable,
    editBlockLabel,
    type BoneMode,
  } from "../state/ui.svelte";
  import { document as doc, loadDocument, newDocument } from "../state/doc.svelte";
  import { saveProject, loadProject } from "../persist/project-file";
  import { importPsd } from "../persist/psd";
  import { clearAutosave } from "../persist/autosave";
  import NewDocDialog from "./NewDocDialog.svelte";
  import { exportBundle, ExportError } from "../export/bundle";
  import { history, historyState } from "../state/history.svelte";
  import { fillAllEnclosed } from "./draw-dispatch";
  import { clipboard } from "../state/clipboard.svelte";
  import { selectionCommands } from "../state/selection-commands";
  import { pressureCurve } from "../core/pressure-curve";
  import { MAX_GAP, clampGap } from "../core/fill-holes";
  import { createCurveEditor } from "../core/pressure-curve";
  import { clickOutside } from "./click-outside";
  import ToolbarMenu from "./ToolbarMenu.svelte";
  import {
    Paintbrush,
    Eraser,
    PaintBucket,
    SquareDashed,
    Lasso,
    Bone,
    Image,
    Grid3x3,
    Plus,
    RotateCcw,
    Undo2,
    Redo2,
    Spline,
    Copy,
    Scissors,
    ClipboardPaste,
    Trash2,
    MousePointerBan,
  } from "@lucide/svelte";

  let fileInput: HTMLInputElement | undefined = $state();
  let psdInput: HTMLInputElement | undefined = $state();
  let newDocOpen = $state(false);

  let curveOpen = $state(false);
  let curvePopupEl: HTMLDivElement | undefined = $state();
  let curveEditor: (HTMLElement & { redraw: () => void }) | null = null;

  onMount(() => {
    curveEditor = createCurveEditor(pressureCurve, bumpCurve);
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

  // Verbatim from slop-animator's Toolbar.svelte — the point of this task is that all three
  // apps agree on the button language.
  const toolBtn =
    "size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover";
  const menuItem =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-hover";

  // Pixel/select tools need a layer. Dim them when none is selected (on load, after delete),
  // still clickable so you can arm a tool before picking a layer — same as animator. Hidden is
  // a canvas refusal, not a toolbar dim: the layer IS selected.
  const selectedLayer = $derived(doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null);
  const editBlock = $derived(whyNotEditable(selectedLayer));
  const toolsDimmed = $derived(editBlock === "no-layer");
  const canPaint = $derived(editBlock === null);
  const pixelTitle = (name: string) =>
    toolsDimmed ? `${name} — ${editBlockLabel("no-layer")}` : name;

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onNewDocument(width: number, height: number) {
    newDocOpen = false;
    void clearAutosave();
    newDocument(width, height);
    window.dispatchEvent(new Event("slop-spine:fit-view"));
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
      window.dispatchEvent(new Event("slop-spine:fit-view"));
    } catch (err) {
      console.error("load failed", err);
      alert(err instanceof Error ? err.message : "Load failed.");
    }
  }

  async function onPsdChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const imported = importPsd(await file.arrayBuffer());
      loadDocument(imported);
      if (imported.layers.length)
        ui.selectedLayerId = imported.layers[imported.layers.length - 1].id;
      window.dispatchEvent(new Event("slop-spine:fit-view"));
    } catch (err) {
      console.error("psd import failed", err);
      alert(err instanceof Error ? err.message : "PSD import failed.");
    }
  }

  // Canvas.svelte owns the Viewport instance (created against its own anchor element in
  // onMount) and isn't in this task's file scope, so a plain window event is the smallest
  // bridge from this button to `viewport.fitView()` — see Canvas.svelte's matching listener.
  function onFitView() {
    window.dispatchEvent(new Event("slop-spine:fit-view"));
  }

  function onActualSize() {
    window.dispatchEvent(new Event("slop-spine:actual-size"));
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
<input type="file" accept=".psd" class="hidden" bind:this={psdInput} onchange={onPsdChosen} />
<NewDocDialog open={newDocOpen} onConfirm={onNewDocument} onCancel={() => (newDocOpen = false)} />

<div
  class="flex flex-wrap items-center gap-1 border-b border-border bg-surface p-2 text-sm text-text"
>
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class={toolBtn}
      class:opacity-40={toolsDimmed}
      class:bg-surface-active={ui.tool === "brush"}
      title={pixelTitle("Brush (B)")}
      onclick={() => (ui.tool = "brush")}><Paintbrush size={18} /></button
    >
    <button
      class={toolBtn}
      class:opacity-40={toolsDimmed}
      class:bg-surface-active={ui.tool === "eraser"}
      title={pixelTitle("Eraser (E)")}
      onclick={() => (ui.tool = "eraser")}><Eraser size={18} /></button
    >
    <button
      class={toolBtn}
      class:opacity-40={toolsDimmed}
      class:bg-surface-active={ui.tool === "fill"}
      title={pixelTitle("Fill (G)")}
      onclick={() => (ui.tool = "fill")}><PaintBucket size={18} /></button
    >
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class={toolBtn}
      class:opacity-40={toolsDimmed}
      class:bg-surface-active={ui.tool === "select"}
      title={pixelTitle("Select (S)")}
      onclick={() => (ui.tool = "select")}><SquareDashed size={18} /></button
    >
    <button
      class={toolBtn}
      class:opacity-40={toolsDimmed}
      class:bg-surface-active={ui.tool === "lasso"}
      title={pixelTitle("Lasso (L)")}
      onclick={() => (ui.tool = "lasso")}><Lasso size={18} /></button
    >
  </div>
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class={toolBtn}
      class:bg-surface-active={ui.tool === "bone"}
      title="Bone (R)"
      onclick={() => (ui.tool = "bone")}><Bone size={18} /></button
    >
  </div>
  <!-- Visibility toggles. These live in the toolbar rather than only under View because they are
       switched constantly while rigging; the View menu keeps matching entries for discoverability. -->
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class={toolBtn}
      class:bg-surface-active={ui.showDrawings}
      title={ui.showDrawings
        ? "Drawings visible — click to hide"
        : "Drawings hidden — click to show"}
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
  {#snippet colorPicker()}
    <input type="color" class="color-well" title="Color" bind:value={ui.brushValue} />
  {/snippet}

  {#if isSelectTool(ui.tool)}
    <!-- Select subtools. The commands live in Canvas (it owns the marquee, the layer contexts and
         the undo bracket) and are reached through the selectionCommands registry. Disabled states
         mirror the canvas's own refusals: copy needs a marquee, everything that writes also needs
         an editable layer, paste needs something in the pixel clipboard. -->
    {@const canCopy = ui.selectionActive && canPaint}
    {@const canPaste = clipboard.hasPixels && canPaint}
    {@const why = editBlock
      ? ` — ${editBlockLabel(editBlock)}`
      : ui.selectionActive
        ? ""
        : " — select something first"}
    <div class="flex overflow-hidden rounded border border-border">
      <button
        class="{toolBtn} aria-disabled:cursor-default aria-disabled:opacity-40"
        title="Copy (Cmd/Ctrl+C){why}"
        aria-disabled={!canCopy}
        onclick={() => {
          if (canCopy) selectionCommands.copy?.();
        }}><Copy size={18} /></button
      >
      <button
        class="{toolBtn} aria-disabled:cursor-default aria-disabled:opacity-40"
        title="Cut (Cmd/Ctrl+X){why}"
        aria-disabled={!canCopy}
        onclick={() => {
          if (canCopy) selectionCommands.cut?.();
        }}><Scissors size={18} /></button
      >
      <button
        class="{toolBtn} aria-disabled:cursor-default aria-disabled:opacity-40"
        title={"Paste (Cmd/Ctrl+V)" +
          (editBlock
            ? ` — ${editBlockLabel(editBlock)}`
            : clipboard.hasPixels
              ? ""
              : " — nothing copied yet")}
        aria-disabled={!canPaste}
        onclick={() => {
          if (canPaste) selectionCommands.paste?.();
        }}><ClipboardPaste size={18} /></button
      >
      <button
        class="{toolBtn} aria-disabled:cursor-default aria-disabled:opacity-40"
        title="Delete (Del){why}"
        aria-disabled={!canCopy}
        onclick={() => {
          if (canCopy) selectionCommands.del?.();
        }}><Trash2 size={18} /></button
      >
      <button
        class="{toolBtn} aria-disabled:cursor-default aria-disabled:opacity-40"
        title="Deselect (Esc){ui.selectionActive ? '' : ' — nothing selected'}"
        aria-disabled={!ui.selectionActive}
        onclick={() => {
          if (ui.selectionActive) selectionCommands.deselect?.();
        }}><MousePointerBan size={18} /></button
      >
    </div>
  {/if}
  {#if ui.tool === "fill"}
    {@render colorPicker()}
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Fill color tolerance">
      Tolerance
      <input type="range" min="0" max="128" class="w-24" bind:value={ui.fillTolerance} />
      <span class="w-6 text-right font-mono">{ui.fillTolerance}</span>
    </label>
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Grow the filled region (px)"
    >
      Expand
      <input type="range" min="0" max="8" class="w-16" bind:value={ui.fillExpand} />
      <span class="w-4 text-right font-mono">{ui.fillExpand}</span>
    </label>
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Bridge breaks in the outline before filling, up to about twice this many pixels"
    >
      Gap
      <input
        type="range"
        min="0"
        max={MAX_GAP}
        class="w-16"
        value={ui.fillGap}
        oninput={(e) => (ui.fillGap = clampGap((e.currentTarget as HTMLInputElement).value))}
      />
      <span class="w-4 text-right font-mono">{ui.fillGap}</span>
    </label>
    <label class="flex items-center gap-1">
      Opacity
      <input type="range" min="1" max="100" bind:value={ui.brushOpacity} />
      <span class="w-8 text-right font-mono text-xs">{ui.brushOpacity}</span>
    </label>
    <button
      class="h-7 rounded border border-border px-2 text-xs text-text-secondary hover:bg-surface-hover hover:text-text aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-surface"
      title={editBlock
        ? `Fill enclosed — ${editBlockLabel(editBlock)}`
        : "Fill every area enclosed by the outline, behind the strokes"}
      aria-disabled={!canPaint}
      onclick={() => {
        if (canPaint) fillAllEnclosed();
      }}
    >
      Fill enclosed
    </button>
  {:else if isPaintTool(ui.tool)}
    <div class="flex overflow-hidden rounded border border-border">
      <button
        class="px-3 py-1 {ui.brushType === 'smooth'
          ? 'bg-surface-active'
          : 'hover:bg-surface-hover'}"
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
        class="px-3 py-1 {ui.brushType === 'pencil'
          ? 'bg-surface-active'
          : 'hover:bg-surface-hover'}"
        onclick={() => (ui.brushType = "pencil")}
      >
        Pencil
      </button>
    </div>

    {#if ui.tool !== "eraser"}
      {@render colorPicker()}
    {/if}

    <label class="flex items-center gap-1">
      Size
      <input type="range" min="1" max="64" bind:value={ui.brushSize} />
      <span class="w-6 text-right font-mono text-xs">{ui.brushSize}</span>
    </label>

    <label class="flex items-center gap-1" title="How much pen pressure widens the stroke">
      Press
      <input
        type="range"
        min="1"
        max="8"
        step="0.5"
        value={ui.tool === "eraser" ? ui.eraserPress : ui.brushPress}
        oninput={(e) => {
          const v = Number((e.currentTarget as HTMLInputElement).value);
          if (ui.tool === "eraser") ui.eraserPress = v;
          else ui.brushPress = v;
        }}
      />
      <span class="w-6 text-right font-mono text-xs"
        >{ui.tool === "eraser" ? ui.eraserPress : ui.brushPress}×</span
      >
    </label>

    <label class="flex items-center gap-1">
      Opacity
      <input type="range" min="1" max="100" bind:value={ui.brushOpacity} />
      <span class="w-8 text-right font-mono text-xs">{ui.brushOpacity}</span>
    </label>

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

  <div class="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-1">
    <ToolbarMenu label="File">
      {#snippet children(close)}
        <button
          class={menuItem}
          onclick={() => {
            newDocOpen = true;
            close();
          }}>New…</button
        >
        <button
          class={menuItem}
          onclick={() => {
            fileInput?.click();
            close();
          }}>Open…</button
        >
        <button
          class={menuItem}
          onclick={() => {
            psdInput?.click();
            close();
          }}>Import PSD…</button
        >
        <!-- The no-keyboard path (iPad): Cmd/Ctrl+V covers the desktop case. Canvas owns the
             clipboard read because it also owns addLayer's follow-up (select the new layer,
             recomposite). -->
        <button
          class={menuItem}
          onclick={() => {
            window.dispatchEvent(new Event("slop-spine:paste-image"));
            close();
          }}>Paste image as layer</button
        >
        <button
          class={menuItem}
          onclick={() => {
            void onSave();
            close();
          }}>Save</button
        >
        <button
          class={menuItem}
          onclick={() => {
            void onExport();
            close();
          }}>Export Spine…</button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="View">
      {#snippet children(close)}
        <button
          class={menuItem}
          onclick={() => {
            onFitView();
            close();
          }}>Fit to view</button
        >
        <button
          class={menuItem}
          onclick={() => {
            onActualSize();
            close();
          }}>100%</button
        >
        <button
          class={menuItem}
          onclick={() => {
            ui.showDrawings = !ui.showDrawings;
            close();
          }}>{ui.showDrawings ? "Hide drawings" : "Show drawings"}</button
        >
        <button
          class={menuItem}
          onclick={() => {
            ui.showBones = !ui.showBones;
            close();
          }}>{ui.showBones ? "Hide bones" : "Show bones"}</button
        >
        <button
          class={menuItem}
          onclick={() => {
            ui.showMeshes = !ui.showMeshes;
            close();
          }}>{ui.showMeshes ? "Hide meshes" : "Show meshes"}</button
        >
        <button
          class={menuItem}
          onclick={() => {
            ui.whiteBg = !ui.whiteBg;
            close();
          }}>{ui.whiteBg ? "Checkerboard page" : "White page"}</button
        >
      {/snippet}
    </ToolbarMenu>
  </div>
</div>
