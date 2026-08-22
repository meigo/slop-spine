<script lang="ts">
  import { document as doc, setWobble, setBind, renameBone, removeBone } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";

  let selectedSlot = $derived(doc.slots.find((s) => s.layerId === ui.selectedLayerId) ?? null);
  let selectedBone = $derived(doc.bones.find((b) => b.name === ui.selectedBone) ?? null);
  let bindBones = $derived(
    selectedSlot ? (doc.binds.find((b) => b.slot === selectedSlot!.name)?.bones ?? []) : [],
  );
  // root is never a valid weight influence (document.ts's defaultBind excludes it too).
  let bindableBones = $derived(doc.bones.filter((b) => b.name !== "root"));

  let nameDraft = $state("");
  $effect(() => {
    nameDraft = selectedBone?.name ?? "";
  });

  function onWobbleInput(e: Event) {
    if (selectedBone) setWobble(selectedBone.name, Number((e.target as HTMLInputElement).value));
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
</script>

<div class="flex w-56 flex-col gap-3 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-200">
  <span class="font-mono text-xs uppercase text-neutral-400">Rig</span>

  <label class="flex flex-col gap-1">
    Density
    <div class="flex items-center gap-1">
      <input type="range" min="8" max="96" bind:value={doc.density} />
      <span class="w-6 text-right font-mono text-xs">{doc.density}</span>
    </div>
  </label>

  {#if selectedBone}
    <label class="flex flex-col gap-1">
      Bone name
      <div class="flex items-center gap-1">
        <input
          class="min-w-0 flex-1 bg-neutral-950 px-1 text-neutral-200"
          bind:value={nameDraft}
          onblur={commitName}
          onkeydown={(e) => e.key === "Enter" && commitName()}
        />
        <button class="shrink-0 text-neutral-500 hover:text-neutral-200" onclick={onDeleteBone} title="Delete bone">
          ✕
        </button>
      </div>
    </label>

    <label class="flex flex-col gap-1">
      Wobble
      <div class="flex items-center gap-1">
        <input type="range" min="0" max="1" step="0.01" value={selectedBone.wobble} oninput={onWobbleInput} />
        <span class="w-8 text-right font-mono text-xs">{selectedBone.wobble.toFixed(2)}</span>
      </div>
    </label>
  {:else}
    <p class="text-xs text-neutral-500">Shift-drag from a bone (or empty canvas, for the first one) to add one.</p>
  {/if}

  {#if selectedSlot}
    <div class="flex flex-col gap-1">
      <span class="text-xs text-neutral-400">Bind — {selectedSlot.name}</span>
      {#if bindableBones.length === 0}
        <p class="text-xs text-neutral-500">No bones yet.</p>
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
    <p class="text-xs text-neutral-500">Select a layer to bind bones to it.</p>
  {/if}
</div>
