# Editor Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One editor shell — drawings/bones/meshes as independent overlays, layer list always visible, inspector showing one subject, bind checkboxes gone, bone edits on the undo stack.

**Architecture:** Overlay visibility is three `ui` flags plus a pure `overlayFlags` mapping. App always docks LayerPanel above a new Inspector; the bone tool no longer swaps the right column. Bone/layer graph edits snapshot through `snapshotRig`/`pushRigCommand` so a drag is one undo step. Canvas redraw walks the whole document instead of a field list.

**Tech Stack:** Svelte 5 runes, Vite 8, Tailwind 4, TypeScript 5.9, Vitest 4, `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-08-23-editor-shell-design.md`

## Global Constraints

- Never modify `src/export/spine-json.ts` or anything under `src/core/`.
- Do not add `sortablejs`. Grip + existing HTML5 drag only.
- Do not add bind-checkbox UI, a Drawing/Rig tree, a pose tool, select/transform, or a `Slot.bone` dropdown.
- `doc.binds` stays in the document; `deriveSlot` / `bindNamesFor` keep honouring a stored non-empty list. No control writes `setBind`.
- Faint bones stay `globalAlpha = 0.35`.
- `npm test` starts at 66 passing. `npm run check` must report 0 errors, 0 warnings after every task.
- No `neutral-*` Tailwind classes. `grep -r "neutral-" src/` must return empty.
- Start any dev server yourself and stop it by its own PID. Never `pkill -f vite`.
- Browser verification drives real pointer events, not a single synthetic call of a redraw helper.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/state/ui.svelte.ts` | `showDrawings`, `showMeshes`; `overlayFlags` takes meshes | 1 |
| `src/state/__tests__/ui.test.ts` | overlay flag mapping | 1 |
| `src/lib/Toolbar.svelte` | three visibility toggles replace the single eye | 2 |
| `src/lib/Canvas.svelte` | drawings skip, overlay args, stringify `$effect`, empty-click, drag undo, Delete key | 2, 3, 5 |
| `src/App.svelte` | always layer list + inspector, stacked | 3 |
| `src/lib/Inspector.svelte` | **new** — one subject, no binds | 3, 5 |
| `src/lib/RigPanel.svelte` | **delete** | 3 |
| `src/lib/LayerPanel.svelte` | layer click clears bone; grip is the only drag handle | 3, 4 |
| `src/state/doc.svelte.ts` | layer-order undo; `snapshotRig` / `pushRigCommand` | 4, 5 |
| `src/state/__tests__/doc.svelte.test.ts` | rig snapshot undo | 5 |

---

### Task 1: Overlay flags

**Files:**
- Modify: `src/state/ui.svelte.ts`
- Test: `src/state/__tests__/ui.test.ts`

**Interfaces:**
- Consumes: existing `Tool`, `isPaintTool`, `OverlayFlags` (same five fields).
- Produces: `ui.showDrawings: boolean` default `true`; `ui.showMeshes: boolean` default `false`; `ui.showBones` unchanged default `true`. `export function overlayFlags(tool: Tool, showBones: boolean, showMeshes = false): OverlayFlags`. `showDrawings` is **not** an overlay flag — Canvas compositing, Task 2.

The third argument defaults so Canvas still compiles until Task 2 passes `ui.showMeshes` explicitly.

- [ ] **Step 1: Write the failing tests**

Replace the `overlayFlags` describe in `src/state/__tests__/ui.test.ts` (keep the `isPaintTool` describe) with:

```ts
import { overlayFlags } from "../ui.svelte";

describe("overlayFlags", () => {
  it("shows faint bones and no mesh under a paint tool when meshes are off", () => {
    expect(overlayFlags("brush", true, false)).toEqual({
      bones: true, faint: true, mesh: false, tint: false, capsule: false,
    });
  });

  it("shows mesh wireframes under a paint tool when meshes are on, but not tint or capsule", () => {
    expect(overlayFlags("brush", true, true)).toEqual({
      bones: true, faint: true, mesh: true, tint: false, capsule: false,
    });
  });

  it("bone tool shows bones even when the bones toggle is off", () => {
    expect(overlayFlags("bone", false, false).bones).toBe(true);
    expect(overlayFlags("brush", false, false).bones).toBe(false);
  });

  it("bone tool does not imply mesh — that is the meshes toggle", () => {
    expect(overlayFlags("bone", true, false)).toEqual({
      bones: true, faint: false, mesh: false, tint: true, capsule: true,
    });
    expect(overlayFlags("bone", true, true).mesh).toBe(true);
  });

  it("tint and capsule are bone-tool chrome, independent of the meshes toggle", () => {
    for (const meshes of [true, false]) {
      const paint = overlayFlags("fill", true, meshes);
      expect(paint.tint).toBe(false);
      expect(paint.capsule).toBe(false);
      const bone = overlayFlags("bone", true, meshes);
      expect(bone.tint).toBe(true);
      expect(bone.capsule).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/__tests__/ui.test.ts`
Expected: FAIL — `overlayFlags("bone", true, false).mesh` is `true` today (function ignores the third arg; mesh follows the bone tool).

- [ ] **Step 3: Implement**

In `src/state/ui.svelte.ts`, add the two flags next to `showBones`:

```ts
  /** Draw bones on canvas regardless of the active tool. Faint under a paint tool (see
   *  RigOverlay's flags), full opacity under the bone tool. The bone tool still draws bones
   *  when this is false — you cannot edit what you cannot see. */
  showBones: true,
  /** Draw layer pixels. Per-layer eyes still apply when this is on. */
  showDrawings: true,
  /** Draw mesh wireframes. Independent of the tool. Default off. */
  showMeshes: false,
```

Replace `overlayFlags`:

```ts
/** What the rig overlay draws, given the active tool and the visibility toggles. Pure. */
export function overlayFlags(tool: Tool, showBones: boolean, showMeshes = false): OverlayFlags {
  const rigging = tool === "bone";
  return {
    bones: rigging || showBones,
    faint: !rigging,
    mesh: showMeshes,
    tint: rigging,
    capsule: rigging,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/__tests__/ui.test.ts && npm test && npm run check`
Expected: all pass; 0 check errors. Suite is 67 tests (was 66; this file is 3 isPaintTool + 5 overlayFlags, was 7).

- [ ] **Step 5: Commit**

```bash
git add src/state/ui.svelte.ts src/state/__tests__/ui.test.ts
git commit -m "feat: drawings/meshes visibility flags; mesh is no longer implied by the bone tool"
```

---

### Task 2: Toolbar toggles and canvas compositing

**Files:**
- Modify: `src/lib/Toolbar.svelte`
- Modify: `src/lib/Canvas.svelte`

**Interfaces:**
- Consumes: `ui.showDrawings`, `ui.showBones`, `ui.showMeshes`; `overlayFlags(tool, showBones, showMeshes)`.
- Produces: toolbar writes the three flags; Canvas skips layer pixels when `showDrawings` is false; `overlayFlags` is called with all three; `$effect` walks `JSON.stringify(doc)` plus UI flags.

- [ ] **Step 1: Toolbar — replace the single eye**

In `src/lib/Toolbar.svelte`, add lucide imports `Image` and `Grid3x3` (keep `Bone`; drop `Eye` and `EyeOff` if nothing else uses them).

Replace the single-eye group (the `div` whose button toggles `ui.showBones`) with:

```svelte
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
```

This group sits next to the tool group, where the eye was.

- [ ] **Step 2: Canvas redraw — drawings, flags, `$effect`**

In `src/lib/Canvas.svelte` `redraw()`:

Around the layer loop (`for (const layer of doc.layers)`), gate the whole loop on `ui.showDrawings`. Checkerboard page still draws. Pose-warp is inside that loop, so hidden drawings do not warp either.

Change the overlay call:

```ts
    const flags = overlayFlags(ui.tool, ui.showBones, ui.showMeshes);
```

Keep the derive skip as `flags.mesh || flags.tint` — tint still needs a mesh under the bone tool even when wireframes are off.

Replace the `$effect` body with:

```ts
  $effect(() => {
    JSON.stringify(doc);
    void ui.tool;
    void ui.showBones;
    void ui.showDrawings;
    void ui.showMeshes;
    void ui.selectedBone;
    void ui.selectedLayerId;
    void poseDrag;
    void size.width;
    void size.height;
    redraw();
  });
```

Delete the hand-maintained `doc.layers.map`, `doc.density`, and `JSON.stringify(doc.bones)` reads. `layer.canvas` still stringifies as `{}`; pixels stay on `layer.revision`.

- [ ] **Step 3: Tests and check**

Run: `npm test && npm run check`
Expected: 67 passing, 0 check errors. No new unit tests — overlayFlags already covers the mapping.

- [ ] **Step 4: Browser check**

Start vite yourself (`npm run dev`), drive real clicks:

1. Paint a stroke. Toggle drawings off — stroke disappears; checkerboard remains. Toggle on — stroke returns.
2. Bones toggle off under brush — bones gone. Switch to bone tool — bones reappear (exception). Toggle bones off under bone tool — bones still there.
3. Meshes toggle on under brush — wireframes appear without switching tool. Toggle off — gone.
4. Under bone tool, meshes off: weight tint and reach handle still appear for a selected bone; no wireframe.
5. Drag a bone, then a density slider (still on RigPanel this task) — overlay updates without a second nudge. The `$effect` walk is what this is proving.

Stop vite by its own PID.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Toolbar.svelte src/lib/Canvas.svelte
git commit -m "feat: three visibility toggles; canvas redraw walks the whole document"
```

---

### Task 3: Layer list stays; inspector is one subject

**Files:**
- Create: `src/lib/Inspector.svelte`
- Modify: `src/App.svelte`
- Modify: `src/lib/LayerPanel.svelte`
- Modify: `src/lib/Canvas.svelte`
- Delete: `src/lib/RigPanel.svelte`

**Interfaces:**
- Consumes: `ui.selectedBone`, `ui.selectedLayerId`; existing `setWobble`, `renameBone`, `removeBone`, `setParent`, `descendantsOf`, `setSlotDensity`.
- Produces: App docks layers above inspector always. Inspector: bone if `selectedBone` set, else layer if `selectedLayerId` set, else blank. Layer click clears `selectedBone`. Empty-canvas bone-tool click clears `selectedBone`. No bind checkboxes. `setBind` is not called from any `.svelte` file.

- [ ] **Step 1: Create `src/lib/Inspector.svelte`**

```svelte
<script lang="ts">
  import {
    document as doc,
    setWobble,
    setSlotDensity,
    renameBone,
    removeBone,
    setParent,
    descendantsOf,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";

  let selectedSlot = $derived(doc.slots.find((s) => s.layerId === ui.selectedLayerId) ?? null);
  let effectiveDensity = $derived(selectedSlot ? (selectedSlot.density ?? doc.density) : doc.density);
  let hasDensityOverride = $derived(selectedSlot?.density !== undefined);
  let selectedBone = $derived(doc.bones.find((b) => b.name === ui.selectedBone) ?? null);
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
  function onDensityInput(e: Event) {
    if (!selectedSlot) return;
    setSlotDensity(selectedSlot.name, Number((e.target as HTMLInputElement).value));
  }
  function resetDensity() {
    if (selectedSlot) setSlotDensity(selectedSlot.name, undefined);
  }
  function commitName() {
    if (!selectedBone) return;
    const bone = selectedBone;
    const oldName = bone.name;
    renameBone(oldName, nameDraft);
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
        <input type="range" min="0" max="1" step="0.01" value={selectedBone.wobble} oninput={onWobbleInput} />
        <span class="w-8 text-right font-mono text-xs">{selectedBone.wobble.toFixed(2)}</span>
      </div>
    </label>
  {:else if selectedSlot}
    <label class="flex flex-col gap-1">
      Density — {selectedSlot.name}
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
  {:else}
    <p class="text-xs text-text-muted">Select a layer or a bone.</p>
  {/if}
</div>
```

No bind list. Density only when a layer is the inspector subject (`selectedBone` is null). Document-wide density is not a control.

- [ ] **Step 2: App layout**

Replace `src/App.svelte` script imports: drop `RigPanel`, add `Inspector`. Replace the right column:

```svelte
    <div class="flex w-56 flex-col border-l border-border bg-surface">
      <div class="min-h-0 flex-1 overflow-hidden">
        <LayerPanel />
      </div>
      <div class="max-h-[50%] shrink-0 overflow-y-auto border-t border-border">
        <Inspector />
      </div>
    </div>
```

Delete the `{#if ui.tool === "bone"}` branch and its transitional comment.

- [ ] **Step 3: LayerPanel — chrome and click**

Strip the outer `w-56` and `border-l` from LayerPanel's root (App owns those). Keep `flex flex-col h-full bg-surface text-sm text-text` so it fills the top stack.

`onSelect` must clear the bone:

```ts
  function onSelect(layer: Layer) {
    ui.selectedLayerId = layer.id;
    ui.selectedBone = null;
  }
```

- [ ] **Step 4: Empty canvas clears the bone**

In `onRigPointerDown` in `src/lib/Canvas.svelte`, after the shift-create and alt-pose branches, the fall-through that hits no bone currently leaves `selectedBone` as-is. When `nearestBone(pt)` is null (and the reach-handle / tip hits also missed), set `ui.selectedBone = null` and return. Do not clear on shift-create or alt-pose.

- [ ] **Step 5: Delete RigPanel and fix the leftover comment**

Delete `src/lib/RigPanel.svelte`. In `src/state/doc.svelte.ts`, the `descendantsOf` doc comment names `RigPanel.svelte` — change it to `Inspector.svelte`.

`grep -n "RigPanel\\|setBind\\|Bind override" src/` must not match any `.svelte` file. `setBind` may remain in `doc.svelte.ts`.

- [ ] **Step 6: Tests and check**

Run: `npm test && npm run check`
Expected: 67 passing, 0 check errors.

- [ ] **Step 7: Browser check**

1. Brush tool: layer list is on the right. Select a layer — inspector shows density, not bone fields.
2. Switch to bone tool — layer list still there. Click a bone — inspector shows name/parent/wobble/Delete, no density, no checkboxes. Layer row stays highlighted.
3. Click a layer row — inspector returns to density; bone deselects (no selected bone highlight on canvas).
4. Bone tool, click empty canvas — inspector falls back to the selected layer.
5. `grep` from Step 5 is clean.

Stop vite by its own PID.

- [ ] **Step 8: Commit**

```bash
git add src/App.svelte src/lib/Inspector.svelte src/lib/LayerPanel.svelte src/lib/Canvas.svelte src/state/doc.svelte.ts
git rm src/lib/RigPanel.svelte
git commit -m "feat: stacked layers + inspector; bind checkboxes leave the UI"
```

---

### Task 4: Grip-drag and layer-reorder undo

**Files:**
- Modify: `src/lib/LayerPanel.svelte`
- Modify: `src/state/doc.svelte.ts`

**Interfaces:**
- Consumes: existing `reorderLayer(id, index)`.
- Produces: only the grip is `draggable`. `reorderLayer` pushes one history command per actual order change. Opacity slider is not a drag handle.

- [ ] **Step 1: `reorderLayer` becomes undoable**

In `src/state/doc.svelte.ts`, keep the splice, then push if the id order changed. Restore must **not** call `reorderLayer` (that would push again):

```ts
function applyLayerOrder(ids: number[]) {
  const byId = new Map(document.layers.map((l) => [l.id, l]));
  document.layers = ids.map((id) => byId.get(id)!);
}

/** Moves the layer to array index `index` (0 = bottom of the stack). One undo step. */
export function reorderLayer(id: number, index: number) {
  const from = document.layers.findIndex((l) => l.id === id);
  if (from === -1) return;
  const before = document.layers.map((l) => l.id);
  const [layer] = document.layers.splice(from, 1);
  const clamped = Math.max(0, Math.min(index, document.layers.length));
  document.layers.splice(clamped, 0, layer);
  const after = document.layers.map((l) => l.id);
  if (before.join(",") === after.join(",")) return;
  history.push({
    undo() {
      applyLayerOrder(before);
    },
    redo() {
      applyLayerOrder(after);
    },
  });
}
```

No new unit test: `addLayer` constructs a DOM canvas, and this suite has no jsdom. Browser-check the undo.

- [ ] **Step 2: Grip is the only drag handle**

Import `GripVertical` from `@lucide/svelte`.

On the `<li>`, **remove** `draggable="true"` and `ondragstart`. Keep `ondragover` / `ondrop`.

As the first child of the row (`flex items-center` div), before the eye button:

```svelte
          <span
            draggable="true"
            class="layer-drag-handle shrink-0 cursor-grab text-text-muted"
            title="Drag to reorder"
            ondragstart={() => onDragStart(layer.id)}
          >
            <GripVertical size={14} />
          </span>
```

Leave `onDrop` / `onDragOver` as they are — they already call `reorderLayer`.

- [ ] **Step 3: Tests and check**

Run: `npm test && npm run check`
Expected: 67 passing, 0 check errors.

- [ ] **Step 4: Browser check**

1. Drag the opacity slider — opacity changes, the row does not move.
2. Drag the grip — row reorders. Undo once — original order. Redo — reordered again.
3. Name, eye, delete, clear still work.

Stop vite by its own PID.

- [ ] **Step 5: Commit**

```bash
git add src/lib/LayerPanel.svelte src/state/doc.svelte.ts
git commit -m "fix: layer grip so opacity can drag; reorder is one undo step"
```

---

### Task 5: Bone undo, coalesced drags, Delete key

**Files:**
- Modify: `src/state/doc.svelte.ts`
- Modify: `src/state/__tests__/doc.svelte.test.ts`
- Modify: `src/lib/Canvas.svelte`
- Modify: `src/lib/Inspector.svelte`

**Interfaces:**
- Consumes: existing bone mutators (`addBone`, `moveBone`, `setBoneLength`, `setBoneRotation`, `removeBone`, `setParent`, `renameBone`, `setWobble`, `setReach`) — they stay push-free primitives.
- Produces:

```ts
export interface RigSnapshot {
  bones: Bone[];
  binds: Bind[];
  slots: Slot[];
}
export function snapshotRig(): RigSnapshot;
export function applyRig(snap: RigSnapshot): void;
export function pushRigCommand(before: RigSnapshot, after: RigSnapshot): void;
```

`pushRigCommand` no-ops when `JSON.stringify(before) === JSON.stringify(after)`. `applyRig` clones into `document` and calls `invalidate()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/state/__tests__/doc.svelte.test.ts`:

```ts
import { snapshotRig, applyRig, pushRigCommand, addBone, moveBone, document } from "../doc.svelte";
import { history } from "../history.svelte";

describe("snapshotRig", () => {
  it("round-trips bones binds and slots, and undo restores a move", () => {
    const start = snapshotRig();
    const name = addBone("root", 10, 20)!;
    moveBone(name, 50, 60);
    const mid = snapshotRig();
    expect(document.bones.find((b) => b.name === name)?.x).toBe(50);

    applyRig(start);
    expect(document.bones.some((b) => b.name === name)).toBe(false);

    applyRig(mid);
    expect(document.bones.find((b) => b.name === name)?.x).toBe(50);

    applyRig(start);
  });

  it("pushRigCommand undoes and redoes, and ignores identical snapshots", () => {
    history.clear();
    const before = snapshotRig();
    const name = addBone("root", 0, 0)!;
    pushRigCommand(before, snapshotRig());
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(document.bones.some((b) => b.name === name)).toBe(false);

    history.redo();
    expect(document.bones.some((b) => b.name === name)).toBe(true);

    const same = snapshotRig();
    pushRigCommand(same, snapshotRig());
    history.undo(); // the add, not a no-op
    expect(document.bones.some((b) => b.name === name)).toBe(false);

    history.clear();
    applyRig(before);
  });
});
```

Do **not** call `loadDocument(emptyDocument())` unless you also create canvases — `emptyDocument()` has no layers, so it is safe if used, but these tests snapshot/restore the live module document instead. The `applyRig(start)` / `applyRig(before)` at the end of each test puts bones back so the existing `setBoneLength` test is not poisoned if order changes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/__tests__/doc.svelte.test.ts`
Expected: FAIL — `snapshotRig` is not exported.

- [ ] **Step 3: Implement snapshot helpers**

Add to `src/state/doc.svelte.ts` (need `Bind` and `Slot` on the existing `document.ts` import):

```ts
export interface RigSnapshot {
  bones: Bone[];
  binds: Bind[];
  slots: Slot[];
}

export function snapshotRig(): RigSnapshot {
  return {
    bones: document.bones.map((b) => ({ ...b })),
    binds: document.binds.map((b) => ({ slot: b.slot, bones: [...b.bones] })),
    slots: document.slots.map((s) => ({ ...s })),
  };
}

export function applyRig(snap: RigSnapshot) {
  document.bones = snap.bones.map((b) => ({ ...b }));
  document.binds = snap.binds.map((b) => ({ slot: b.slot, bones: [...b.bones] }));
  document.slots = snap.slots.map((s) => ({ ...s }));
  invalidate();
}

export function pushRigCommand(before: RigSnapshot, after: RigSnapshot) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  history.push({
    undo() {
      applyRig(before);
    },
    redo() {
      applyRig(after);
    },
  });
}
```

- [ ] **Step 4: Run snapshot tests**

Run: `npx vitest run src/state/__tests__/doc.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Coalesce canvas bone drags**

In `src/lib/Canvas.svelte`, import `snapshotRig`, `pushRigCommand`.

Add `let rigDragBefore: RigSnapshot | null = null;` next to `dragState`.

In `onRigPointerDown`:

- Shift-create: `rigDragBefore = snapshotRig()` **before** `addBone`.
- Move / length / reach: `rigDragBefore = snapshotRig()` when that drag starts (after hit-test succeeds).
- Alt-pose: do **not** set `rigDragBefore` (pose is not stored).
- Empty-canvas clear (Task 3): do not snapshot.

In `onRigPointerUp`, after the existing reach-seed block, before clearing `dragState`:

```ts
    if (rigDragBefore) {
      pushRigCommand(rigDragBefore, snapshotRig());
      rigDragBefore = null;
    }
```

A select-without-move snapshots equal values and `pushRigCommand` no-ops.

- [ ] **Step 6: Inspector discrete edits and wobble coalesce**

In `src/lib/Inspector.svelte`, import `snapshotRig`, `pushRigCommand`.

Wrap `commitName`, `onDeleteBone`, `onParentChange`:

```ts
    const before = snapshotRig();
    // existing mutate
    pushRigCommand(before, snapshotRig());
```

For wobble, one command per pointer gesture:

```ts
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
```

On the wobble `<input type="range">`: `onpointerdown={onWobblePointerDown}` `onpointerup={onWobblePointerUp}` `oninput={onWobbleInput}`.

- [ ] **Step 7: Delete / Backspace**

In `onKeyDown` in `src/lib/Canvas.svelte`, extend the existing input guard to also skip `SELECT`:

```ts
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
```

After the tool-key block, still inside the same function:

```ts
    if ((e.key === "Backspace" || e.key === "Delete") && ui.selectedBone) {
      e.preventDefault();
      const before = snapshotRig();
      removeBone(ui.selectedBone);
      ui.selectedBone = null;
      pushRigCommand(before, snapshotRig());
    }
```

Import `removeBone` if Canvas does not already (it currently imports `addBone`, `moveBone`, `setBoneLength`, `setBoneRotation`, `setReach`, `descendantsOf`).

- [ ] **Step 8: Tests and check**

Run: `npm test && npm run check`
Expected: 69 passing (67 + 2 snapshot tests), 0 check errors.

- [ ] **Step 9: Browser check**

1. Shift-drag a bone into existence. Undo once — bone gone (length, rotation, reach seed all in that one step). Redo — bone back at final length.
2. Drag a bone across the canvas. Undo once — whole drag reverts, not a single pointermove.
3. Delete key with a bone selected — bone and children gone. Undo restores them. Typing in the name field, then Delete, edits the text, does not delete the bone.
4. Inspector Delete button: same as the key.
5. Drag wobble; undo once — wobble restores to the pre-drag value.
6. Rename and reparent each undo in one step.
7. Alt-drag pose, release, undo — does **not** consume an undo step (pose is not stored).

Stop vite by its own PID.

- [ ] **Step 10: Commit**

```bash
git add src/state/doc.svelte.ts src/state/__tests__/doc.svelte.test.ts src/lib/Canvas.svelte src/lib/Inspector.svelte
git commit -m "feat: bone edits are undoable; Delete removes the selected bone"
```

---

## Self-review (spec coverage)

| Spec item | Task |
|---|---|
| `showDrawings` / `showBones` / `showMeshes` defaults | 1 |
| Bone-tool still draws bones when toggle off | 1, 2 |
| Meshes follow the toggle under every tool; default off | 1, 2 |
| Tint + reach capsule are bone-tool chrome | 1 |
| Derive when mesh or tint; skip for bones-only | 2 |
| `$effect` walks the whole document | 2 |
| Stacked layer list + inspector; no panel swap | 3 |
| Inspector infers bone vs layer; layer click clears bone | 3 |
| Empty canvas clears bone | 3 |
| Layer density override + reset; no document-default control | 3 |
| Bind checkboxes gone; `doc.binds` still honoured | 3 |
| Grip-only drag; opacity works | 4 |
| Layer reorder one undo step | 4 |
| `snapshotRig` / coalesced bone drags / create+reach one step | 5 |
| Wobble coalesced; pose not recorded | 5 |
| Delete / Backspace, skip text fields | 5 |
| Out of scope (tree, pose tool, select, `Slot.bone`, export guard) | no task |

No placeholders. Signatures in Task 5 match the helpers Task 5's tests import. `overlayFlags` third arg is `showMeshes` everywhere after Task 2.
