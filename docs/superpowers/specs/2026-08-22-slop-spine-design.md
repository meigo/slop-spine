# slop-spine — design

Status: approved design, 2026-08-22.

## Ethos (read this before making any decision below)

Rough, indie, deliberately imperfect. "Slop" in the name is meaningful. Imperfection gives the
output personality; overworking kills it. This is not a caveat — it is the primary constraint,
and it outranks every engineering instinct in this document.

Concretely, for anyone (human or agent) working on this:

- Ship the dumb version that mostly works. Upgrade only when a failure is **visible on screen**.
- Test only what cannot be eyeballed: pure math and file-format writers. The app is the test
  harness for everything else.
- Hardcode defaults. One slider beats seven fields.
- "Good enough that it doesn't tear" is the quality bar for the rig. Not "correct."
- If a section of this spec starts feeling thorough, that is a smell.

## What it is

A browser app where you **draw a character and rig it in the same document**, and export a
Spine 4.2 skeleton. No PSD roundtrip, no separate rigging tool.

Two exits for the same export:

1. **sloppets runtime** — `.spinejson` + `.atlas` + packed `.png`, loaded by `spine-pixi-v8`,
   driven programmatically (bones poked per frame from a phoneme/script timeline).
2. **Spine editor handoff** — the same files plus loose per-layer PNGs, for characters that
   need hand-authored animation.

Target: sloppets puppet style. Side view, ~10 bones, secondary motion from physics. Not a
general animation tool.

## Why it exists

Rigging in the Spine editor is the slow step in `slop-paint → Spine → sloppets`, and it is a
*one-way* step: once art is rigged, changing the drawing means repairing the rig. That kills
the loop the project wants — see it move, then redraw it.

The unlock is not "fewer file exports." It is that a derived rig survives redrawing, so art
stays fluid after rigging.

## Core principle: the rig is derived

```
mesh    = f(silhouette, density)
weights = f(mesh, bone segments)
```

Pure functions of things authored **visually**: the drawing, and where bones were dragged.
Redraw a layer → mesh and weights regenerate → rig still works, nothing to repair.

**The rule: nothing in the rig may be stored per-vertex.**

Spine stores a weighted mesh as a flat array — per vertex, `boneCount` then
`(boneIndex, x, y, weight)` per influence — and stores `deform` keys as float offsets addressed
by *position in that array*. In `sloppets/spine/test-char/char.json`, the Head mesh has 44
vertices, 236 array entries, 48 influences; its `mouth_y` deform key is `offset: 8` + 88 floats
= 96 = 2 × 48. The numbers mean nothing except "which slot am I in."

That indexing depends on mesh topology *and* the weight binding. Re-triangulating shifts it; so
does adding a bone, or moving one so an extra vertex falls in range — the mesh need not change
for a stored sculpt to be destroyed.

| Authored | Storage | Allowed |
|---|---|---|
| Bone name, parent, position, length | world-space scalars | yes |
| Slot → layer, draw order | names | yes |
| Physics wobble amount per bone | one scalar | yes |
| Mesh density | one parameter | yes |
| Mesh vertices dragged individually | per-vertex | no |
| Weights painted per vertex | per-vertex | no |
| Deform (sculpted mouth shapes) | index-welded | not in v1 |

The rule constrains *storage*, not control — mesh shape is tunable by parameter, which survives
regeneration.

**Accepted cost:** when auto-weighting is wrong, the fix is upstream — move a bone, add one, or
redraw so the shapes separate. Sometimes painting three vertices would have been faster. Given
the ethos, slightly-wrong weights that don't tear are acceptable output, not a bug to chase.

**Escape hatch, deferred not forbidden:** sculpted visemes (which attachment swaps can't blend)
become compliant if stored as a **displacement field in canvas space** — a coarse dx/dy grid,
sampled at each current vertex *at export time*. Mesh-independent, so redrawing preserves it.
Out of v1 because it's the largest UI chunk here. v1 does mouths as bone motion plus attachment
swap, cheap now that drawing lives in the same app.

## Architecture

### Document model

```
RigDocument
  canvas    { width, height }
  layers[]  { id, name, parentId, visible, opacity, image }
  slots[]   { name, layerId, order }
  bones[]   { name, parentName, x, y, rotation, length, wobble }
  binds[]   { slotName, boneNames[] }        // defaulted, override by clicking
  density   number                            // one global value

  derived (cache; delete it and nothing is lost but recompute time)
    meshes  : slotName → { vertices, triangles, hull, uvs }
    weights : slotName → per-vertex bone influences
```

Bind default: a slot is influenced by its attached bone plus that bone's parent and children.
Override by clicking bones in rig mode. No per-slot mesh params until one character needs them.

Physics: the existing rig uses identical values everywhere (`inertia 0.5, damping 0.85`).
Hardcode those; `wobble` is one 0..1 scalar per bone that scales them, 0 = no physics.

### Invalidation

| Edit | Invalidates |
|---|---|
| Draw on a layer | that slot's mesh → its weights |
| Change density | all meshes → all weights |
| Move/add/remove/rename a bone | weights of slots bound to it |
| Reorder slots, toggle visibility | nothing |

Recompute per-slot on idle after an edit settles. Meshes are tens of vertices; no incremental
machinery.

### Persistence

IndexedDB autosave plus a zipped project file (`fflate`), copied from slop-animator's
`src/persist/`.

## What is reused

Same stack already (Svelte 5.55, Vite 8, Tailwind 4, TS 5.9, Vitest 4, perfect-freehand,
lucide, sortablejs), so copies drop in. From `slop-animator/src/core/`:

| Module | Lines | Use |
|---|---|---|
| `brush.ts`, `ink-brush.ts`, `stamp-brush.ts`, `brush-textures.ts` | ~1.5k | drawing |
| `input.ts`, `touch-gestures.ts`, `pressure-curve.ts` | ~700 | pointer, pressure, iPad |
| `viewport.ts`, `viewport-fit.ts` | ~300 | pan / zoom |
| `fill.ts`, `fill-holes.ts`, `selection.ts`, `mask-ops.ts` | ~700 | fill, lasso |
| `triangulate.ts` (+ tests) | ~120 | mesh |
| `geodesic.ts`, `mls.ts` | ~185 | only if Euclidean weights visibly fail — see below |

**New app, not a fork.** slop-animator is 32.7k lines with a frame-centric document model
(`Cell`, `Track`, `Keyframe`). A RigDocument is one image per layer plus a skeleton, so the
document model gets written fresh either way; inheriting ~14k lines of timeline logic and UI to
delete is a tax. Copies are copies — if the same module gets fixed twice, *then* extract a
shared package.

## New work

### 1. Weighting — start dumb

Per mesh vertex: distance to each candidate bone's **segment**, weight = falloff on that
distance, normalize, cull below a threshold, cap at 4 influences (Spine convention).

Start with plain **Euclidean** distance. It is maybe 30 lines.

Euclidean bleeds across gaps that are near in space but far along the shape — an arm hanging
beside a hip gets hip weights. The fix is geodesic distance (Dijkstra over the mesh edge graph,
which `geodesic.ts` already implements and would need reseeding from bone segments rather than
point handles). **Do not build that until a character visibly tears.** Given the ethos, a bit of
bleed may just read as rubbery, which is fine.

### 2. Spine 4.2 JSON writer

Format 4.2 — matches the existing rig (`spine: 4.2.43`) and runtime (`spine-pixi-v8` 4.2.106).

Four details that must be right; everything else is transcription:

- **Y-flip.** Canvas is y-down, Spine is y-up.
- **Bone-local weight coords.** Each influence's `x,y` is in *that bone's* space, so every mesh
  vertex is transformed into each influencing bone's space at write time.
- **Hull first.** `hull` counts hull vertices and requires them first in the list.
  `boundaryPoints` then `interiorPoints` already yields that order — don't re-sort.
- **Physics `order`.** Parents settle before children; the existing rig orders hair → arms → head.

### 3. Atlas packer

Bin-pack trimmed layers into one page; write the `.atlas` text format (page header, then per
region `bounds` / `offsets` / `rotate`).

**Trimming is required.** Layers on a 2048² canvas are mostly transparent, so untrimmed regions
would make the atlas unusable. `offsets` is the trim record and is what lets mesh vertices stay
in canvas coordinates while UVs address a trimmed region. This is the likeliest thing to get
wrong; the round-trip below catches it.

### 4. Editor UI

Two modes over one canvas.

- **Draw** — brush, eraser, fill, lasso; layer list with reorder, rename, visibility.
- **Rig** — drag from a parent to create a child bone; click to set binds; one density slider;
  one wobble slider per bone; drag bones to check deformation live.

Mesh and weights render as an overlay in rig mode — triangles, and weight tint for the selected
bone. Seeing wrong weights is what makes the upstream fix obvious.

## Verification

The one criterion that matters:

> Draw a character in slop-spine, export it, load it in
> `sloppets/client/public/test/spine-test.html`. If the existing viseme and bone-poking code
> drives it **without modification**, the rig contract is correct.

That page expects bones `body`, `head`, `mouth`, an `eyes` slot with `Eyes open`/`Eyes closed`,
and physics on hair and arms. Conforming to it *is* "rigged for sloppets."

Automated tests, kept deliberately thin — only things you cannot see:

- Weights: sum to 1 per vertex, capped at 4 influences.
- Writer: bone-local coordinate transform round-trips.
- Packer: regions don't overlap; offsets reconstruct original placement.

Everything else is checked by looking at it. No golden files.

One manual check worth repeating, because it guards the core principle: **export, redraw a
layer, re-export, confirm it still runs.** If that ever breaks, per-vertex storage crept in.

`test-char`'s source art is not on this machine — only its exported atlas. So the hand-made rig
is a reference for *structure* (bone names, physics values, slot layout), not a diff target.

## v1 scope

**In:** drawing (brush, eraser, fill, lasso), layers, bone placement, auto-mesh, auto-weights
(Euclidean), wobble, pose preview, atlas packing with trim, Spine 4.2 export, loose PNG export,
save/load, autosave.

**Out:** animation timeline, IK, path constraints, skins, deform sculpting, PSD import, weight
painting, vertex dragging, geodesic weights, multiple atlas pages, multiple templates.

PSD import is out only because nothing needs it yet — `slop-paint` already writes Spine-tagged
PSDs, so it's additive whenever existing art must come in.

## Open questions

Non-blocking; resolve while building.

1. **Origin convention.** Feet-at-y=0 assumed. The existing rig's skeleton block is
   `x: -739.16, y: -1075.25, w: 1296.04, h: 1621.17` and the test page places it at `y = 30,
   scale 0.35`. Reconcile before first export — getting it wrong puts every character in the
   wrong place.
2. **Bone creation gesture.** Drag-from-parent is conventional. Check it against Pencil on iPad,
   where slop-animator's finger/Pencil split applies.
3. **Mesh density default.** The hand-made rig runs 10–44 vertices per part. Pick a default
   spacing that lands there on a 2048² canvas.
4. **Bone naming.** sloppets drives bones by name. v1 is conventional — you name them right.
   Whether it ever becomes an enforced template is the template-vs-inference question, deferred
   until a second character exists.
5. **Eyes.** The existing rig swaps unweighted eye meshes by attachment. Decide whether "swap
   group" layers are special-cased or just hand-assigned.
