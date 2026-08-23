<script lang="ts">
  import { onMount } from "svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerPanel from "./lib/LayerPanel.svelte";
  import RigPanel from "./lib/RigPanel.svelte";
  import { ui } from "./state/ui.svelte";
  import { document as doc, loadDocument } from "./state/doc.svelte";
  import { armAutosave, restore } from "./persist/autosave";

  // Gate autosave until the startup restore has settled — `doc` is a blank document until then,
  // and arming on that blank state (see the $effect below) would overwrite a real autosave with
  // nothing if a stray change landed before `restore()` resolves.
  let ready = $state(false);
  // A restore() that throws leaves `doc` blank for reasons that have nothing to do with there
  // being no autosave (a first run) — arming autosave in that case would overwrite the real
  // autosave with the blank document. Only a null restore (genuinely no autosave yet) arms.
  let restoreFailed = false;

  onMount(async () => {
    try {
      const restored = await restore();
      if (restored) loadDocument(restored);
    } catch (e) {
      console.error("autosave restore failed", e);
      restoreFailed = true;
    }
    ready = true;
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

<main class="flex h-dvh w-dvw flex-col bg-surface text-text">
  <Toolbar />
  <div class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1">
      <Canvas />
    </div>
    {#if ui.mode === "rig"}
      <RigPanel />
    {:else}
      <LayerPanel />
    {/if}
  </div>
</main>
