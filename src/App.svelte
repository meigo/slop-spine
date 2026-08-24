<script lang="ts">
  import { onMount } from "svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerPanel from "./lib/LayerPanel.svelte";
  import Inspector from "./lib/Inspector.svelte";
  import { document as doc, loadDocument } from "./state/doc.svelte";
  import { ui, applyPreferences, gatherPreferences } from "./state/ui.svelte";
  import { armAutosave, restore } from "./persist/autosave";
  import { loadPreferences, savePreferences } from "./persist/preferences";
  import { clampDockWidth, clampInspectorHeight } from "./core/panel-layout";

  // Gate autosave until the startup restore has settled — `doc` is a blank document until then,
  // and arming on that blank state (see the $effect below) would overwrite a real autosave with
  // nothing if a stray change landed before `restore()` resolves.
  let ready = $state(false);
  // A restore() that throws leaves `doc` blank for reasons that have nothing to do with there
  // being no autosave (a first run) — arming autosave in that case would overwrite the real
  // autosave with the blank document. Only a null restore (genuinely no autosave yet) arms.
  let restoreFailed = false;

  let dockEl: HTMLDivElement | undefined = $state();
  let prefsReady = false;

  function columnH() {
    return dockEl?.clientHeight ?? window.innerHeight;
  }

  function applyPanelPrefs() {
    ui.dockWidth = clampDockWidth(ui.dockWidth, window.innerWidth);
    ui.inspectorHeight = clampInspectorHeight(ui.inspectorHeight, columnH());
  }

  let widthStartX = 0;
  let widthStartW = 0;
  function widthDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    widthStartX = e.clientX;
    widthStartW = ui.dockWidth;
  }
  function widthMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    ui.dockWidth = clampDockWidth(widthStartW + (widthStartX - e.clientX), window.innerWidth);
  }
  function widthUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  let heightStartY = 0;
  let heightStartH = 0;
  function heightDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    heightStartY = e.clientY;
    heightStartH = ui.inspectorHeight;
  }
  function heightMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    ui.inspectorHeight = clampInspectorHeight(heightStartH + (heightStartY - e.clientY), columnH());
  }
  function heightUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  onMount(async () => {
    applyPreferences(loadPreferences());
    applyPanelPrefs();
    prefsReady = true;
    try {
      const restored = await restore();
      if (restored) loadDocument(restored);
    } catch (e) {
      console.error("autosave restore failed", e);
      restoreFailed = true;
    }
    ready = true;
  });

  let prefsTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const prefs = gatherPreferences();
    if (!prefsReady) return;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => savePreferences(prefs), 400);
  });

  $effect(() => {
    // Deep-read the document so this effect reruns on ANY mutation. JSON.stringify walks every own
    // enumerable property through the $state proxy's get/ownKeys traps, which registers a dependency
    // on each field and on added/removed keys and array length — so a new field on Bone/Slot/Layer is
    // tracked the day it is added, with nothing to remember. The returned string is discarded; the
    // walk is the point. layer.canvas is an HTMLCanvasElement with no own enumerable properties, so it
    // contributes {} rather than throwing — canvas pixels stay tracked by layer.revision as before.
    JSON.stringify(doc);

    if (!ready || restoreFailed) return;
    armAutosave(() => doc);
  });
</script>

<svelte:window onresize={applyPanelPrefs} />

<main class="flex h-dvh w-dvw flex-col bg-surface text-text">
  <Toolbar />
  <div class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1">
      <Canvas />
    </div>
    <div
      bind:this={dockEl}
      class="relative flex shrink-0 flex-col border-l border-border bg-surface"
      style="width: {ui.dockWidth}px"
    >
      <div
        class="group absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize"
        style="touch-action: none"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize layer panel"
        title="Drag to resize the layer panel"
        onpointerdown={widthDown}
        onpointermove={widthMove}
        onpointerup={widthUp}
        onpointercancel={widthUp}
      >
        <div class="absolute inset-y-0 left-0 w-1 group-hover:bg-text/10"></div>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden">
        <LayerPanel />
      </div>
      <div
        class="relative flex shrink-0 flex-col border-t border-border"
        style="height: {ui.inspectorHeight}px"
      >
        <div
          class="group absolute inset-x-0 top-0 z-30 h-2 cursor-row-resize"
          style="touch-action: none"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize inspector"
          title="Drag to resize the inspector"
          onpointerdown={heightDown}
          onpointermove={heightMove}
          onpointerup={heightUp}
          onpointercancel={heightUp}
        >
          <div class="absolute inset-x-0 top-0 h-1 group-hover:bg-text/10"></div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Inspector />
        </div>
      </div>
    </div>
  </div>
</main>
