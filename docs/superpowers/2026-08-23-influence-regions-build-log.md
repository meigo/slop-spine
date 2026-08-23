# SDD ledger — plan: docs/superpowers/plans/2026-08-23-influence-regions.md

Branch: influence-regions (from main). Spec: docs/superpowers/specs/2026-08-23-influence-regions-design.md

## Pre-flight scan

### Cross-task rows

| Pair | Shared | Finding |
|---|---|---|
| T1 → T2 | weights feed the skinning preview | clean; T2 reads what T1 produces |
| T1 → T3 | handle sets Bone.reach that T1 consumes | clean |
| T2 → T4 | **warpFor's bind check** | **CONFLICT 1** — already resolved in the plan |
| T3 → T4 | reach must be tunable before binds are demoted | dependency stated |
| T2, T3 | both modify RigOverlay.ts and Canvas.svelte | sequential; T2 replaces poseDeform, T3 adds capsule drawing |
| T1, T3 | both touch document.ts / doc.svelte.ts | T1 adds the field, T3 adds setReach — additive |

### Per-task self-agreement

| Task | Finding |
|---|---|
| T1 | 4 test cases named, case 4 is the regression, window copied verbatim from geodesic.ts | clean |
| T2 | delta shape specified; descendantsOf already exported | clean |
| T3 | **CONFLICT 2** — addBone creates bones at length 0, so seeding reach there would seed 0 |
| T4 | defaultBind may become uncalled | flagged in the task, implementer reports rather than deletes |

## Rulings

Ruling: CONFLICT 1 — `warpFor` rejects any bone absent from the slot's bind list, and Task 4 makes
  every new bind `[]`, which would make it return null for every layer and silently kill the pose
  preview app-wide. Already resolved by ordering: the fix lands in T2S3, one task before T4 triggers
  it. Recording here because if T2 is ever reordered after T4, the preview breaks with no error.

Ruling: CONFLICT 2 — `addBone` creates bones with `length: 0` (length arrives from the drag that
  follows), so seeding `reach = length` inside `addBone` would seed zero and every vertex would fall
  through to the nearest-bone fallback. The plan already says to seed where length is set, not at
  creation. Cost if wrong: new bones have no visible influence region and the handle has nothing to
  grab.

Ruling: process — every dispatch this increment states "commit your work" explicitly. Twice now I
  have asked for a commit SHA in the reply contract without saying to commit, and twice the work
  arrived uncommitted. That is my template's fault, not the implementers'.

## Execution

Task 1: implemented (sonnet) — commit 7a741d2, 52/52 tests (48 + 4 new), check clean. Case 4
  (undefined reach = unchanged behaviour) passed BEFORE implementation, confirming no pre-existing
  regression, which is what that case was for.
Task 1: NOTE — the implementer caught a defect in MY plan's snippet. The window I specified only
  zeroed an out-of-reach bone's weight; it did not remove it, so it still occupied one of the four
  influence slots after sort/slice and could crowd out a bone that actually matters once a character
  has 5+ bones. Fixed by filtering zero-weight entries before capping. Caught by test case 1 — the
  test I specified catching a bug in the code I specified, which is the process working.
Task 1: review dispatched (sonnet).
Task 1: fix round 1/5 (3 addressed; commits 7a741d2..f2cd504). Both mutations failed ONLY their
  targeted test — specific, not merely sensitive — and weights.ts verified byte-identical via diff.
  New case 4 hand-derives its expected values with the derivation written into the test.
Task 1: Ruling: SKIP the re-review dispatch. The fix is test-only plus one doc comment (weights.ts
  diff is empty), discrimination was proven by mutation rather than asserted, and I read the new
  case 4 in full. Same proportionality call as v1.2's Task 16. Does NOT extend to Task 2, which
  replaces the deformation maths.
Task 1: complete (commits 029d530..f2cd504, 52/52 tests, check clean)
Task 1: minor (recorded, now documented): reach: 0 means UNLIMITED, not "no influence" — it falls
  through the `R != null && R > 0` guard, matching poseWeights' own semantics. Task 3's handle must
  clamp above zero or dragging to nothing gives the opposite of what it implies.
Task 2: dispatched (sonnet) — BASE f2cd504
Task 2: complete (commits f2cd504..7034bfd, review clean, 52/52 tests). Reviewer hand-derived the
  90-degree rotation, confirmed the pivot is the bone ORIGIN (the `tip` local holds a Bone, not a
  tip point — pre-existing naming that briefly misled the reviewer too), and established rotation
  direction agrees with the project BY CONSTRUCTION: dtheta uses the same atan2 formula
  setBoneRotation does, and poseDeform uses the same [cos -sin; sin cos] matrix as boneTip.
  Descendant inheritance is algebraically exact rather than approximate: every posed bone shares one
  delta, so posed_i(v) is identical across the set and the sum collapses to (Sum w_i)(posed(v)-v) —
  a vertex weighted 50/50 to parent and child moves fully, with no double-counting possible.
  warpFor's bind check is gone AND its `bone` parameter with it, so it cannot come back by accident.
Task 2: minor (deferred): the `tip` local in onRigPointerDown holds a Bone, not a coordinate.
  Pre-existing naming; rename to hitBone if that code is touched again.
Task 3: dispatched (sonnet) — BASE 7034bfd

## Queued after this increment: unify draw/rig into one view

User asked what prevents a unified view — layer/bone tree with an inspector, bones toggleable, no
mode switching. Investigated: NOTHING prevents it. `ui.mode` is consulted in 9 places and only 3 are
behavioural (draw-dispatch.ts:145 no-ops outside draw, Canvas.svelte:333 no-ops outside rig,
Canvas.svelte:108 gates the overlay). The other six are presentational. Crucially, BOTH pointer
handlers already attach to the same canvas element and each no-ops when it is not its turn — which
is exactly the dispatch a tool-based design uses, just keyed on `mode` instead of `tool`.

The mode is vestigial. v1's Task 8 introduced it BEFORE Task 9 added brush/eraser/fill, so at the
time "draw" really was one behaviour. Now draw mode already holds three tools that each mean
something different on click; adding `bone` and `pose` as tools is the same pattern, not a new one.
Moho does exactly this — the tool IS the mode, and the tree is always visible.

Why it matters beyond convenience: the app's claim is "redraw a limb after rigging and nothing needs
repairing", but you must SWITCH MODES to find out whether the redraw fixed the weights. The mode
switch is friction on precisely the loop the project exists for — and it is why the weight-bleed
screenshot took two increments to become visible.

Decision: finish influence regions (T3, T4) first — T3 is mid-flight and T4 changes rig-mode
behaviour substantially, so unifying on top of a settled rig UI is far safer. Then brainstorm the
unified view properly: the tree is a real design question (does selecting a layer select its bone?
what does the inspector show for a slot?), not something to guess at. Known risk for that increment:
the gesture dispatch has accumulated genuine subtlety — hold-X, alt-drag pose, tip-vs-body, snapping,
and the touch gestures all live there.
Task 3: implemented (sonnet) — commit 64af613, 52/52, check clean. Seeded reach 300 (= length),
  seeded in setBoneLength not addBone, so the length:0 trap was avoided; undefined immediately after
  addBone, which is correct. Clamp holds: dragging the handle onto the segment leaves reach = 1.
  Vertex-influence count for the bone: 138 -> 77 of 193 after shrinking reach 300->50 by a real drag.
Task 3: PATTERN, now twice in two increments — a new field added without updating every hand-
  maintained dependency list that must know about it. The implementer found boneSignature() in
  derive.ts omitted `reach`, so changing a radius would NOT invalidate cached weights: handle drags,
  capsule redraws, mesh keeps stale weights, feature appears broken. That is MY miss from Task 1 —
  I warned about the mesh-half cache key for per-slot density one increment ago and failed to apply
  the same thinking to the weights-half here.
  This codebase now has THREE hand-maintained dependency lists that every new field must be added to
  by hand: boneSignature() in derive.ts, the autosave $effect in App.svelte, and the derive cache
  keys. The autosave one dropped slot.density; this one dropped bone.reach. Both silent, both found
  by review rather than by use. Worth solving structurally before a third field is added.
Task 3: Ruling: ACCEPT the scope deviation — src/rig/derive.ts was not in Task 3's owned files, but
  the fix is necessary, minimal and disclosed, and without it the task's own feature does not work.

Task 3: complete — commit 64af613 — capsule + drag handle. Review: Approved, no Critical/Important findings.
  Included an out-of-owned-files fix (disclosed, accepted): boneSignature() in src/rig/derive.ts had
  omitted `reach`. Reviewer confirmed it is in the weights half of the cache key, not meshKey — correct.

Task 4: implemented — commit 6b0ee15 — addLayer stores bones:[], checkbox list relabelled as an override.
  Implementer concerns: defaultBind still has one caller (src/export/fixture.ts), left alone per brief;
  hint wording is the implementer's own. Review dispatched.

Found while designing the dependency-list fix (NOT yet fixed, own task after this increment):
  src/App.svelte:52-60 — the autosave $effect reads bone name/parent/x/y/rotation/length/wobble but
  NOT `reach`. So dragging the influence handle does not arm autosave; the change is lost on reload.
  Third instance of the hand-maintained-dependency-list failure (after slot.density, bone.reach in
  boneSignature). Live bug on this branch, introduced by Task 1, missed by Task 1 and Task 3 review.

Task 4 review: Approved. Two Important findings at increment level, both ruled on:

  Ruling (finding 1 — "the 52 tests don't cover addLayer -> deriveSlot"): PARTIALLY ACCEPTED.
    The invariant that makes the empty-bind default safe is already covered purely, at
    weights.test.ts:77 ("falls back to the nearest bone at weight 1 when a vertex is outside every
    reach"). The genuinely uncovered branch is deriveSlot's `stored?.length ? stored : all` ternary.
    Covering it via addLayer would need jsdom + a canvas 2D implementation in vitest for one data
    assertion — disproportionate for this project. Instead: extract the ternary to an exported pure
    function and test that. addLayer itself stays browser-verified only.
    Cost if wrong: a future change to addLayer's bind default ships untested.

  Ruling (finding 2 — fixture.ts diverges from the app's real default): ACCEPTED, fix it.
    src/verify/main.ts is the only place a rendered export is eyeballed against a real Spine
    runtime; it currently renders explicitly-bound slots, a configuration addLayer can no longer
    produce. A verifier that verifies the wrong configuration is this codebase's failure class.

  Found while ruling (neither implementer nor reviewer flagged it): derive.ts:53-57's comment is now
    stale. It explains an empty bind list as an accident of defaultBind filtering root out of an
    all-root list. As of Task 4 empty is the deliberate default. A reader would take the main path
    for a legacy edge case.

Cleanup batch: complete — commit 1a1dc7f — fixture builds unbound slots, stale derive.ts comment
  rewritten, bindNamesFor() extracted and covered (3 cases). 55/55 tests. defaultBind now has ZERO
  callers; left in place, not deleted (needs an explicit call before removal).
  Verify page renders correctly with the app's real unbound default: fullCanvasRegions [], no ALPHA FAIL.
  That is the increment's central claim proven against a real Spine runtime, not just unit tests.

Dependency-lists fix: dispatched. Brief at dep-lists-brief.md. BASE 1a1dc7f.

Dependency-lists fix: complete — commit d1d7244 — 55/55.
  Bug confirmed BEFORE the fix, not just after: dragged only the reach handle (500.893 -> 413.647),
  read IndexedDB directly, it still held 500.893 — the edit never re-armed the debounce timer.
  After: same drag persisted and survived reload. Stroke autosave and live re-derive both unaffected.

defaultBind removal: complete — commit (see git log) — 55/55, check clean.
  User-requested. Two comments citing it (doc.svelte.ts renameBone, RigPanel.svelte bindableBones)
  re-pointed at derive.ts's allNonRootBoneNames. Doc/plan/build-log mentions left as historical record.

INCREMENT COMPLETE — ready for whole-branch review, then merge.

---

## Outcome

Eight commits, `029d530..0bd354f`. 55 tests (was 48 at branch point), `svelte-check` clean.

| Commit | What |
|---|---|
| `f2cd504` | `Bone.reach` + falloff window + nearest-bone fallback |
| `7034bfd` | real linear-blend skinning + pose preview fix |
| `64af613` | influence capsule + drag handle |
| `6b0ee15` | binds demoted to an override; reach does the scoping |
| `1a1dc7f` | fixture follows the unbound default; `bindNamesFor` extracted and covered |
| `d1d7244` | reactive dependencies derived from the document, not listed by hand |
| `0bd354f` | remove `defaultBind` |

**What changed for the user.** Binding a layer used to mean ticking checkboxes in a per-slot list —
around sixty for a real character. A new layer now rigs itself from bone geometry, and the checkbox
list survives only for the case geometry gets wrong: two parts that genuinely overlap but should not
be linked, like a front arm crossing a torso.

**The architectural rule held.** `reach` is a property of a bone, not of a vertex, so
`weights = f(mesh, bone positions)` stays a pure function and redrawing art after rigging still
needs no repair. Nothing per-vertex was introduced.

## The dependency-list pattern, and why it is gone

Three times a new field was added without updating every hand-maintained list that had to know
about it, and every time the result was silent:

| Field | List it was missing from | Symptom |
|---|---|---|
| `slot.density` (v1.2) | autosave `$effect` | per-layer density lost on reload |
| `bone.reach` (T1, found T3) | `boneSignature()` | stale weights from cache; handle appears dead |
| `bone.reach` (T1, found post-T4) | autosave `$effect` | influence edits lost on reload |

All three were found by a reviewer reading code, never by using the app, and each presented to the
user as "the feature doesn't work". `d1d7244` replaces both lists with a deep read of the document
itself, so a new field is tracked the day it is added. `meshKey` was left alone deliberately and now
says why: mesh generation takes exactly `(canvas pixels, density)`, and `layer.revision` is a
deliberate stand-in for pixel data that is not reactive.

The fix was verified in the failing direction first — the reach drag was shown NOT to persist,
by reading IndexedDB directly before reloading — because a check that passes both before and after
proves nothing, and that is exactly how the two earlier instances got through review.

## Carried forward

- **Unified draw/rig view** — the next increment; investigation recorded above. `ui.mode` is vestigial.
- **No bone mutation is undoable** — contradicts "adjust any time as I go", which is the Moho quality
  the project is chasing.
- Three window events could collapse to one, in whatever next opens `Toolbar.svelte`.
- The `tip` local in `onRigPointerDown` holds a `Bone`, not a coordinate — rename if touched again.
- `ui.selectedLayerId` does not survive reload (pre-existing, UI-only).
- Dynamics / rig test view — needs `pixi.js` + `spine-pixi-v8` as real dependencies.
- Geodesic weighting — still deferred; only answers same-shape self-adjacency today.
