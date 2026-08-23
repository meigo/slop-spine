<script lang="ts">
  import {
    document as doc,
    setWobble,
    setWobbleMove,
    setSlotDensity,
    setSlotBone,
    renameBone,
    removeBone,
    setParent,
    descendantsOf,
    snapshotRig,
    pushRigCommand,
    setBind,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import { bindListAfterToggle } from "../rig/derive";

  let selectedSlot = $derived(doc.slots.find((s) => s.layerId === ui.selectedLayerId) ?? null);
  let selectedLayer = $derived(doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null);
  let effectiveDensity = $derived(selectedSlot ? (selectedSlot.density ?? doc.density) : doc.density);
  let hasDensityOverride = $derived(selectedSlot?.density !== undefined);
  let selectedBone = $derived(doc.bones.find((b) => b.name === ui.selectedBone) ?? null);
  let invalidParents = $derived(
    selectedBone ? new Set([selectedBone.name, ...descendantsOf(selectedBone.name).map((b) => b.name)]) : new Set<string>(),
  );
  let parentOptions = $derived(doc.bones.filter((b) => !invalidParents.has(b.name)));
  let bindableBones = $derived(doc.bones.filter((b) => b.name !== "root"));
  let storedBinds = $derived(selectedSlot ? (doc.binds.find((b) => b.slot === selectedSlot!.name)?.bones ?? []) : []);
  let bindIncluded = $derived(new Set(storedBinds.length ? storedBinds : bindableBones.map((b) => b.name)));

  let nameDraft = $state("");
  $effect(() => {
    nameDraft = selectedBone?.name ?? "";
  });

  let wobbleBefore: ReturnType<typeof snapshotRig> | null = null;
  function onWobblePointerDown() {
    wobbleBefore = snapshotRig();
  }
  function onWobbleInput(e: Event) {
    if (selectedBone) setWobble(selectedBone.name, Number((e.target as HTMLInputElement).value));
  }
  function onWobblePointerUp() {
    if (wobbleBefore) {
      pushRigCommand(wobbleBefore, snapshotRig());
      wobbleBefore = null;
    }
  }
  function onDensityInput(e: Event) {
    if (!selectedSlot) return;
    setSlotDensity(selectedSlot.name, Number((e.target as HTMLInputElement).value));
  }
  function resetDensity() {
    if (selectedSlot) setSlotDensity(selectedSlot.name, undefined);
  }
  function onHangFrom(e: Event) {
    if (!selectedSlot) return;
    const before = snapshotRig();
    setSlotBone(selectedSlot.name, (e.target as HTMLSelectElement).value);
    pushRigCommand(before, snapshotRig());
  }
  function onBindToggle(boneName: string, included: boolean) {
    if (!selectedSlot) return;
    const all = bindableBones.map((b) => b.name);
    const next = bindListAfterToggle(storedBinds, all, boneName, included);
    const before = snapshotRig();
    setBind(selectedSlot.name, next);
    pushRigCommand(before, snapshotRig());
  }
  function commitName() {
    if (!selectedBone) return;
    const bone = selectedBone;
    const oldName = bone.name;
    const before = snapshotRig();
    renameBone(oldName, nameDraft);
    if (bone.name !== oldName) ui.selectedBone = bone.name;
    nameDraft = bone.name;
    pushRigCommand(before, snapshotRig());
  }
  function onDeleteBone() {
    if (!selectedBone) return;
    const before = snapshotRig();
    removeBone(selectedBone.name);
    ui.selectedBone = null;
    pushRigCommand(before, snapshotRig());
  }
  function onParentChange(e: Event) {
    if (selectedBone) {
      const before = snapshotRig();
      setParent(selectedBone.name, (e.target as HTMLSelectElement).value);
      pushRigCommand(before, snapshotRig());
    }
  }
</script>

<div class="flex flex-col gap-3 p-2 text-sm text-text">
  <span class="font-mono text-xs uppercase text-text-secondary">Inspector</span>

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
      </div>
    </label>

    <button
      class="self-start rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text"
      onclick={onDeleteBone}
      title="Delete bone and its children"
    >
      Delete
    </button>

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
        <input type="range" min="0" max="1" step="0.01" value={selectedBone.wobble} onpointerdown={onWobblePointerDown} onpointerup={onWobblePointerUp} oninput={onWobbleInput} />
        <span class="w-8 text-right font-mono text-xs">{selectedBone.wobble.toFixed(2)}</span>
      </div>
      <label class="flex items-center gap-1 text-xs text-text-secondary" title="Off: rotation only (default). On: also lag position.">
        <input
          type="checkbox"
          checked={!!selectedBone.wobbleMove}
          onchange={(e) => {
            const before = snapshotRig();
            setWobbleMove(selectedBone.name, (e.target as HTMLInputElement).checked);
            pushRigCommand(before, snapshotRig());
          }}
        />
        Also move
      </label>
    </label>
  {:else if selectedSlot}
    <label class="flex flex-col gap-1">
      Hangs from
      <select class="bg-canvas-bg px-1 text-text" value={selectedSlot.bone} onchange={onHangFrom}>
        {#each doc.bones as bone (bone.name)}
          <option value={bone.name}>{bone.name}</option>
        {/each}
      </select>
    </label>

    <label class="flex flex-col gap-1">
      Density — {selectedLayer?.name ?? selectedSlot.name}
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

    <div class="flex flex-col gap-1">
      <span class="text-xs text-text-secondary">Deformers — {selectedLayer?.name ?? selectedSlot.name}</span>
      <p class="text-xs text-text-muted">Uncheck a bone to exclude it from this layer. Reach still limits how far each included bone reaches.</p>
      {#if bindableBones.length === 0}
        <p class="text-xs text-text-muted">No bones yet.</p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each bindableBones as bone (bone.name)}
            <li>
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={bindIncluded.has(bone.name)}
                  onchange={(e) => onBindToggle(bone.name, (e.target as HTMLInputElement).checked)}
                />
                {bone.name}
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <p class="text-xs text-text-muted">Select a layer or a bone.</p>
  {/if}
</div>
