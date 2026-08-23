# Bone Influence Regions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each bone a radius of influence you scale by hand, and make the deformation preview honest enough to tune it against.

**Architecture:** Four tasks, ordered so the app works after each. Weighting first (pure logic, unit-tested), then the preview that makes the control legible, then the control itself, then the bind demotion that depends on all three.

**Spec:** `docs/superpowers/specs/2026-08-23-influence-regions-design.md`

## Global Constraints

- **Ethos: rough, indie, deliberately imperfect.** Ship the dumb version that mostly works; upgrade only when a failure is visible on screen. If a task starts feeling thorough, that is a smell.
- **Adopt, do not invent.** The falloff window already exists in `src/core/geodesic.ts`'s `poseWeights`. Copy its shape exactly; do not design a different curve.
- **Test only what cannot be eyeballed.** Task 1 is pure maths and **is** unit-tested. Tasks 2–4 are UI, verified by driving real Chrome.
- **Every task runs `npm test` AND `npm run check` before committing, both clean.** 48 tests exist today.
- Strict `tsconfig` (`noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`); **runes mode enforced**.
- **`grep -r "neutral-" src/` must stay empty**; no raw Tailwind colour class. `RigOverlay.ts`'s raw hex for bone/weight colours is canvas drawing, correctly exempt.
- **Nothing in the rig may be stored per-vertex.** `Bone.reach` is a per-bone scalar — the spec's allowed "parameters" class.
- **Do not touch `src/export/spine-json.ts`.** Its coordinate maths was hand-verified vertex by vertex. If you believe it must change, stop and report why.
- **Do not touch anything under `src/core/`** — copied modules, import-path edits only.
- Bones store **absolute** position and rotation; parent-relative conversion happens only at export.
- `doc.bones` lists **parents before children**, kept true by the mutators. Do not add a sort to the writer.

---

## Task 1: `Bone.reach` and the falloff window

**Files:** Modify `src/rig/document.ts`, `src/rig/weights.ts`; Test `src/rig/__tests__/weights.test.ts`

**Interfaces produced:** `Bone.reach?: number` (canvas px; `undefined` = unlimited)

- [ ] **Step 1: Add the field**

`reach?: number` on `Bone` in `src/rig/document.ts`, with a comment saying `undefined` means unlimited and why (existing project files must load unchanged). Persistence is free — `project-file.ts` serialises `bones: Bone[]` wholesale; **do not add mapping code**, but confirm the round-trip.

- [ ] **Step 2: Write the failing tests**

Add to the existing `computeWeights` describe block in `src/rig/weights.test.ts`. Four cases:

1. **a vertex beyond `reach` gets exactly zero from that bone** — two bones, one with a small reach, a vertex outside it; assert that bone is absent from the vertex's influences
2. **a vertex inside `reach` is still weighted**, and the falloff is monotonic — a vertex nearer the bone has strictly greater weight than one further, both inside `R`
3. **the fallback: a vertex outside *every* bone's reach gets exactly one influence at weight 1** — never zero influences
4. **`undefined` reach behaves exactly as today** — construct bones with no `reach` and assert the influences equal what the existing tests already expect

Case 4 is the regression that matters; cases 1 and 3 are the new behaviour.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/rig/__tests__/weights.test.ts`
Expected: cases 1–3 fail, case 4 passes (it describes current behaviour).

- [ ] **Step 4: Apply the window**

In `computeWeights`, after the existing `const d = distanceToBone(v.x, v.y, b);`:

```ts
let w = 1 / Math.max(d, 1) ** 2;
const R = b.reach;
if (R != null && R > 0) {
  if (d >= R) w = 0;
  else {
    const t = d / R;          // smooth compact window: 1 at d=0 → 0 at d=R
    const win = 1 - t * t;
    w *= win * win;
  }
}
```

This is `poseWeights`' window verbatim, applied to Euclidean distance instead of geodesic. Keep the comment.

- [ ] **Step 5: The fallback — the highest-risk line in this plan**

After computing and capping influences, if a vertex's total weight is zero, give it its **nearest bone at weight 1**.

A vertex with no influences exports `boneCount: 0`; spine-ts then takes the weighted branch and collapses every such vertex to the skeleton origin, so the character vanishes with a valid file and no error. That is the bug v1.1 shipped, and finite radii make it reachable again. Test case 3 exists for exactly this.

- [ ] **Step 6: Run the tests, then commit**

```bash
git add -A && git commit -m "feat: per-bone influence radius with a soft falloff"
```

---

## Task 2: Real skinning, rotation, and the `warpFor` trap

**Files:** Modify `src/lib/RigOverlay.ts`, `src/lib/Canvas.svelte`

`poseDeform` is currently a weighted **translation**:

```ts
{ x: v.x + dx * t, y: v.y + dy * t }
```

That cannot rotate, and it is not the maths the runtime uses — so tuning an influence radius against it is tuning against a preview that lies.

- [ ] **Step 1: Replace `poseDeform` with linear-blend skinning**

New shape: it takes a **delta** rather than `dx, dy` — a rotation about a pivot and/or a translation:

```
posed(v) = pivot + R(Δθ)·(v − pivot) + (dx, dy)
v'       = v + Σ wᵢ · (posedᵢ(v) − v)
```

Today's translation-only behaviour is the `Δθ = 0` case, so it is preserved exactly where it was already right.

- [ ] **Step 2: Descendants inherit the delta**

Rotating a shoulder must carry the forearm. If only the dragged bone is posed, rotating a parent leaves its children behind — a different wrong picture, not a fix. Pose the dragged bone **and all its descendants** by the same delta, each contributing through its own weights. `descendantsOf` is already exported from `src/state/doc.svelte.ts`.

- [ ] **Step 3: Fix `warpFor` — it will otherwise break silently in Task 4**

`src/lib/Canvas.svelte`'s `warpFor` currently reads:

```ts
const bindBones = doc.binds.find((b) => b.slot === slot.name)?.bones ?? [];
if (!bindBones.includes(bone)) return null;
```

Task 4 makes every new slot's bind `[]` (unrestricted). With this check in place that returns `null` for **every** layer, and the pose preview silently stops working everywhere.

Delete the bind check. The derived weights already decide: a bone with no weight on any vertex deforms nothing, so the guard is redundant as well as wrong.

- [ ] **Step 4: Tip-drag rotates, body-drag translates**

In rig mode's pose gesture (`dragState.type === "pose"`), reuse the **existing** `tipHit` against `RIG_HIT_RADIUS / viewport.zoom` to decide which — do not introduce a second threshold that could drift from the one bone editing uses.

Rotation pivots about the bone's **origin**; the angle is the change in bearing from origin to pointer between drag start and now.

- [ ] **Step 5: Verify in real Chrome**

Playwright from the session scratchpad (`/private/tmp/claude-501/-Users-meigo-Projects-slop-slop-spine/73658018-5b66-4513-bf3e-590a2ab9fadb/scratchpad/node_modules`, `chromium.launch({ channel: 'chrome' })`); **do not add it to `package.json`**.

- translating a bone still deforms as before (no regression)
- **rotating a parent bone visibly moves its child's influenced vertices** — report vertex positions before and after, for a vertex weighted to the child
- pose is still transient: releasing leaves `doc` byte-identical

Screenshot a rotated pose; name the path.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: linear-blend skinning and rotation in the pose preview"
```

---

## Task 3: The influence handle

**Files:** Modify `src/lib/RigOverlay.ts`, `src/lib/Canvas.svelte`, `src/state/doc.svelte.ts`

- [ ] **Step 1: Draw the capsule for the selected bone only**

The segment offset by ±`reach` with semicircular caps. Selected bone only — drawing every bone's region makes the canvas unreadable. A bone with `reach === undefined` draws nothing.

- [ ] **Step 2: One drag handle**

On the capsule edge, perpendicular to the bone at its midpoint. Dragging sets `reach` to the distance from the segment — reuse `distanceToBone`'s projection maths rather than reimplementing it.

Add `setReach(name, reach)` to `src/state/doc.svelte.ts`, mirroring the existing `setWobble`/`setSlotDensity` mutator style. Clamp to a sensible minimum so a radius cannot be dragged to zero and strand every vertex on the fallback.

- [ ] **Step 3: Seed new bones**

`addBone` sets `reach` proportional to the bone's length. **Pin the constant here: `reach = length` at creation** — one bone-length out from the segment, adjustable immediately. One number, changed once a real character has been rigged with it.

Note `addBone` currently creates bones with `length: 0` (length comes from the drag that follows), so seed at the point length is set, not at creation.

- [ ] **Step 4: Verify** — drag the handle, confirm the mesh re-derives and the capsule follows; confirm a seeded bone shows a handle immediately. Screenshot; name the path.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: influence radius handle in rig mode"
```

---

## Task 4: Demote binds

**Files:** Modify `src/state/doc.svelte.ts`, `src/lib/RigPanel.svelte`

**Depends on Tasks 1–3.** Reach must work, be visible, and be tunable before it can take over scoping.

- [ ] **Step 1: New slots start unrestricted**

`addLayer` stores `binds.push({ slot: slot.name, bones: [] })` instead of `defaultBind(...)`. `deriveSlot` already treats an empty list as "all non-root bones" (v1.1's F2 fix), so reach does the scoping from here.

Check whether `defaultBind` still has a caller. If not, say so in your report — do not delete it unilaterally.

- [ ] **Step 2: Relabel the checkbox list as an override**

It stays, for the case geometry gets wrong — two parts that genuinely overlap but should not be linked, like a front arm crossing a torso. Make the label say so. No behaviour change.

- [ ] **Step 3: Verify**

- a fresh layer with bones present derives sensible weights **without touching a checkbox** — this is the sixty-checkbox problem being gone, so demonstrate it
- an explicit bind still restricts as before
- the pose preview still works (Task 2 Step 3 is what makes this true — if it does not, that fix regressed)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: binds become an override; reach does the scoping"
```

---

## Self-review notes

**Spec coverage.** Data model → T1S1; window → T1S4; fallback → T1S5; handle → T3; skinning and rotation → T2; binds demoted → T4; verification → each task's verify step, with the byte-identical-weights regression as T1 case 4.

**The trap this plan exists to avoid.** `warpFor`'s bind check (T2S3) is the cross-file interaction that would make Task 4 silently break the pose preview. It is fixed one task *before* the change that would trigger it.

**Known risk.** Task 1 Step 5's fallback is the highest-risk line: without it, finite radii reintroduce the invisible-character bug from v1.1 — valid file, no error, nothing on screen. Test case 3 is its only guard.

**Deliberately excluded.** Tapered start/end radii, painted weight overrides, geodesic distance, and dynamics — all recorded in the spec's out-of-scope section with reasons.
