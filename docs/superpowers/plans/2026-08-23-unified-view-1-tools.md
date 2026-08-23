# Unified View, Increment 1: Tools Replace Modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `ui.mode` so drawing and rigging happen in one view, with bones visible while you paint.

**Architecture:** `ui.mode` is replaced by the existing `ui.tool`, which gains a `bone` member. Both pointer handlers already attach to the same canvas and each no-ops when it is not its turn, so this changes predicates, not structure. The rig overlay gains flags so bones can be drawn faint while painting without the mesh wireframe, weight tint, or the slot derivation that feeds them.

**Tech Stack:** Svelte 5 runes, Vite 8, Tailwind 4, TypeScript 5.9, Vitest 4, `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-08-23-unified-view-design.md`

## Global Constraints

- Never modify `src/export/spine-json.ts`. Its coordinate maths is hand-verified.
- Never modify anything under `src/core/`. That directory is shared verbatim with `slop-paint` and `slop-animator`.
- No `neutral-*` Tailwind classes anywhere. `grep -r "neutral-" src/` must return empty.
- `npm test` must pass (56 tests at plan time) and `npm run check` must report 0 errors, 0 warnings.
- Faint bones are drawn at `globalAlpha = 0.35`; full opacity under the bone tool.
- `isPaintTool` lives in `src/state/ui.svelte.ts`, beside the `Tool` type.
- The bone tool keeps every gesture it has today unchanged: shift-drag creates, alt-drag poses, plain drag moves, the reach handle hit-tests before the bone body, bone-end snapping as-is.
- Start any dev server yourself and stop it by its own PID. Never `pkill -f vite` — unrelated dev servers run on this machine.
- Browser verification must drive real pointer events. A per-frame handler verified by a single synthetic function call is how the previous increment shipped a blocker.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/state/ui.svelte.ts` | `Tool` union, `isPaintTool`, `showBones`; `mode` deleted | 1, 2 |
| `src/state/__tests__/ui.test.ts` | **new** — covers `isPaintTool` and `overlayFlags` | 1, 3 |
| `src/lib/draw-dispatch.ts` | paint gate keys on tool | 2 |
| `src/lib/Canvas.svelte` | rig gate, overlay gate, redraw deps | 2, 3 |
| `src/lib/Toolbar.svelte` | bone tool button, bone-visibility toggle, brush row gate | 2 |
| `src/App.svelte` | panel choice keys on tool (transitional) | 2 |
| `src/lib/RigOverlay.ts` | overlay flags; faint bones | 3 |

---

## Task 1: `isPaintTool` and the state shape

**Files:**
- Modify: `src/state/ui.svelte.ts`
- Test: `src/state/__tests__/ui.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `type Tool = "brush" | "eraser" | "fill" | "bone"`; `export function isPaintTool(tool: Tool): boolean`; `ui.showBones: boolean` defaulting to `true`. `ui.mode` still exists after this task and is removed in Task 2.

This task adds only. Nothing consumes the new members yet, so the app behaves exactly as before and the suite stays green.

- [ ] **Step 1: Write the failing test**

Create `src/state/__tests__/ui.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPaintTool, type Tool } from "../ui.svelte";

describe("isPaintTool", () => {
  it("is true for every tool that paints", () => {
    expect(isPaintTool("brush")).toBe(true);
    expect(isPaintTool("eraser")).toBe(true);
    expect(isPaintTool("fill")).toBe(true);
  });

  it("is false for the bone tool", () => {
    expect(isPaintTool("bone")).toBe(false);
  });

  it("classifies every member of Tool, so a new tool cannot default into painting", () => {
    // If a tool is added to the union without a decision here, this fails to compile rather than
    // silently falling into the paint branch and letting a brush stroke fire on a rig gesture.
    const all: Tool[] = ["brush", "eraser", "fill", "bone"];
    const painting = all.filter(isPaintTool);
    expect(painting).toEqual(["brush", "eraser", "fill"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/state/__tests__/ui.test.ts`
Expected: FAIL — `isPaintTool` is not exported from `../ui.svelte`.

- [ ] **Step 3: Implement**

In `src/state/ui.svelte.ts`, extend the `Tool` union and add the predicate and the flag. Leave `Mode` and `ui.mode` in place — Task 2 removes them.

```ts
export type Mode = "draw" | "rig";
export type Tool = "brush" | "eraser" | "fill" | "bone";
export type BrushType = "smooth" | "ink" | "pencil";

/** Tools that lay down pixels. The rig gestures are the complement, so a gesture can never be
 *  claimed by both halves of the canvas dispatch. Written as an explicit switch rather than an
 *  array membership test so adding a member to `Tool` is a compile error here, not a silent
 *  fall-through into painting. */
export function isPaintTool(tool: Tool): boolean {
  switch (tool) {
    case "brush":
    case "eraser":
    case "fill":
      return true;
    case "bone":
      return false;
  }
}

export const ui = $state({
  mode: "draw" as Mode,
  selectedLayerId: null as number | null,
  selectedBone: null as string | null,
  tool: "brush" as Tool,
  brushType: "smooth" as BrushType,
  brushSize: 12,
  brushOpacity: 100,
  brushValue: "#000000",
  /** Draw bones on canvas regardless of the active tool. Faint under a paint tool (see
   *  RigOverlay's flags), full opacity under the bone tool. */
  showBones: true,
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/state/__tests__/ui.test.ts` — Expected: PASS (3 tests).
Run: `npm test` — Expected: PASS, 59 total.
Run: `npm run check` — Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add the bone tool and isPaintTool to ui state"
```

---

## Task 2: Swap every mode check for a tool check, then delete the mode

**Files:**
- Modify: `src/lib/draw-dispatch.ts:145`
- Modify: `src/lib/Canvas.svelte` (rig pointer gate ~line 339, redraw deps ~line 146)
- Modify: `src/lib/Toolbar.svelte:182-195`
- Modify: `src/App.svelte:51`
- Modify: `src/state/ui.svelte.ts` (remove `Mode` and `ui.mode`)

**Interfaces:**
- Consumes: `isPaintTool(tool)` and `ui.showBones` from Task 1.
- Produces: an app with no `ui.mode`. Task 3 consumes `ui.showBones` and `ui.tool` in the overlay.

**This task must be done as one unit.** There is no ordering of these edits that leaves the app usable in between: switching the dispatch first makes the bone gestures unreachable (the toolbar still only sets `mode`), and switching the toolbar first makes the bone tool selectable but inert. Change all five files, then commit once.

The overlay gate at `Canvas.svelte:113` is deliberately left keyed to a temporary expression here and finished in Task 3 — do not add the flags argument yet.

- [ ] **Step 1: `draw-dispatch.ts` — gate painting on the tool**

Replace line 145 and its comment:

```ts
  function handleStroke(points: InputPoint[], done: boolean) {
    // The rig gestures drive their own pointer handling (see Canvas.svelte); this dispatcher only
    // draws, so it stands down for any non-painting tool.
    if (!isPaintTool(ui.tool)) return;
    if (points.length === 0) return;
```

Add `isPaintTool` to the existing import from `../state/ui.svelte`.

- [ ] **Step 2: `Canvas.svelte` — gate the rig gestures on the tool**

At the rig pointer-down guard (~line 339):

```ts
    if (ui.tool !== "bone" || e.button !== 0) return;
```

In the redraw effect (~line 146), replace `void ui.mode;` with the two new dependencies:

```ts
    void ui.tool;
    void ui.showBones;
```

At the overlay gate (~line 113), replace `if (ui.mode === "rig") {` with:

```ts
    if (ui.showBones || ui.tool === "bone") {
```

Add `isPaintTool` to the `ui.svelte` import only if you use it here; the two checks above do not need it.

- [ ] **Step 3: `Toolbar.svelte` — bone becomes a tool, mode buttons go**

Delete the Draw/Rig button group entirely (lines 181-194, the `<div>` containing both `ui.mode = ...` buttons).

Change the brush-row gate at line 195 from `{#if ui.mode === "draw"}` to `{#if isPaintTool(ui.tool)}`.

Add a fourth button to the existing tool group, after the Fill button and inside the same `<div class="flex overflow-hidden rounded border border-border">`:

```svelte
      <button
        class={toolBtn}
        class:bg-surface-active={ui.tool === "bone"}
        title="Bone"
        onclick={() => (ui.tool = "bone")}><Bone size={18} /></button
      >
```

Immediately after that tool group's closing `</div>`, add the bone-visibility toggle as its own group:

```svelte
  <div class="flex overflow-hidden rounded border border-border">
    <button
      class={toolBtn}
      class:bg-surface-active={ui.showBones}
      title={ui.showBones ? "Bones visible — click to hide" : "Bones hidden — click to show"}
      onclick={() => (ui.showBones = !ui.showBones)}
    >
      {#if ui.showBones}<Eye size={18} />{:else}<EyeOff size={18} />{/if}
    </button>
  </div>
```

Add `Bone`, `Eye`, `EyeOff` and `isPaintTool` to the existing imports. All three icons exist in the installed `@lucide/svelte`.

Note that the tool group and the bone toggle must sit *outside* the `{#if isPaintTool(ui.tool)}` block — otherwise selecting the bone tool would hide the button that switches back off it.

- [ ] **Step 4: `App.svelte` — panel follows the tool**

```svelte
    {#if ui.tool === "bone"}
      <RigPanel />
    {:else}
      <LayerPanel />
    {/if}
```

This is transitional and mode-ish on purpose: it keeps density and the bind override reachable until increment 2 replaces both panels with the tree and inspector. Leave a one-line comment saying so.

- [ ] **Step 5: `ui.svelte.ts` — delete the mode**

Remove `export type Mode = "draw" | "rig";` and the `mode: "draw" as Mode,` line from the `ui` object.

- [ ] **Step 6: Confirm the mode is gone**

Run: `grep -rn "ui.mode\|: Mode\|Mode =" src/`
Expected: no output.

Run: `npm test` — Expected: PASS, 59.
Run: `npm run check` — Expected: 0 errors, 0 warnings. A missed `ui.mode` reference fails here.
Run: `grep -r "neutral-" src/` — Expected: empty.

- [ ] **Step 7: Verify the dispatch in a real browser**

Start the dev server yourself. Note its PID and stop it by that PID when done.

These are the checks that matter, because the failure mode is silent — a gesture claimed by the wrong half produces no error:

1. With the brush tool, drag across the canvas over a bone. A stroke appears; **no bone moves, is created, or becomes selected.** Read `ui.selectedBone` and the bone's `x`/`y` before and after to prove it.
2. With the bone tool, drag across the canvas. A bone moves; **no pixels change.** Compare the layer canvas's data URL before and after to prove it.
3. With the bone tool, shift-drag to create a bone, then alt-drag to pose it. Both still work.
4. Two-finger scroll pans and ⌘/ctrl+scroll zooms **under every tool** — the touch gestures live in these same handlers and are easy to strand.
5. Select the bone tool, then switch to brush mid-gesture is not required; instead confirm that releasing the pointer after any drag leaves no drag in progress (a following click does not continue the previous drag).

Report exactly what you observed for each.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: the tool is the mode — ui.mode deleted"
```

---

## Task 3: Overlay layering and the derivation skip

**Files:**
- Modify: `src/lib/RigOverlay.ts` (`RigOverlayData`, `drawRigOverlay`)
- Modify: `src/lib/Canvas.svelte` (the overlay block ~lines 113-125)
- Test: `src/state/__tests__/ui.test.ts` (extend)

**Interfaces:**
- Consumes: `ui.tool`, `ui.showBones`, `isPaintTool` from Tasks 1-2.
- Produces: `export function overlayFlags(tool: Tool, showBones: boolean): OverlayFlags` in `src/state/ui.svelte.ts`, where `interface OverlayFlags { bones: boolean; faint: boolean; mesh: boolean; tint: boolean; capsule: boolean }`. `drawRigOverlay` takes it as a fourth argument.

- [ ] **Step 1: Write the failing test**

Append to `src/state/__tests__/ui.test.ts`:

```ts
import { overlayFlags } from "../ui.svelte";

describe("overlayFlags", () => {
  it("shows only faint bones under a paint tool", () => {
    expect(overlayFlags("brush", true)).toEqual({
      bones: true, faint: true, mesh: false, tint: false, capsule: false,
    });
  });

  it("shows everything at full opacity under the bone tool", () => {
    expect(overlayFlags("bone", true)).toEqual({
      bones: true, faint: false, mesh: true, tint: true, capsule: true,
    });
  });

  it("hides bones when the toggle is off, but the bone tool still shows its own working overlay", () => {
    // Turning bones off while holding the bone tool would leave nothing to aim at, so the tool
    // wins over the toggle. The toggle governs the other tools.
    expect(overlayFlags("brush", false).bones).toBe(false);
    expect(overlayFlags("bone", false).bones).toBe(true);
  });

  it("draws no mesh or tint under any paint tool, whatever the toggle says", () => {
    for (const showBones of [true, false]) {
      for (const tool of ["brush", "eraser", "fill"] as const) {
        const f = overlayFlags(tool, showBones);
        expect(f.mesh).toBe(false);
        expect(f.tint).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/state/__tests__/ui.test.ts`
Expected: FAIL — `overlayFlags` is not exported.

- [ ] **Step 3: Implement `overlayFlags`**

In `src/state/ui.svelte.ts`:

```ts
export interface OverlayFlags {
  bones: boolean;
  /** Draw bones at reduced alpha — a reference while painting, not the thing being edited. */
  faint: boolean;
  mesh: boolean;
  tint: boolean;
  capsule: boolean;
}

/** What the rig overlay draws, given the active tool and the bone-visibility toggle. Pure, so the
 *  rule is testable without a canvas. */
export function overlayFlags(tool: Tool, showBones: boolean): OverlayFlags {
  const rigging = tool === "bone";
  return {
    bones: rigging || showBones,
    faint: !rigging,
    mesh: rigging,
    tint: rigging,
    capsule: rigging,
  };
}
```

- [ ] **Step 4: Take the flags in `drawRigOverlay`**

In `src/lib/RigOverlay.ts`, import the type and add the parameter, then gate each of the four existing blocks. The blocks are already sequential and independent — do not reorder or restructure them.

```ts
import type { OverlayFlags } from "../state/ui.svelte";

export function drawRigOverlay(
  ctx: CanvasRenderingContext2D,
  data: RigOverlayData,
  zoom: number,
  flags: OverlayFlags,
) {
  const { bones, selectedBone, slots } = data;
  const screenPx = (px: number) => px / zoom;
```

Wrap the mesh-wireframe block (the `for (const slot of slots)` loop and the `selectedSlot` block that follows it) in `if (flags.mesh) { ... }`.

Wrap the weight-tint block (`if (selectedBone) { for (const slot of slots) ... }`) in `if (flags.tint) { ... }`.

Wrap the bone loop in `if (flags.bones) { ... }`, and set the alpha around it:

```ts
  if (flags.bones) {
    const prevAlpha = ctx.globalAlpha;
    if (flags.faint) ctx.globalAlpha = 0.35;
    for (const bone of bones) {
      // root is canvas-centre with no length — not a drawable/editable bone (see document.ts).
      if (bone.name === "root") continue;
      drawBone(ctx, bone, bone.name === selectedBone, screenPx);
    }
    ctx.globalAlpha = prevAlpha;
  }
```

Restore `globalAlpha` explicitly rather than assuming it was 1 — `redraw()` sets it while compositing layers, and leaving it lowered would silently fade everything drawn after the overlay.

Wrap the reach capsule block in `if (flags.capsule) { ... }`.

Update `RigOverlayData`'s `slots` doc comment to say it may be empty when the mesh and tint are not being drawn.

- [ ] **Step 5: Skip the slot derivation when nothing needs it**

In `src/lib/Canvas.svelte`, replace the overlay block. The point of this step is that `deriveSlot` must not run at all under a paint tool — it computes a mesh and weights for every visible layer, which would otherwise happen on every brush frame to produce output that the flags then discard.

```ts
    const flags = overlayFlags(ui.tool, ui.showBones);
    if (flags.bones || flags.mesh || flags.tint) {
      // Only derive when something that needs a mesh is actually being drawn. Under a paint tool
      // this list stays empty and deriveSlot never runs — bones alone need no mesh.
      const slots =
        flags.mesh || flags.tint
          ? doc.layers
              .filter((l) => l.visible)
              .map((l) => doc.slots.find((s) => s.layerId === l.id))
              .filter((s) => s !== undefined)
              .map((slot) => {
                const derived = deriveSlot(doc, slot.name);
                return { ...derived, selected: slot.layerId === ui.selectedLayerId };
              })
          : [];
      drawRigOverlay(ctx, { bones: doc.bones, selectedBone: ui.selectedBone, slots }, viewport.zoom, flags);
    }
```

Import `overlayFlags` from `../state/ui.svelte`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/state/__tests__/ui.test.ts` — Expected: PASS (7 tests).
Run: `npm test` — Expected: PASS, 63 total.
Run: `npm run check` — Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Verify in a real browser**

Start the dev server yourself; stop it by its own PID.

1. With the brush tool and a rig present: bones are drawn, visibly faint, and **no mesh wireframe or weight tint is visible.**
2. **Prove the derivation is skipped.** Add a temporary `console.count("deriveSlot")` at the top of `deriveSlot` in `src/rig/derive.ts`, draw a stroke of at least 30 pointer events with the brush tool, and confirm the count does not increase. Remove the instrumentation before committing and say in your report that you did.
3. Switch to the bone tool: mesh, tint and the selected bone's capsule all appear, and the bones are now full-strength.
4. Toggle bones off with a paint tool active: bones disappear. Toggle back: they return.
5. Toggle bones off, then select the bone tool: bones are still drawn (the tool wins over the toggle), so the tool remains usable.
6. Confirm nothing after the overlay is faded — with a paint tool active and bones visible, the layer art is full-strength, not dimmed. This catches a leaked `globalAlpha`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: layer the rig overlay; skip slot derivation when only bones show"
```

---

## Self-review notes

**Spec coverage.** State → T1. The three dispatch predicates, the toolbar, and the panel choice → T2. Overlay layering, faint bones, and the derivation skip → T3. Verification requirements are attached to the task that can fail them (dispatch → T2 Step 7, overlay → T3 Step 7).

**Why Task 2 is one commit and not five.** No ordering of its edits leaves a usable app in between; splitting it would produce a commit whose only honest description is "app half-broken". A reviewer either accepts the swap or rejects it.

**The trap in Task 3.** `redraw()` sets `ctx.globalAlpha` while compositing layers and resets it to 1 before the overlay. Lowering it for faint bones without restoring the previous value would dim everything drawn afterwards — a wrong picture with no error, this codebase's characteristic failure. Step 4 restores it explicitly and Step 7 check 6 is what catches it if that is missed.

**The trap in Task 2.** Placing the bone-tool button inside the `{#if isPaintTool(ui.tool)}` block would hide the control that switches back off the bone tool, stranding the user. Called out in the step.

**Deliberately excluded**, all recorded in the spec: the tree, the inspector, meshes as selectable items, pose as its own tool, and dynamics.

**Known transitional wart.** `App.svelte` picking the panel by tool is mode-ish. It is deliberate, documented in the spec and in a code comment, and it disappears in increment 2.
