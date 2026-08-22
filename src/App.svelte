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

  onMount(async () => {
    try {
      const restored = await restore();
      if (restored) loadDocument(restored);
    } catch (e) {
      console.error("autosave restore failed", e);
    }
    ready = true;
  });

  $effect(() => {
    // Read every field autosave cares about so this effect reruns on any document mutation —
    // strokes only bump `layer.revision` (canvas pixels themselves aren't reactive), so that field
    // matters as much as the structural ones.
    doc.canvas.width;
    doc.canvas.height;
    doc.density;
    for (const l of doc.layers) {
      l.id;
      l.name;
      l.visible;
      l.opacity;
      l.revision;
    }
    for (const s of doc.slots) {
      s.name;
      s.layerId;
      s.bone;
      s.order;
    }
    for (const b of doc.bones) {
      b.name;
      b.parent;
      b.x;
      b.y;
      b.rotation;
      b.length;
      b.wobble;
    }
    for (const bd of doc.binds) {
      bd.slot;
      for (const n of bd.bones) n;
    }

    if (!ready) return;
    armAutosave(() => doc);
  });
</script>

<main class="flex h-dvh w-dvw flex-col bg-neutral-900 text-neutral-200">
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
