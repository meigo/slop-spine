# Unified draw/rig view — design

**Status:** approved for implementation, increment 1 of 2.
**Predecessor:** `2026-08-23-influence-regions-design.md`.

## The problem

The app's claim is that you can draw and rig in one document, redraw a limb after rigging, and
nothing needs repairing. But you must switch modes to find out whether the redraw fixed the weights.
The mode switch is friction on precisely the loop the project exists for — and it is why the weight
bleed screenshot took two increments to become visible.

`ui.mode` is also vestigial. It is consulted in nine places and only three are behavioural. It was
introduced in v1's Task 8, *before* Task 9 added brush/eraser/fill — at the time "draw" really was
one behaviour. Draw mode now holds three tools that each mean something different on click; adding
`bone` is the same pattern, not a new one. Moho works this way: the tool is the mode.

## The destination (both increments)

One tree panel with a toggle: **Drawing** lists layers as they are today; **Rig** lists the bone
hierarchy plus the meshes. One inspector underneath showing properties for whatever is selected —
layer, bone, or mesh. Bones are picked on canvas as the primary gesture; the tree exists for what
canvas-picking is bad at: seeing the hierarchy, reparenting, grabbing a bone buried under art.

Two decisions fix the shape:

**The toggle filters the tree only, never the canvas.** Bones stay drawn and clickable, the warp
preview stays live, and brush strokes still land while the tree shows Rig. A toggle that gated the
canvas would be the mode switch under a new name.

**Selection is shared.** A layer and its mesh are one subject seen two ways, so selecting the arm
layer in Drawing leaves the arm mesh selected in Rig. The toggle is a lens, not a context switch.

Meshes get their own rows because slot properties — density, the bind override — belong to the slot,
not to the layer or the bone. Today they are reached obliquely by selecting a layer while in rig
mode, which is why they have felt homeless.

Moho's bone-layer-as-parent is not modelled: slop-spine has exactly one skeleton and one layer
stack, so that group would always contain one thing.

## Increment 1: tools replace modes

Scoped deliberately narrow. It delivers the whole complaint — redraw a limb and watch the weights
update without leaving what you are doing — while leaving both panels untouched, so the subtle
pointer work gets exercised in real use before a panel rewrite lands on top of it.

### State

`ui.mode` is deleted. `Tool` becomes `"brush" | "eraser" | "fill" | "bone"`. One new flag,
`ui.showBones`, defaults true. `ui` is not part of the saved document, so there is no migration and
no project-file change.

### Canvas dispatch

Three predicates change. Nothing structural: both pointer handlers already attach to the same canvas
element and each no-ops when it is not its turn, which is exactly the dispatch a tool-based design
needs.

| Site | Today | Becomes |
|---|---|---|
| `draw-dispatch.ts:145` | `ui.mode !== "draw"` | `!isPaintTool(ui.tool)` |
| `Canvas.svelte:339` | `ui.mode !== "rig"` | `ui.tool !== "bone"` |
| `Canvas.svelte:113` | `ui.mode === "rig"` | see overlay, below |
| `Canvas.svelte:146` | `void ui.mode` | `void ui.tool; void ui.showBones` |

`isPaintTool(tool)` is a pure predicate exported from `src/state/ui.svelte.ts` beside the `Tool`
type — `brush | eraser | fill` — so the two halves can never both claim a gesture, and adding a
future tool cannot silently fall into the paint branch.

The bone tool keeps every gesture it has today, unchanged: shift-drag creates, alt-drag poses, plain
drag moves, the reach handle hit-tests before the bone body, bone-end snapping as-is.

### Overlay layering

`drawRigOverlay` today draws four things as one unit, in four already-separate sequential blocks
(`RigOverlay.ts` — mesh wireframes 34-41, weight tint 43-47, bones 49-53, reach capsule 55-58). It
gains a flags argument:

- **bones** draw whenever `ui.showBones`, at `globalAlpha = 0.35` when the active tool is not
  `bone`, and at full opacity under it
- **mesh wireframe, weight tint, reach capsule** draw only under the bone tool

Bones are drawn live, not snapshotted. A snapshot needs invalidating every time a bone moves, and a
stale bone overlay while drawing is exactly this codebase's characteristic failure — valid output,
no error, wrong picture. Live costs a few dozen line segments per frame, which is nothing beside the
layer compositing already happening each redraw.

**The slot derivation must be skipped when only bones are shown.** The block at `Canvas.svelte:113`
currently derives every visible layer's mesh and weights before drawing. Under a paint tool that
work is pure waste on every brush frame, so the bones-only path must pass no slots at all rather
than derive them and let the flags discard the result.

### Toolbar

The Draw/Rig buttons are removed. `bone` joins the existing tool row as a fourth button. The
brush/size/opacity row, gated on `ui.mode === "draw"` at `Toolbar.svelte:195`, gates on
`isPaintTool` instead. The bone-visibility toggle sits beside the tool row.

### The transitional half-state

`App.svelte:51` picks the panel by mode. It will pick by tool: bone tool shows `RigPanel`, anything
else shows `LayerPanel`. This is mode-ish behaviour and is deliberately temporary — it keeps density
and the bind override reachable until increment 2 replaces both panels with the tree and inspector.
Recorded here so it is not mistaken for the intended end state.

### Verification

Pure and unit-tested: `isPaintTool`, and the rule mapping (tool, showBones) to overlay flags.

Everything else needs a real browser check driven through actual pointer events, not direct calls —
a per-frame handler verified by one synthetic call is how the influence-regions increment shipped a
blocker:

- a paint stroke never moves, creates, or selects a bone
- a bone gesture never paints
- pan, zoom and pinch keep working under every tool — the touch gestures live in these same handlers
- painting with `showBones` on does not derive slot meshes (the waste guard above)
- switching tools mid-gesture cannot strand a drag: releasing still ends it cleanly

### Out of scope

The tree, the inspector, meshes as selectable items, pose as its own tool, dynamics, and any change
to `src/export/spine-json.ts` or `src/core/`.

## Increment 2: the tree and inspector

Not specified here. It replaces `LayerPanel` and `RigPanel` with one tree carrying a Drawing/Rig
toggle and a shared inspector, on the selection model above. It gets its own spec once increment 1
has been used.

## Known open item, unrelated but live

`computeWeights` returns empty influences for every vertex when a document has no non-root bones,
reachable by drawing a layer and exporting before rigging — there is no export guard. Every vertex
ships `boneCount: 0` and spine-ts collapses the character to the skeleton origin. Pre-existing, needs
a behaviour decision (refuse the export, or emit an unweighted mesh), and is not part of either
increment.
