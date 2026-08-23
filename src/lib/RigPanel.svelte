<script lang="ts">
  import {
    document as doc,
    setWobble,
    setBind,
    setSlotDensity,
    renameBone,
    removeBone,
    setParent,
    descendantsOf,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";

  let selectedSlot = $derived(doc.slots.find((s) => s.layerId === ui.selectedLayerId) ?? null);
  // Shows the selected slot's effective density (its override, or the document default when it
  // has none); with no slot selected there's nothing to override, so this is just the default.
  let effectiveDensity = $derived(selectedSlot ? (selectedSlot.density ?? doc.density) : doc.density);
  let hasDensityOverride = $derived(selectedSlot?.density !== undefined);
  let selectedBone = $derived(doc.bones.find((b) => b.name === ui.selectedBone) ?? null);
  let bindBones = $derived(
    selectedSlot ? (doc.binds.find((b) => b.slot === selectedSlot!.name)?.bones ?? []) : [],
  );
  // root is never a valid weight influence (document.ts's defaultBind excludes it too).
  let bindableBones = $derived(doc.bones.filter((b) => b.name !== "root"));
  // A bone can't be parented to itself or to its own descendant (setParent refuses that as a
  // cycle) — excluded here too so the dropdown never offers a choice it would then reject.
  let invalidParents = $derived(
    selectedBone ? new Set([selectedBone.name, ...descendantsOf(selectedBone.name).map((b) => b.name)]) : new Set<string>(),
  );
  let parentOptions = $derived(doc.bones.filter((b) => !invalidParents.has(b.name)));

  let nameDraft = $state("");
  $effect(() => {
    nameDraft = selectedBone?.name ?? "";
  });

  function onWobbleInput(e: Event) {
    if (selectedBone) setWobble(selectedBone.name, Number((e.target as HTMLInputElement).value));
  }
  // With a slot selected, the slider edits that slot's override. With none selected, there's no
  // slot to override, so it edits the document default instead — which is what new slots inherit.
  function onDensityInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    if (selectedSlot) setSlotDensity(selectedSlot.name, v);
    else doc.density = v;
  }
  function resetDensity() {
    if (selectedSlot) setSlotDensity(selectedSlot.name, undefined);
  }
  function toggleBind(boneName: string, checked: boolean) {
    if (!selectedSlot) return;
    const next = checked ? [...bindBones, boneName] : bindBones.filter((n) => n !== boneName);
    setBind(selectedSlot.name, next);
  }
  function commitName() {
    if (!selectedBone) return;
    const bone = selectedBone; // live reference into doc.bones; renameBone mutates it in place
    const oldName = bone.name;
    renameBone(oldName, nameDraft);
    // renameBone silently refuses a collision/empty/root name — bone.name says whether it took.
    if (bone.name !== oldName) ui.selectedBone = bone.name;
    nameDraft = bone.name;
  }
  function onDeleteBone() {
    if (!selectedBone) return;
    removeBone(selectedBone.name);
    ui.selectedBone = null;
  }
  function onParentChange(e: Event) {
    if (selectedBone) setParent(selectedBone.name, (e.target as HTMLSelectElement).value);
  }
</script>

<div class="flex w-56 flex-col gap-3 overflow-y-auto border-l border-border bg-surface p-2 text-sm text-text">
  <span class="font-mono text-xs uppercase text-text-secondary">Rig</span>

  <label class="flex flex-col gap-1">
    Density {#if selectedSlot}— {selectedSlot.name}{:else}(document default){/if}
    <div class="flex items-center gap-1">
      <input type="range" min="8" max="96" value={effectiveDensity} oninput={onDensityInput} />
      <span class="w-6 text-right font-mono text-xs">{effectiveDensity}</span>
      {#if hasDensityOverride}
        <button class="shrink-0 text-text-muted hover:text-text" onclick={resetDensity} title="Reset to document default">
          ↺
        </button>
      {/if}
    </div>
  </label>

  {#if selectedBone}
    <label class="flex flex-col gap-1">
      Bone name
      <div class="flex items-center gap-1">
        <input
          class="min-w-0 flex-1 bg-canvas-bg px-1 text-text"
          bind:value={nameDraft}
          onblur={commitName}
          onkeydown={(e) => e.key === "Enter" && commitName()}
        />
        <button class="shrink-0 text-text-muted hover:text-text" onclick={onDeleteBone} title="Delete bone">
          ✕
        </button>
      </div>
    </label>

    <label class="flex flex-col gap-1">
      Parent
      <select class="bg-canvas-bg px-1 text-text" value={selectedBone.parent} onchange={onParentChange}>
        {#each parentOptions as bone (bone.name)}
          <option value={bone.name}>{bone.name}</option>
        {/each}
      </select>
    </label>

    <label class="flex flex-col gap-1">
      Wobble
      <div class="flex items-center gap-1">
        <input type="range" min="0" max="1" step="0.01" value={selectedBone.wobble} oninput={onWobbleInput} />
        <span class="w-8 text-right font-mono text-xs">{selectedBone.wobble.toFixed(2)}</span>
      </div>
    </label>
  {:else}
    <p class="text-xs text-text-muted">Shift-drag from a bone (or empty canvas, for the first one) to add one.</p>
  {/if}

  {#if selectedSlot}
    <div class="flex flex-col gap-1">
      <span class="text-xs text-text-secondary">Bind — {selectedSlot.name}</span>
      {#if bindableBones.length === 0}
        <p class="text-xs text-text-muted">No bones yet.</p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each bindableBones as bone (bone.name)}
            <li>
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={bindBones.includes(bone.name)}
                  onchange={(e) => toggleBind(bone.name, (e.target as HTMLInputElement).checked)}
                />
                {bone.name}
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <p class="text-xs text-text-muted">Select a layer to bind bones to it.</p>
  {/if}
</div>
