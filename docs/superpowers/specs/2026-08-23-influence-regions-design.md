# Bone influence regions — design

Status: approved design, 2026-08-23. Amends `2026-08-22-slop-spine-design.md`.

## What it is

Each bone gains a **radius of influence** — a capsule around its segment, with a soft falloff to
zero at the edge — which you scale by dragging a handle in rig mode. Vertices outside a bone's
radius are not weighted to it at all.

Plus the deformation preview becomes real linear-blend skinning, so the effect of scaling a radius
can actually be seen.

## Why

Three problems in the shipped app turn out to be one problem.

**Weight bleed.** `computeWeights` gives every bone an inverse-square falloff on distance-to-segment
with **no cutoff**, so every bone influences every vertex, normalised. v1.2's whole-character overlay
captured the consequence: a bone in one shape tinting vertices in a separate, non-overlapping shape
across an empty gap. The spec named geodesic distance as the deferred fix.

**The sixty checkboxes.** Because reach is unbounded, `Bind` is the only thing scoping a bone to a
layer — so it defaults to everything and must be curated by hand, ~10 bones × 6 slots for a sloppets
puppet.

**A control with no feedback.** `poseDeform` is a weighted *translation* — `v + delta * weight` —
not skinning. It cannot rotate at all, and it is not the maths the runtime uses. Any tuning done
against it is tuning against a preview that lies.

A per-bone radius addresses all three: it bounds bleed spatially, it makes binds unnecessary as a
scoping mechanism, and it is a control whose effect is visible the moment the preview is honest.

**This is the Moho model**, which is the reference the author works from — per-bone influence regions
you scale individually, rather than painted weights.

## The window already exists in the tree

`src/core/geodesic.ts`'s `poseWeights` takes a per-handle `reaches` array and applies exactly this:

```ts
if (R != null && R > 0) {
  if (g >= R) return 0;
  const t = g / R;          // smooth compact window: 1 at g=0 → 0 at g=R
  const win = 1 - t * t;
  w *= win * win;
}
```

It was copied in v1 and never used. This change applies that same window to Euclidean
distance-to-segment in `computeWeights`. **Adopt it verbatim** — the shape is not to be reinvented.

## Design

### Data

`Bone.reach?: number` — radius in canvas pixels.

**`undefined` means unlimited**, so every existing project file loads and produces byte-identical
weights to before. Persistence is free: `project-file.ts` serialises `bones: Bone[]` wholesale.

New bones are seeded with a reach proportional to their length at creation — the implementation
plan pins the constant, and it is one number to change once a real character has been rigged with it. That is an initial
**value**, visible in the handle and immediately draggable — not a rule that keeps re-deriving from
geometry. The project has twice rejected inference-at-render (v1's plan: *"do not try to derive
density per-slot from shape size — one global slider you can see the effect of is the simpler thing
that works"*), and this does not reopen it.

### Weighting

The window above, applied to the existing `distanceToBone`. One addition, no restructuring.

**The fallback that must not be forgotten:** if every bone's weight for a vertex comes out zero, that
vertex takes its **nearest bone at weight 1**.

A vertex with no influences exports `boneCount: 0`, and spine-ts then takes the weighted branch and
collapses every such vertex to the skeleton origin — the character vanishes. That is exactly the bug
v1.1 shipped and had to fix, and finite radii make it reachable again for the first time. It is the
single highest-risk consequence of this change.

### The handle

For the **selected bone only** — otherwise the canvas is unreadable. Draw the capsule (the segment
offset by ±R, with semicircular caps) and one grab handle on its edge, perpendicular at the bone's
midpoint. Dragging sets `reach` to the distance from the segment.

One radius, not a tapered start/end pair: the falloff already softens the edge, and tapering is
something to add when a character visibly needs it.

### Skinning

`poseDeform` is replaced by real linear-blend skinning:

```
v' = v + Σ wᵢ · (posedᵢ(v) − v)
```

where `posed` applies the drag as a rotation about the bone's origin and/or a translation. Today's
translation behaviour falls out as the special case, so it is preserved exactly where it was already
right.

**Descendants inherit the delta.** Rotating a shoulder must carry the forearm — if only the dragged
bone is posed, rotating a parent leaves its children behind, which is a different wrong picture
rather than a fix. Descendants are posed by the same delta and contribute through their own weights.

The pose gesture gains rotation: dragging near a bone's **tip** rotates it, near its **body**
translates — matching how bone *editing* already distinguishes tip-drag from body-drag, and reusing
that same hit test (`tipHit` against `RIG_HIT_RADIUS / zoom`) rather than introducing a second
threshold that could drift from it.

### Binds, demoted

`deriveSlot` already treats an empty bind list as "all non-root bones" (v1.1's F2 fix). That becomes
the normal path: `addLayer` stores `[]` rather than `defaultBind(...)`, so every slot starts
unrestricted and reach does the scoping.

The checkbox list stays as an explicit override for the case the geometry gets wrong — two parts
that genuinely overlap in space but should not be linked, such as a front arm crossing a torso. This
mirrors Moho, which has region-based influence with explicit binding available when needed.

## What this does and does not replace

Influence regions **largely supersede geodesic distance for this project's characters**: a hip bone
with a modest radius cannot reach an adjacent arm regardless of how the shapes sit.

They do **not** supersede it entirely. Geodesic distance measures *along the shape*, so it still
answers the case a radius cannot: two parts of the **same** shape that are spatially adjacent — a
bent limb folded against itself, where any radius large enough to cover the limb also covers the
part it is folded against. That case is not present in the puppets built so far, and geodesic
remains deferred until one appears.

## Verification

- a vertex beyond `R` receives exactly zero from that bone
- a vertex outside **all** radii receives exactly one influence at weight 1 — never zero
- **a document with no `reach` set anywhere produces byte-identical weights to before this change** —
  the regression that matters, since `undefined` must mean unlimited
- rotating a parent bone visibly moves its descendants' influenced vertices
- the export still parses and renders through the real runtime

## Out of scope

**Dynamics.** Physics constraints are emitted but never simulated in the editor — `verify.html` calls
`update(0)` once, so wobble remains a slider with no observable effect. Simulating it means running
the real Spine runtime in-app (`pixi.js` + `spine-pixi-v8` as dependencies), because reimplementing
the constraint solver would be both more work and worse — it would diverge from what ships. That is
the eventual test view, and deformation has to be right before dynamics layered on top of it means
anything.

Also out: tapered (start/end) radii, painted weight overrides, geodesic distance.
