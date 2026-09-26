<script lang="ts">
  import { sliderFill } from "./slider-fill";
  import {
    document as doc,
    setWobble,
    setWobbleMove,
    setSlotDensity,
    setSlotBone,
    renameBone,
    deleteBone,
    dissolveBone,
    setParent,
    descendantsOf,
    snapshotRig,
    pushRigCommand,
    setBind,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import { bindListAfterToggle } from "../rig/derive";
  import { Trash2, FoldVertical } from "@lucide/svelte";

  let selectedSlot = $derived(doc.slots.find((s) => s.layerId === ui.selectedLayerId) ?? null);
  let effectiveDensity = $derived(
    selectedSlot ? (selectedSlot.density ?? doc.density) : doc.density,
  );
  let hasDensityOverride = $derived(selectedSlot?.density !== undefined);
  let selectedBone = $derived(doc.bones.find((b) => b.name === ui.selectedBone) ?? null);
  let invalidParents = $derived(
    selectedBone
      ? new Set([selectedBone.name, ...descendantsOf(selectedBone.name).map((b) => b.name)])
      : new Set<string>(),
  );
  let parentOptions = $derived(doc.bones.filter((b) => !invalidParents.has(b.name)));
  let bindableBones = $derived(doc.bones.filter((b) => b.name !== "root"));
  let storedBinds = $derived(
    selectedSlot ? (doc.binds.find((b) => b.slot === selectedSlot!.name)?.bones ?? []) : [],
  );
  let bindIncluded = $derived(
    new Set(storedBinds.length ? storedBinds : bindableBones.map((b) => b.name)),
  );

  // Writable $derived: resets to the selected bone's name whenever the selection changes, but
  // typing still assigns over it until the next change. Same behaviour as the $state + $effect
  // pair this replaces, without the extra effect tick (svelte/prefer-writable-derived).
  let nameDraft = $derived(selectedBone?.name ?? "");

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
    if (selectedBone) deleteBone(selectedBone.name);
  }
  function onParentChange(e: Event) {
    if (selectedBone) {
      const before = snapshotRig();
      setParent(selectedBone.name, (e.target as HTMLSelectElement).value);
      pushRigCommand(before, snapshotRig());
    }
  }
</script>

<!-- The header is the Layers header's twin (flat 40px bar, same type, border below, actions at the
     right), so the dock's two panels speak one language. What separates them is the raised grip
     band above this panel (App.svelte), as slop-vector-editor's divider. The title names the
     kind being inspected, not its name (which the list row or the Name field already shows). Fields in one two-column grid. -->
<div class="flex h-full min-h-0 flex-col text-xs text-text-secondary">
  <div
    class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-bar px-2.5 text-xs font-semibold text-text-secondary"
  >
    <!-- The kind only: the layer's name is on its selected row just above, and the bone's is in
         the Name field below, so repeating it here said it three times. -->
    <span>{selectedBone ? "Bone" : selectedSlot ? "Layer" : "Inspector"}</span>
    {#if selectedBone}
      <!-- root can't be removed or dissolved (removeBone/dissolveBone refuse it), so the buttons
           say so rather than look clickable and do nothing. -->
      {@const isRoot = selectedBone.name === "root"}
      <div class="flex shrink-0 items-center gap-1">
        <button
          class="flex size-7 cursor-pointer items-center justify-center rounded text-text-secondary hover:bg-surface-hover aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
          onclick={() => {
            if (!isRoot) onDeleteBone();
          }}
          aria-disabled={isRoot}
          title={isRoot ? "The root bone cannot be deleted" : "Delete bone and its children (Del)"}
          aria-label="Delete bone and its children"
        >
          <Trash2 size={16} />
        </button>
        <button
          class="flex size-7 cursor-pointer items-center justify-center rounded text-text-secondary hover:bg-surface-hover aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
          onclick={() => {
            if (!isRoot) dissolveBone(selectedBone.name);
          }}
          aria-disabled={isRoot}
          title={isRoot
            ? "The root bone cannot be dissolved"
            : "Dissolve — remove this bone but keep its children, hung on its parent"}
          aria-label="Dissolve bone, keeping its children"
        >
          <FoldVertical size={16} />
        </button>
      </div>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
    {#if selectedBone}
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <label for="inspector-bone-name">Name</label>
        <input
          id="inspector-bone-name"
          class="h-7 min-w-0 rounded-md border border-border bg-surface-raised px-2 text-xs text-text"
          bind:value={nameDraft}
          onblur={commitName}
          onkeydown={(e) => e.key === "Enter" && commitName()}
        />

        <label for="inspector-bone-parent">Parent</label>
        <select
          id="inspector-bone-parent"
          class="h-7 min-w-0 rounded-md border border-border bg-surface-raised px-2 text-xs text-text"
          value={selectedBone.parent}
          onchange={onParentChange}
        >
          {#each parentOptions as bone (bone.name)}
            <option value={bone.name}>{bone.name}</option>
          {/each}
        </select>

        <span>Wobble</span>
        <div class="flex min-w-0 items-center gap-2">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="min-w-0 flex-1"
            aria-label="Wobble"
            style={sliderFill(selectedBone.wobble, 0, 1)}
            value={selectedBone.wobble}
            onpointerdown={onWobblePointerDown}
            onpointerup={onWobblePointerUp}
            oninput={onWobbleInput}
          />
          <span class="w-8 text-right text-[11px] text-text-muted"
            >{selectedBone.wobble.toFixed(2)}</span
          >
        </div>

        <span></span>
        <label
          class="flex items-center gap-1.5"
          title="Off: rotation only (default). On: also lag position."
        >
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
      </div>
    {:else if selectedSlot}
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <label for="inspector-hangs-from">Hangs from</label>
        <select
          id="inspector-hangs-from"
          class="h-7 min-w-0 rounded-md border border-border bg-surface-raised px-2 text-xs text-text"
          value={selectedSlot.bone}
          onchange={onHangFrom}
        >
          {#each doc.bones as bone (bone.name)}
            <option value={bone.name}>{bone.name}</option>
          {/each}
        </select>

        <span>Density</span>
        <div class="flex min-w-0 items-center gap-2">
          <input
            type="range"
            min="8"
            max="96"
            class="min-w-0 flex-1"
            aria-label="Mesh density"
            style={sliderFill(effectiveDensity, 8, 96)}
            value={effectiveDensity}
            oninput={onDensityInput}
          />
          <span class="w-6 text-right text-[11px] text-text-muted">{effectiveDensity}</span>
          {#if hasDensityOverride}
            <button
              class="shrink-0 text-text-muted hover:text-text"
              onclick={resetDensity}
              title="Reset to document default"
            >
              ↺
            </button>
          {/if}
        </div>

        <!-- Full-width divider row, as vector-editor's section headings inside its field grid. -->
        <span
          class="col-span-2 mt-1 border-t border-border pt-2.5 text-[11px] font-medium tracking-wide uppercase"
          >Deformers</span
        >
        <p class="col-span-2 text-text-muted">
          Uncheck a bone to exclude it from this layer. Reach still limits how far each included
          bone reaches.
        </p>
        {#if bindableBones.length === 0}
          <p class="col-span-2 text-text-muted">No bones yet.</p>
        {:else}
          <ul class="col-span-2 flex flex-col gap-1">
            {#each bindableBones as bone (bone.name)}
              <li>
                <label class="flex items-center gap-1.5 text-text">
                  <input
                    type="checkbox"
                    checked={bindIncluded.has(bone.name)}
                    onchange={(e) =>
                      onBindToggle(bone.name, (e.target as HTMLInputElement).checked)}
                  />
                  {bone.name}
                </label>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else}
      <p class="text-text-muted">Select a layer or a bone.</p>
    {/if}
  </div>
</div>
