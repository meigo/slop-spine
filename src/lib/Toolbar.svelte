<script lang="ts">
  import { onMount } from "svelte";
  import {
    ui,
    isPaintTool,
    isSelectTool,
    bumpCurve,
    whyNotEditable,
    editBlockLabel,
    slotFor,
    setTool,
    flashStatus,
    pressureCurves,
    SIZE_MIN,
    SIZE_MAX,
    SIZE_PRESETS,
    type Tool,
    type BrushType,
  } from "../state/ui.svelte";
  import {
    document as doc,
    loadDocument,
    newDocument,
    deleteBone,
    dissolveBone,
  } from "../state/doc.svelte";
  import { saveProject, loadProject } from "../persist/project-file";
  import { importPsd } from "../persist/psd";
  import { clearAutosave } from "../persist/autosave";
  import NewDocDialog from "./NewDocDialog.svelte";
  import ShareReadyDialog from "./ShareReadyDialog.svelte";
  import { canShareFile, isStandalone, saveToFilesAvailable, shareFile } from "./share";
  import { downloadBlob } from "./download";
  import ColorSwatch from "./ColorSwatch.svelte";
  import { exportBundle, ExportError } from "../export/bundle";
  import { history, historyState } from "../state/history.svelte";
  import { clearSelectedLayer, fillAllEnclosed } from "./draw-dispatch";
  import { clipboard } from "../state/clipboard.svelte";
  import { selectionCommands } from "../state/selection-commands";
  import { createCurveEditor } from "../core/pressure-curve";
  import { MAX_GAP, clampGap } from "../core/fill-holes";
  import { MAX_NIB_FLATNESS } from "../core/calligraphy-brush";
  import { PRESS_MAX, PRESS_MIN } from "../core/brush";
  import { clickOutside } from "./click-outside";
  import { sliderFill } from "./slider-fill";
  import ToolbarMenu from "./ToolbarMenu.svelte";
  import {
    Paintbrush,
    Eraser,
    PaintBucket,
    Pipette,
    BoxSelect,
    Lasso,
    Bone,
    PersonStanding,
    Image,
    Grid3x3,
    Plus,
    RotateCcw,
    MousePointer2,
    FoldVertical,
    Undo2,
    Redo2,
    Settings,
    SendToBack,
    Copy,
    Scissors,
    ClipboardPaste,
    Trash2,
    SquareX,
    Scan,
    Move,
    SquareDashed,
    Check,
    X,
  } from "@lucide/svelte";

  let fileInput: HTMLInputElement | undefined = $state();
  let psdInput: HTMLInputElement | undefined = $state();
  let newDocOpen = $state(false);

  // Pixel/select tools need a layer. Dim them when none is selected (on load, after delete),
  // still clickable so you can arm a tool before picking a layer — same as animator. Hidden is
  // a canvas refusal, not a toolbar dim: the layer IS selected.
  const selectedLayer = $derived(doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null);
  const editBlock = $derived(whyNotEditable(selectedLayer));
  const toolsDimmed = $derived(editBlock === "no-layer");
  const canPaint = $derived(editBlock === null);

  // The active stroke tool's own settings (the eraser's, or the brush's for every other tool).
  const slot = $derived(ui.stroke[slotFor(ui.tool)]);

  // --- Class strings, as slop-paint's Toolbar. ---
  const toolBtn =
    "flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors";
  const toolIdle = "border-border bg-surface text-text-secondary hover:bg-surface-hover";
  const iconBtnClass =
    "size-9 shrink-0 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover transition-colors";
  const iconBtn =
    "flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors";
  const iconIdle = "border-border bg-surface text-text-secondary hover:bg-surface-hover";
  const menuItem =
    "w-full text-left px-3 py-1.5 text-sm whitespace-nowrap text-text-secondary hover:bg-surface-hover flex items-center justify-between gap-6";
  const kbd = "text-[11px] text-text-muted";
  // aria-disabled, not `disabled`: a disabled button dispatches no pointer events, so the status
  // bar's hint could never read its title — and on iPad the hint is the only explanation.
  const dimmable =
    "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";
  const sliderLabel = "flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary";
  const readout = "min-w-7 text-[11px] text-text-muted";
  const divider = "h-6 w-px shrink-0 bg-border";
  const rowCls = "flex items-center gap-2 text-xs text-text-secondary";
  const labelCls = "w-20 shrink-0";
  const valueCls = "w-10 shrink-0 text-right text-[11px] text-text-muted";

  // Spine's families stay apart — paint │ select │ rig — each a run of one radio.
  const toolGroups: {
    tool: Tool;
    icon: typeof Paintbrush;
    title: string;
    needsLayer: boolean;
  }[][] = [
    [
      { tool: "brush", icon: Paintbrush, title: "Brush (B)", needsLayer: true },
      { tool: "eraser", icon: Eraser, title: "Eraser (E)", needsLayer: true },
      { tool: "fill", icon: PaintBucket, title: "Fill (G)", needsLayer: true },
      {
        tool: "eyedropper",
        icon: Pipette,
        title: "Eyedropper (I) — drag to aim, release to pick",
        needsLayer: false,
      },
    ],
    [
      { tool: "select", icon: BoxSelect, title: "Rect select (S)", needsLayer: true },
      { tool: "lasso", icon: Lasso, title: "Lasso (L)", needsLayer: true },
    ],
    [
      // A figure, not a bone glyph: the "show bones" toggle beside it is the bone, and the figure
      // says "the thing you are rigging".
      {
        tool: "bone",
        icon: PersonStanding,
        title: "Rig (R) — edit the skeleton",
        needsLayer: false,
      },
    ],
  ];

  function onNewDocument(width: number, height: number) {
    newDocOpen = false;
    void clearAutosave();
    newDocument(width, height);
    window.dispatchEvent(new Event("slop-spine:fit-view"));
  }

  async function onSave() {
    try {
      const blob = await saveProject(doc);
      // The Home Screen app can't download at all: Save goes to the share sheet there.
      if (saveToFilesAvailable() && isStandalone())
        await sendToFiles(new File([blob], "project.zip", { type: blob.type }));
      else downloadBlob(blob, "project.zip");
    } catch (e) {
      console.error("save failed", e);
      flashStatus("Save failed.");
    }
  }

  async function onExport() {
    try {
      const blob = await exportBundle(doc);
      // iPad: to the share sheet (Save to Files) — a download lands in Downloads in the browser,
      // and does nothing at all in the Home Screen app.
      if (saveToFilesAvailable())
        await sendToFiles(new File([blob], "character.zip", { type: blob.type }));
      else downloadBlob(blob, "character.zip");
    } catch (e) {
      console.error("export failed", e);
      flashStatus(e instanceof ExportError ? e.message : "Export failed.", 8000);
    }
  }

  // --- Save to Files (iPad/iPhone) ---
  // A web page can only put a file where the user chooses via the share sheet: Safari has no save
  // picker, and a download always lands in Downloads as a new copy. (As slop-paint.)
  let shareFileReady = $state<File | null>(null);

  /** Hand a finished file to the share sheet. Used on iPad by Export, and by Save in the Home
   *  Screen app. */
  async function sendToFiles(file: File) {
    if (!canShareFile(file)) {
      // This browser won't share the file type: fall back to a download.
      downloadBlob(file, file.name);
      flashStatus(`Downloaded ${file.name}`);
      return;
    }
    // Try to ride the tap that started this. Building the zip can outlast Safari's idea of a
    // "recent" tap, and then the sheet is refused — the dialog gives it a fresh one.
    const r = await shareFile(file);
    if (r.outcome === "shared") {
      flashStatus(`Sent ${file.name} to the share sheet`);
      return;
    }
    if (r.outcome === "dismissed") {
      flashStatus("Not saved — the share sheet was closed");
      return;
    }
    shareFileReady = file;
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
      flashStatus(err instanceof Error ? err.message : "Load failed.", 8000);
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
      flashStatus(err instanceof Error ? err.message : "PSD import failed.", 8000);
    }
  }

  // Canvas.svelte owns the Viewport, so a window event is the smallest bridge to it.
  function onFitView() {
    window.dispatchEvent(new Event("slop-spine:fit-view"));
  }

  function onActualSize() {
    window.dispatchEvent(new Event("slop-spine:actual-size"));
  }

  /** Edit ▸ Paste: the pixel clipboard as a float, else an image from the system clipboard as a
   *  new layer — the same fall-through Cmd/Ctrl+V has. */
  function onPaste() {
    if (clipboard.hasPixels && canPaint && selectionCommands.paste?.()) return;
    window.dispatchEvent(new Event("slop-spine:paste-image"));
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

  // --- Brush settings popover: set-once options and the active tool's pressure curve. ---
  let settingsOpen = $state(false);
  let curveHostEl = $state<HTMLDivElement | null>(null);
  let curveEditors: Record<"brush" | "eraser", HTMLElement & { redraw: () => void }> | null = null;

  // Brush and eraser have their own curve, so there is an editor per tool. The host only exists
  // while the popover is open, so attach the active tool's editor whenever either changes.
  $effect(() => {
    if (!curveHostEl) return;
    curveEditors ??= {
      brush: createCurveEditor(pressureCurves.brush, bumpCurve),
      eraser: createCurveEditor(pressureCurves.eraser, bumpCurve),
    };
    const editor = curveEditors[slotFor(ui.tool)];
    // The host is empty in the markup, so Svelte owns none of what this swaps.
    // eslint-disable-next-line svelte/no-dom-manipulating
    curveHostEl.replaceChildren(editor);
    editor.redraw();
  });

  // --- Size: slider, click-to-type readout, presets. ---
  // Below 960px (iPad portrait) only these show, so the brush row fits on one line at 834px (as
  // slop-paint cd14268).
  const narrowPresets = new Set<number>([1, 3, 8, 20, 80]);
  let editingSize = $state(false);
  let sizeInputValue = $state("");

  function startEditSize() {
    sizeInputValue = String(slot.size);
    editingSize = true;
  }

  function commitSize() {
    const v = parseFloat(sizeInputValue);
    if (!isNaN(v) && v >= SIZE_MIN && v <= SIZE_MAX) slot.size = Math.round(v * 2) / 2;
    editingSize = false;
  }

  // --- Selection row state. ---
  const hasMarquee = $derived(ui.selectionState === "selected");
  const floating = $derived(
    ui.selectionState === "transforming" || ui.selectionState === "warping",
  );
  const warping = $derived(ui.selectionState === "warping");
  const isDistort = $derived(ui.warpRows === 2 && ui.warpCols === 2);
  const canCopy = $derived(hasMarquee && canPaint);
  const canPaste = $derived(clipboard.hasPixels && canPaint);
  const whyNoCopy = $derived(
    editBlock
      ? editBlockLabel(editBlock)
      : floating
        ? "apply or cancel the transform first"
        : "select something first",
  );
  // Lifting needs a marquee and a writable layer; once lifted, the float carries on regardless.
  const liftWhy = $derived(
    floating
      ? ""
      : !hasMarquee
        ? "select something first"
        : editBlock
          ? editBlockLabel(editBlock)
          : "",
  );
  const pasteTitle = $derived(
    editBlock
      ? `Paste (Ctrl+V) — ${editBlockLabel(editBlock)}`
      : clipboard.hasPixels
        ? "Paste (Ctrl+V)"
        : "Paste (Ctrl+V) — nothing copied yet",
  );

  const brushTypes: { value: BrushType; label: string }[] = [
    { value: "smooth", label: "Smooth" },
    { value: "ink", label: "Ink" },
    { value: "calligraphy", label: "Calligraphy" },
    { value: "pencil", label: "Pencil" },
    { value: "charcoal", label: "Charcoal" },
    { value: "airbrush", label: "Airbrush" },
  ];
</script>

<input type="file" accept=".zip" class="hidden" bind:this={fileInput} onchange={onFileChosen} />
<input type="file" accept=".psd" class="hidden" bind:this={psdInput} onchange={onPsdChosen} />
<NewDocDialog open={newDocOpen} onConfirm={onNewDocument} onCancel={() => (newDocOpen = false)} />
<ShareReadyDialog file={shareFileReady} onClose={() => (shareFileReady = null)} />

<!-- Row 1: tools, visibility, history, zoom readout, menus. Fixed 48px, as slop-paint's. No
     `overflow` here: it would clip the menus. -->
<!-- grid-area: App.svelte lays the two rows out in its grid (row 1 always full width). -->
<div
  class="z-20 flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4"
  style:grid-area="row1"
>
  {#each toolGroups as group, gi (gi)}
    {#if gi > 0}<div class="mx-1 {divider}"></div>{/if}
    <div class="flex shrink-0 items-center gap-1">
      {#each group as { tool, icon: Icon, title, needsLayer } (tool)}
        <button
          class="{toolBtn} {ui.tool === tool ? 'ui-on' : toolIdle}"
          class:opacity-40={needsLayer && toolsDimmed && ui.tool !== tool}
          aria-pressed={ui.tool === tool}
          title={needsLayer && toolsDimmed ? `${title} — ${editBlockLabel("no-layer")}` : title}
          onclick={() => setTool(tool)}
        >
          <Icon size={20} />
        </button>
      {/each}
    </div>
  {/each}

  <div class="mx-2 {divider}"></div>

  <!-- Visibility toggles, kept on the bar because they are switched constantly while rigging; the
       View menu has matching entries. -->
  <div class="flex shrink-0 items-center gap-1">
    <button
      class="{toolBtn} {ui.showDrawings ? 'ui-on' : toolIdle}"
      aria-pressed={ui.showDrawings}
      title={ui.showDrawings
        ? "Drawings visible — click to hide"
        : "Drawings hidden — click to show"}
      onclick={() => (ui.showDrawings = !ui.showDrawings)}><Image size={20} /></button
    >
    <button
      class="{toolBtn} {ui.showBones ? 'ui-on' : toolIdle}"
      aria-pressed={ui.showBones}
      title={ui.showBones ? "Bones visible — click to hide" : "Bones hidden — click to show"}
      onclick={() => (ui.showBones = !ui.showBones)}><Bone size={20} /></button
    >
    <button
      class="{toolBtn} {ui.showMeshes ? 'ui-on' : toolIdle}"
      aria-pressed={ui.showMeshes}
      title={ui.showMeshes ? "Meshes visible — click to hide" : "Meshes hidden — click to show"}
      onclick={() => (ui.showMeshes = !ui.showMeshes)}><Grid3x3 size={20} /></button
    >
  </div>

  <div class="mx-2 {divider}"></div>

  <button
    class="{iconBtnClass} {dimmable}"
    aria-disabled={!historyState.canUndo}
    title={historyState.canUndo ? "Undo (Ctrl+Z)" : "Undo — nothing to undo"}
    onclick={() => {
      if (historyState.canUndo) history.undo();
    }}><Undo2 size={20} /></button
  >
  <button
    class="{iconBtnClass} {dimmable}"
    aria-disabled={!historyState.canRedo}
    title={historyState.canRedo ? "Redo (Ctrl+Shift+Z)" : "Redo — nothing to redo"}
    onclick={() => {
      if (historyState.canRedo) history.redo();
    }}><Redo2 size={20} /></button
  >

  <div class="mx-2 {divider}"></div>

  <span class="min-w-12 shrink-0 text-center text-[11px] text-text-muted" title="Zoom"
    >{ui.zoomText}</span
  >

  <!-- File / Edit / View, in slop-paint's order and naming (no Document menu: spine has no project
       name or canvas resize). Short verbs, "…" when a dialog follows, shortcuts as key chips. -->
  <div class="ml-auto flex shrink-0 items-center gap-1">
    <ToolbarMenu label="File">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            newDocOpen = true;
            close();
          }}>New…</button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            fileInput?.click();
            close();
          }}>Open… <span class={kbd}>Ctrl+O</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Save the project (drawing and rig) as a .zip"
          onclick={() => {
            void onSave();
            close();
          }}>Save <span class={kbd}>Ctrl+S</span></button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          title="Replace the document with a PSD's pixel layers"
          onclick={() => {
            psdInput?.click();
            close();
          }}>Import PSD…</button
        >
        <!-- The no-keyboard path (iPad): Cmd/Ctrl+V covers the desktop case. -->
        <button
          class={menuItem}
          role="menuitem"
          title="Add the image on the system clipboard as a new layer"
          onclick={() => {
            window.dispatchEvent(new Event("slop-spine:paste-image"));
            close();
          }}>Paste image as layer</button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          title="Skeleton, atlas and PNG for spine-pixi"
          onclick={() => {
            void onExport();
            close();
          }}>Export Spine…</button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="Edit">
      {#snippet children(close)}
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!historyState.canUndo}
          title={historyState.canUndo ? "" : "Undo — nothing to undo"}
          onclick={() => {
            if (historyState.canUndo) history.undo();
            close();
          }}>Undo <span class={kbd}>Ctrl+Z</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!historyState.canRedo}
          title={historyState.canRedo ? "" : "Redo — nothing to redo"}
          onclick={() => {
            if (historyState.canRedo) history.redo();
            close();
          }}>Redo <span class={kbd}>Ctrl+Shift+Z</span></button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canCopy}
          title={canCopy ? "" : `Cut — ${whyNoCopy}`}
          onclick={() => {
            if (canCopy) selectionCommands.cut?.();
            close();
          }}>Cut <span class={kbd}>Ctrl+X</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canCopy}
          title={canCopy ? "" : `Copy — ${whyNoCopy}`}
          onclick={() => {
            if (canCopy) selectionCommands.copy?.();
            close();
          }}>Copy <span class={kbd}>Ctrl+C</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          title={clipboard.hasPixels
            ? pasteTitle
            : "Paste — an image on the system clipboard becomes a new layer"}
          onclick={() => {
            onPaste();
            close();
          }}>Paste <span class={kbd}>Ctrl+V</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canCopy}
          title={canCopy ? "" : `Delete — ${whyNoCopy}`}
          onclick={() => {
            if (canCopy) selectionCommands.del?.();
            close();
          }}>Delete <span class={kbd}>Del</span></button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            selectionCommands.selectAll?.();
            if (!isSelectTool(ui.tool)) setTool("select");
            close();
          }}>Select all</button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!hasMarquee}
          title={hasMarquee ? "" : "Deselect — nothing selected"}
          onclick={() => {
            if (hasMarquee) selectionCommands.deselect?.();
            close();
          }}>Deselect <span class={kbd}>Esc</span></button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          title="Clear the selected layer to transparent"
          onclick={() => {
            clearSelectedLayer();
            close();
          }}>Clear layer</button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="View">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            onFitView();
            close();
          }}>Fit to view <span class={kbd}>0</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            onActualSize();
            close();
          }}>Actual size <span class={kbd}>1</span></button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            ui.showDrawings = !ui.showDrawings;
            close();
          }}>{ui.showDrawings ? "Hide drawings" : "Show drawings"}</button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            ui.showBones = !ui.showBones;
            close();
          }}>{ui.showBones ? "Hide bones" : "Show bones"}</button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            ui.showMeshes = !ui.showMeshes;
            close();
          }}>{ui.showMeshes ? "Hide meshes" : "Show meshes"}</button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            ui.whiteBg = !ui.whiteBg;
            close();
          }}>{ui.whiteBg ? "Checkerboard page" : "White page"}</button
        >
      {/snippet}
    </ToolbarMenu>
  </div>
</div>

<!-- Row 2: options for the active tool. Keeps its minimum height for every tool so switching
     doesn't move the canvas; controls stay ≤ 28px tall. Wraps rather than scrolls, so popovers
     aren't clipped. -->
<div
  class="z-10 flex min-h-10 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-1 *:shrink-0 max-[960px]:gap-x-2"
  style:grid-area="row2"
>
  {#if ui.tool === "brush" || ui.tool === "eraser"}
    <select
      class="h-7 cursor-pointer rounded-md border border-border bg-surface-raised px-1.5 text-xs text-text-secondary"
      title={ui.tool === "eraser" ? "Eraser tip" : "Brush"}
      bind:value={slot.brushType}
    >
      {#each brushTypes as { value, label } (value)}
        <option {value}>{label}</option>
      {/each}
    </select>

    <div class={sliderLabel}>
      Size
      <input
        type="range"
        min={SIZE_MIN}
        max={SIZE_MAX}
        step="0.5"
        class="w-16"
        style={sliderFill(slot.size, SIZE_MIN, SIZE_MAX)}
        bind:value={slot.size}
      />
      {#if editingSize}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="h-7 w-12 rounded-md border border-border bg-surface-raised px-1 text-center text-[11px] text-text"
          type="text"
          inputmode="decimal"
          bind:value={sizeInputValue}
          autofocus
          onblur={commitSize}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitSize();
            }
            if (e.key === "Escape") editingSize = false;
            e.stopPropagation();
          }}
        />
      {:else}
        <button
          class="h-7 w-12 cursor-text rounded-md text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
          onclick={startEditSize}
          title="Click to type exact size">{slot.size}</button
        >
      {/if}
      <div class="flex gap-px">
        {#each SIZE_PRESETS as s (s)}
          <button
            class="size-6 rounded-md text-[10px] transition-colors {slot.size === s
              ? 'ui-on'
              : 'text-text-muted hover:bg-surface-hover hover:text-text'} {narrowPresets.has(s)
              ? ''
              : 'max-[960px]:hidden'}"
            title="Size {s}"
            onclick={() => (slot.size = s)}>{s}</button
          >
        {/each}
      </div>
    </div>

    <label
      class={sliderLabel}
      title="How much pen pressure widens the stroke. 1× is a constant width"
    >
      Press
      <input
        type="range"
        min={PRESS_MIN}
        max={PRESS_MAX}
        step="0.5"
        class="w-16"
        style={sliderFill(slot.press, PRESS_MIN, PRESS_MAX)}
        bind:value={slot.press}
      />
      <span class={readout}>{slot.press}×</span>
    </label>

    <label class={sliderLabel}>
      Opacity
      <input
        type="range"
        min="1"
        max="100"
        class="w-16"
        style={sliderFill(slot.opacity, 1, 100)}
        bind:value={slot.opacity}
      />
      <span class={readout}>{slot.opacity}%</span>
    </label>

    <!-- Draw behind is toggled while drawing (flats under line art), so it sits on the bar, not
         behind the gear. Brush only: the eraser ignores it. -->
    {#if ui.tool === "brush"}
      <div class="flex items-center">
        <button
          class="{iconBtn} {ui.drawBehind ? 'ui-on' : iconIdle}"
          aria-pressed={ui.drawBehind}
          title={ui.drawBehind
            ? "Draw behind on — paint goes under existing pixels; tap to turn off"
            : "Draw behind — paint under existing pixels"}
          onclick={() => (ui.drawBehind = !ui.drawBehind)}><SendToBack size={18} /></button
        >
      </div>
    {/if}

    <!-- Set-once settings live behind the gear. The bar keeps what changes while drawing. -->
    <div class="relative" use:clickOutside={() => (settingsOpen = false)}>
      <button
        class="{iconBtn} {settingsOpen ? 'ui-on' : iconIdle}"
        aria-pressed={settingsOpen}
        aria-haspopup="dialog"
        onclick={() => (settingsOpen = !settingsOpen)}
        title="{ui.tool === 'eraser'
          ? 'Eraser'
          : 'Brush'} settings — stream, pressure curve, and options for this brush"
      >
        <Settings size={18} />
      </button>
      {#if settingsOpen}
        <div
          class="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          {#if slot.brushType === "smooth"}
            <label class={rowCls} title="Smooth the perfect-freehand outline">
              <span class={labelCls}>Smooth</span>
              <input
                type="range"
                min="0"
                max="100"
                class="min-w-0 flex-1"
                style={sliderFill(slot.smoothing, 0, 100)}
                bind:value={slot.smoothing}
              />
              <span class={valueCls}>{slot.smoothing}</span>
            </label>
          {/if}

          <label class={rowCls} title="Smooth the incoming pointer path">
            <span class={labelCls}>Stream</span>
            <input
              type="range"
              min="0"
              max="100"
              class="min-w-0 flex-1"
              style={sliderFill(slot.streamline, 0, 100)}
              bind:value={slot.streamline}
            />
            <span class={valueCls}>{slot.streamline}</span>
          </label>

          {#if slot.brushType === "calligraphy"}
            <label class={rowCls}>
              <span class={labelCls}>Nib angle</span>
              <input
                type="range"
                min="0"
                max="180"
                class="min-w-0 flex-1"
                style={sliderFill(ui.nibAngle, 0, 180)}
                bind:value={ui.nibAngle}
              />
              <span class={valueCls}>{ui.nibAngle}°</span>
            </label>
            <label class={rowCls}>
              <span class={labelCls}>Nib flatness</span>
              <input
                type="range"
                min="0"
                max={MAX_NIB_FLATNESS * 100}
                class="min-w-0 flex-1"
                style={sliderFill(ui.nibFlatness * 100, 0, MAX_NIB_FLATNESS * 100)}
                value={ui.nibFlatness * 100}
                oninput={(e) => (ui.nibFlatness = Number(e.currentTarget.value) / 100)}
              />
              <span class={valueCls}>{Math.round(ui.nibFlatness * 100)}</span>
            </label>
          {/if}

          {#if slot.brushType === "ink"}
            <label
              class={rowCls}
              title="Swell the mark where the pen lingers, the way ink soaks in — 0 is off"
            >
              <span class={labelCls}>Pool</span>
              <input
                type="range"
                min="0"
                max="100"
                class="min-w-0 flex-1"
                style={sliderFill(ui.dwellPool, 0, 100)}
                bind:value={ui.dwellPool}
              />
              <span class={valueCls}>{ui.dwellPool}</span>
            </label>
          {/if}

          {#if slot.brushType === "smooth"}
            <label
              class="flex items-center gap-2 text-xs text-text-secondary"
              title="Taper the stroke's ends to a point instead of capping them"
            >
              <input type="checkbox" bind:checked={ui.taper} />
              Taper stroke ends
            </label>
          {/if}

          <div class="mt-1 flex flex-col gap-1 border-t border-border pt-2">
            <span class="text-xs text-text-secondary"
              >Pressure curve{ui.tool === "eraser" ? " (eraser)" : ""}</span
            >
            <div bind:this={curveHostEl} class="curve-editor flex flex-col items-center"></div>
          </div>
        </div>
      {/if}
    </div>

    {#if ui.tool === "brush"}
      <ColorSwatch value={ui.brushValue} title="Brush colour" onPick={(c) => (ui.brushValue = c)} />
    {/if}
  {:else if ui.tool === "fill"}
    <label class={sliderLabel} title="How different a colour may be and still fill">
      Tolerance
      <input
        type="range"
        min="0"
        max="128"
        class="w-16"
        style={sliderFill(ui.fillTolerance, 0, 128)}
        bind:value={ui.fillTolerance}
      />
      <span class={readout}>{ui.fillTolerance}</span>
    </label>
    <label class={sliderLabel} title="Grow the filled region under the outline (px)">
      Expand
      <input
        type="range"
        min="0"
        max="8"
        class="w-16"
        style={sliderFill(ui.fillExpand, 0, 8)}
        bind:value={ui.fillExpand}
      />
      <span class={readout}>{ui.fillExpand}px</span>
    </label>
    <label class={sliderLabel}>
      Opacity
      <input
        type="range"
        min="1"
        max="100"
        class="w-16"
        style={sliderFill(ui.fillOpacity, 1, 100)}
        bind:value={ui.fillOpacity}
      />
      <span class={readout}>{ui.fillOpacity}%</span>
    </label>
    <div class={divider}></div>
    <label
      class={sliderLabel}
      title="Fill enclosed: close breaks in the outline up to about twice this many pixels"
    >
      Bridge
      <input
        type="range"
        min="0"
        max={MAX_GAP}
        class="w-16"
        style={sliderFill(ui.fillGap, 0, MAX_GAP)}
        value={ui.fillGap}
        oninput={(e) => (ui.fillGap = clampGap(e.currentTarget.value))}
      />
      <span class="min-w-4 text-[11px] text-text-muted">{ui.fillGap}</span>
    </label>
    <button
      class="h-7 rounded-md border border-border bg-surface-raised px-2 text-xs whitespace-nowrap text-text-secondary transition-colors hover:bg-surface-hover {dimmable}"
      title={editBlock
        ? `Fill enclosed — ${editBlockLabel(editBlock)}`
        : "Fill every area the outline on this layer encloses, behind the lines"}
      aria-disabled={!canPaint}
      onclick={() => {
        if (canPaint) fillAllEnclosed();
      }}>Fill enclosed</button
    >
    <ColorSwatch value={ui.fillValue} title="Fill colour" onPick={(c) => (ui.fillValue = c)} />
  {:else if ui.tool === "eyedropper"}
    <div class="flex items-center gap-2 text-xs text-text-secondary">
      <span
        class="size-5 rounded-full border border-text-muted"
        style:background={ui.eyedropperTarget === "fill" ? ui.fillValue : ui.brushValue}
        title={ui.eyedropperTarget === "fill"
          ? "Fill colour to replace"
          : "Brush colour to replace"}
      ></span>
      <span class="text-text-muted">Drag to aim, release to pick a colour</span>
    </div>
  {:else if isSelectTool(ui.tool)}
    <!-- Every selection action lives here, as slop-paint (no floating bar over the art): a float can
         only exist on Select/Lasso — switching tools applies it — so this row is always showing
         when there is one. Left-aligned, so nothing moves when a button is dimmed. The commands
         live in Canvas and are reached through the selectionCommands registry. -->
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!canCopy}
        title={canCopy ? "Copy (Ctrl+C)" : `Copy — ${whyNoCopy}`}
        onclick={() => {
          if (canCopy) selectionCommands.copy?.();
        }}><Copy size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!canCopy}
        title={canCopy ? "Cut (Ctrl+X)" : `Cut — ${whyNoCopy}`}
        onclick={() => {
          if (canCopy) selectionCommands.cut?.();
        }}><Scissors size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!canPaste}
        title={pasteTitle}
        onclick={() => {
          if (canPaste) selectionCommands.paste?.();
        }}><ClipboardPaste size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!canCopy}
        title={canCopy ? "Delete selection (Del)" : `Delete — ${whyNoCopy}`}
        onclick={() => {
          if (canCopy) selectionCommands.del?.();
        }}><Trash2 size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!hasMarquee}
        title={hasMarquee ? "Deselect (Esc)" : "Deselect — nothing selected"}
        onclick={() => {
          if (hasMarquee) selectionCommands.deselect?.();
        }}><SquareX size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle}"
        title="Select all"
        onclick={() => selectionCommands.selectAll?.()}><Scan size={16} /></button
      >
    </div>
    <div class={divider}></div>
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {ui.selectionState === 'transforming' ? 'ui-on' : iconIdle} {dimmable}"
        aria-pressed={ui.selectionState === "transforming"}
        aria-disabled={!!liftWhy || floating}
        title={liftWhy
          ? `Free transform — ${liftWhy}`
          : warping
            ? "Free transform — apply or cancel the warp first"
            : "Free transform — scale/rotate handles"}
        onclick={() => {
          if (!liftWhy && !floating) selectionCommands.transform?.();
        }}><Move size={16} /></button
      >
      <button
        class="{iconBtn} {warping && isDistort ? 'ui-on' : iconIdle} {dimmable}"
        aria-pressed={warping && isDistort}
        aria-disabled={!!liftWhy}
        title={liftWhy ? `Distort — ${liftWhy}` : "Distort — 4-corner warp"}
        onclick={() => {
          if (!liftWhy) selectionCommands.warp?.(2, 2);
        }}><SquareDashed size={16} /></button
      >
      <button
        class="{iconBtn} {warping && !isDistort ? 'ui-on' : iconIdle} {dimmable}"
        aria-pressed={warping && !isDistort}
        aria-disabled={!!liftWhy}
        title={liftWhy ? `Mesh warp — ${liftWhy}` : "Mesh warp — 3×3 grid"}
        onclick={() => {
          if (!liftWhy) selectionCommands.warp?.(3, 3);
        }}><Grid3x3 size={16} /></button
      >
    </div>
    {#if warping}
      <!-- Spine's own warp controls (slop-paint has none of these): grid density, FFD or rigid
           (MLS with pins), and clearing the pins. -->
      <div class="flex items-center gap-1 text-xs text-text-secondary">
        <button
          class="{iconBtn} {iconIdle} {dimmable}"
          aria-disabled={ui.warpRows <= 2}
          title={ui.warpRows <= 2 ? "Less detail — already the coarsest grid" : "Less detail"}
          onclick={() => {
            if (ui.warpRows > 2) selectionCommands.densify?.(-1);
          }}>−</button
        >
        <span class="min-w-8 text-center text-[11px] text-text-muted" title="Warp grid"
          >{ui.warpRows}×{ui.warpCols}</span
        >
        <button
          class="{iconBtn} {iconIdle}"
          title="More detail"
          onclick={() => selectionCommands.densify?.(1)}>+</button
        >
        <div class="ml-1 flex items-center gap-px">
          <button
            class="h-7 rounded-l-md border px-2 transition-colors {ui.deformMode === 'ffd'
              ? 'ui-on'
              : iconIdle}"
            aria-pressed={ui.deformMode === "ffd"}
            title="Free-form: the grid bends the pixels directly"
            onclick={() => selectionCommands.setDeformMode?.("ffd")}>FFD</button
          >
          <button
            class="h-7 rounded-r-md border px-2 transition-colors {ui.deformMode === 'rigid'
              ? 'ui-on'
              : iconIdle}"
            aria-pressed={ui.deformMode === "rigid"}
            title="Rigid: drag points as pins, the rest follows as stiffly as it can"
            onclick={() => selectionCommands.setDeformMode?.("rigid")}>Rigid</button
          >
        </div>
        {#if ui.deformMode === "rigid"}
          <button
            class="h-7 rounded-md border px-2 transition-colors {iconIdle}"
            title="Clear pinned handles"
            onclick={() => selectionCommands.resetPins?.()}>Reset pins</button
          >
        {/if}
      </div>
    {/if}
    <div class={divider}></div>
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {floating ? 'ui-on' : iconIdle} {dimmable}"
        aria-disabled={!floating}
        title={floating ? "Apply (Enter)" : "Apply — nothing lifted yet"}
        onclick={() => {
          if (floating) selectionCommands.apply?.();
        }}><Check size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!floating}
        title={floating ? "Cancel (Esc)" : "Cancel — nothing lifted yet"}
        onclick={() => {
          if (floating) selectionCommands.cancel?.();
        }}><X size={16} /></button
      >
    </div>
  {:else if ui.tool === "bone"}
    <!-- Radio, not toggles: edit is the default mode, and with only Create and Pose as on/off
         buttons it was the state where NEITHER was lit. Shift and Alt still override whichever is
         selected (see onRigPointerDown), so these set the no-modifier default. -->
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {ui.boneMode === 'edit' ? 'ui-on' : iconIdle}"
        aria-pressed={ui.boneMode === "edit"}
        title="Edit bones — drag the shaft to move, the tip to rotate, the handle to set reach"
        onclick={() => (ui.boneMode = "edit")}><MousePointer2 size={16} /></button
      >
      <button
        class="{iconBtn} {ui.boneMode === 'create' ? 'ui-on' : iconIdle}"
        aria-pressed={ui.boneMode === "create"}
        title="Create bone (or Shift-drag). Shift-click a shaft to insert a joint."
        onclick={() => (ui.boneMode = "create")}><Plus size={16} /></button
      >
      <button
        class="{iconBtn} {ui.boneMode === 'pose' ? 'ui-on' : iconIdle}"
        aria-pressed={ui.boneMode === "pose"}
        title="Pose (or Alt-drag). Tip rotates, shaft translates."
        onclick={() => (ui.boneMode = "pose")}><RotateCcw size={16} /></button
      >
    </div>
    <div class={divider}></div>
    <!-- Actions, not modes. Delete removes the bone and its subtree (as the Delete key and the
         Inspector do, all through deleteBone); root can't be removed, so the button says so. -->
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!ui.selectedBone || ui.selectedBone === "root"}
        title={!ui.selectedBone
          ? "Delete bone — select one first"
          : ui.selectedBone === "root"
            ? "The root bone cannot be deleted"
            : `Delete "${ui.selectedBone}" and its children (Del)`}
        aria-label="Delete selected bone and its children"
        onclick={() => {
          if (ui.selectedBone && ui.selectedBone !== "root") deleteBone(ui.selectedBone);
        }}><Trash2 size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!ui.selectedBone || ui.selectedBone === "root"}
        title={!ui.selectedBone
          ? "Dissolve bone — select one first"
          : ui.selectedBone === "root"
            ? "The root bone cannot be dissolved"
            : `Dissolve "${ui.selectedBone}" — remove it but keep its children, hung on its parent`}
        aria-label="Dissolve selected bone, keeping its children"
        onclick={() => {
          if (ui.selectedBone && ui.selectedBone !== "root") dissolveBone(ui.selectedBone);
        }}><FoldVertical size={16} /></button
      >
    </div>
  {/if}

  <!-- A marquee outlives the Select tool and silently limits where brush, eraser and fill paint:
       say so, one tap from clearing it. Amber = "why this won't behave as you expect". -->
  {#if hasMarquee && isPaintTool(ui.tool)}
    <div class="flex items-center">
      <button
        class="flex h-7 items-center gap-1 rounded-md border border-warn/50 bg-surface-raised px-2 text-xs whitespace-nowrap text-warn transition-colors hover:bg-surface-hover"
        title="A selection limits where this tool paints — tap to deselect"
        onclick={() => selectionCommands.deselect?.()}><SquareX size={14} />Deselect</button
      >
    </div>
  {/if}
</div>
