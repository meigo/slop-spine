# SDD ledger — plan: docs/superpowers/plans/2026-08-23-unified-view-1-tools.md

Branch: unified-view-1 (from main at 40b3794).
Spec: docs/superpowers/specs/2026-08-23-unified-view-design.md

## Pre-flight scan

### Cross-task rows

| Pair | Shared | Finding |
|---|---|---|
| T1 -> T2 | isPaintTool, ui.showBones, Tool gains "bone" | clean; T1 adds only, T2 is the first consumer |
| T1 -> T3 | ui.svelte.ts (T3 adds overlayFlags beside isPaintTool) | clean; additive, different export |
| T2 -> T3 | Canvas.svelte overlay gate at ~line 113 | **CONFLICT 1** — T2 sets a temporary predicate there, T3 replaces it |
| T2, T3 | Canvas.svelte (T2 touches lines 113/146/339, T3 touches 113-125) | sequential, overlapping at 113 — see CONFLICT 1 |
| T1, T3 | src/state/__tests__/ui.test.ts (T1 creates, T3 appends) | clean; T3 appends a new describe block |
| T2 -> T3 | drawRigOverlay signature | clean; T2 does not touch RigOverlay.ts, T3 adds the 4th arg |

### Per-task self-agreement

| Task | Finding |
|---|---|
| T1 | test asserts isPaintTool over every Tool member; switch-based impl makes a new member a compile error — test and code agree |
| T2 | **CONFLICT 2** — Step 3 says delete the mode buttons at "lines 181-194" and change the gate at "line 195"; the deletion shifts that line number |
| T2 | Step 6's `grep -rn "ui.mode\|: Mode\|Mode =" src/` — verified against the tree: matches nothing after the change, and nothing unrelated today |
| T3 | overlayFlags test expects bones:true for ("bone", false); impl returns `rigging || showBones` — agrees |
| T3 | Step 5's outer gate `flags.bones || flags.mesh || flags.tint` omits capsule; capsule is only ever true when rigging, which sets all four — no unreachable-capsule case |
| T3 | test count arithmetic: 56 today, +3 (T1) = 59, +4 (T3) = 63 — matches both Step 4/Step 6 expectations |

## Rulings

Ruling: CONFLICT 1 — T2 and T3 both edit the overlay gate at Canvas.svelte:113. Deliberate and
  already sequenced: T2's `if (ui.showBones || ui.tool === "bone")` keeps the app working with no
  mode, and T3 replaces it with the flags-driven form plus the derivation skip. T2's brief says
  explicitly not to add the flags argument yet. Cost if wrong: T3 conflicts with T2's line and the
  implementer has to reconcile by hand — visible, not silent.

Ruling: CONFLICT 2 — T2 Step 3 cites line numbers that its own deletion invalidates. The step
  describes the edits unambiguously by content (the div containing both `ui.mode = ...` buttons; the
  `{#if ui.mode === "draw"}` gate), so an implementer matching on content rather than line number
  cannot go wrong. Carrying this into the dispatch as an explicit instruction: match by content, the
  cited line numbers are pre-deletion. Cost if wrong: implementer edits the wrong block, caught
  immediately by `npm run check` and the Step 6 grep.

## Execution

Task 1: implemented (haiku) — commit b2faf83, 59/59 (56 + 3 new), check clean. Review dispatched.
Task 1: complete (commit b2faf83, review clean, 59/59).
Task 1: minor (deferred): the third test's comment claims a new Tool member "fails to compile" here,
  but the test hardcodes a 4-element array — adding a 5th tool leaves the TEST passing. The real
  guard is TS2366 on the switch (declared `: boolean`, end becomes reachable). The guard is genuine;
  only the comment's attribution is loose. Not worth a fix round.
Task 2: dispatched (sonnet) — BASE b2faf83
Task 2: implemented (sonnet) — commit f084f14, 59/59, check clean, no ui.mode anywhere.
  Browser checks all passed, driven through real pointer events:
  1. brush drag over a bone -> stroke painted, bone x/y and selectedBone unchanged (state + pixel diff)
  2. bone-tool drag -> bone moved and selected, layer pixels byte-identical
  3. shift-drag created a correctly-parented bone; alt-drag warped pixels live, snapped back on release
  4. two-finger pan + cmd/ctrl zoom work under both bone and brush tools
  5. after drag+release, stray pointermoves and a fresh click caused no bone mutation
  HARNESS GOTCHAS found (saved to memory, would otherwise die with this workspace):
    - Chrome automation's left_click_drag silently ignores its `modifiers` param, so shift/alt
      gesture checks exercise the plain-drag path and pass for the wrong reason
    - canvasEl.setPointerCapture throws for any synthetic PointerEvent with pointerId !== 1; the
      throw only shows in the console, so the gesture looks inert rather than mis-driven
  Review dispatched.
Task 2 review: Needs work — 1 Important, no Critical. Stale "draw mode"/"rig mode" language in two
  Canvas.svelte comments describing the DISPATCH MECHANISM (:144, :264). Variable and type were gone;
  the prose was not. The implementer's own Step 6 grep (ui.mode|: Mode|Mode =) structurally cannot
  match prose that describes a mode, and the report presented that grep as verifying the constraint.
  Everything else verified against code: partition genuine and exhaustive (no Tool value both halves
  claim or both refuse), all five bone gestures byte-identical, bone button + visibility toggle
  outside the isPaintTool block so the user cannot be stranded, scope exactly five files,
  RigOverlay.ts untouched for Task 3, App.svelte transitional comment present.
Task 2: fix round 1/5 (1 addressed, 0 open — stale mode comments reworded; commit f084f14..0829b8f).
  Scoped re-review dispatched.
Task 2: fix round 1 re-review — both named comments ADDRESSED, but found a THIRD instance
  (Canvas.svelte:262, "// --- Rig mode: bones") three lines above the one just fixed.
Task 2: Ruling: the third instance is the SAME finding, not a new one. The original finding's
  constraint was "no comment describes dispatch in terms of a mode that no longer exists"; its two
  line numbers were examples, not an exhaustive list. So it stays in the loop rather than becoming a
  deferred minor. Cost if wrong: one extra fix round on comment text.
Task 2: METHOD NOTE — I named two lines and got exactly two lines fixed. Enumerating instances and
  fixing the enumeration is what caused round 2. Round 2's dispatch asked for a SWEEP of all four
  touched files with judgment applied, not a fix-list. It found 3 (Canvas.svelte:37, :263,
  draw-dispatch.ts:1) — two of which no reviewer had spotted. Enumeration would have cost 2+ more
  rounds. Generalise: when a finding is a class, dispatch the class, never the instances.
Task 2: fix round 2/5 (sweep; 3 comments changed, 1 deliberately kept — App.svelte:51's "mode-ish on
  purpose", which is the brief-mandated editorial note about the transitional panel switch and does
  not describe the deleted gate; commit 0829b8f..eef77a8). Scoped re-review dispatched.
Task 2: fix round 2 re-review — All findings addressed. Re-reviewer ran its own sweep of src/ and
  judged every remaining "mode" hit legitimate: main.ts:6 (CSS light mode), App.svelte:51 (the
  intentional editorial note), core/mls.ts:2 (the Deform tool's "rigid" mode), persist/db.ts:52,60
  (IDBTransactionMode). Agreed with keeping App.svelte:51. Comment-only diff, 59/59.
Task 2: complete (commits b2faf83..eef77a8, review clean after 2 fix rounds).
Task 3: dispatched (sonnet) — BASE eef77a8
Task 3: implemented (sonnet) — commit 8d0ce99, 63/63 (59 + 4 new), check clean.
  Browser checks, all six confirmed. The one that mattered: derivation skip verified with
  console.count("deriveSlot") AND a positive control — zero counts across 30+ brush pointer events,
  3 counts (one per layer) under the bone tool. Absence of evidence plus evidence the probe works.
  Instrumentation removed before commit, verified by grep.
  Implementer self-flagged: the new overlayFlags import sits mid-file in the test (my brief said
  "append"). Cosmetic; left to the reviewer to judge.
  Review dispatched.
Task 3 review: Approved. No Critical, no Important. Reviewer verified independently rather than
  trusting the report: alpha save/restore captures prevAlpha (not a hardcoded 1) and the overlay is
  the last statement in redraw(), so no leak within or across frames; the derivation skip is a real
  short-circuit at the ternary (flags.mesh || flags.tint ? <derive> : []), not drawing-side gating;
  block order mesh->tint->bones->capsule preserved; the 4 new tests fail under several plausible
  wrong rules rather than restating the implementation; console.count genuinely gone (grep, not
  report claim).
Task 3: minor (deferred): the new overlayFlags import sits mid-file in ui.test.ts. Spec-compliant —
  it is literally what my brief's append snippet showed — just unconventional. Worth consolidating.
Task 3: minor (deferred): LATENT COUPLING. The outer gate in Canvas.svelte is
  `flags.bones || flags.mesh || flags.tint`, omitting capsule. Correct today only because
  overlayFlags guarantees capsule => rigging => bones. If overlayFlags is ever extended so capsule
  can be true independently (e.g. "show capsule without bones"), the capsule silently stops drawing
  — the outer if never enters the block. Not a live bug; a trap for whoever edits overlayFlags next.
Task 3: complete (commits eef77a8..8d0ce99, review clean).

ALL TASKS COMPLETE — whole-branch review dispatched (opus), MERGE_BASE 40b3794.

WHOLE-BRANCH REVIEW (opus): TWO CRITICALS, both introduced by this branch, both invisible to the suite.

  C2 — flags.faint was a NO-OP. drawRigOverlay set globalAlpha 0.35, but drawBone overwrote it with
  ABSOLUTE assignments (0.25 fill, 1 stroke), and canvas alpha is a value not a multiplier. Bones drew
  at full strength over the artwork the whole time. This is the increment's headline visual change.
  Proven by executing drawRigOverlay against a recording stub: op/alpha sequence byte-identical in
  both directions.
  WHY THREE GATES MISSED IT: the 4 unit tests assert the FLAG VALUE, never its EFFECT; and the browser
  check ("bones are drawn, visibly faint") passed because the bone fill is already 0.25 translucent in
  BOTH states — a check with no contrast is not a check.

  C1 — MY PLAN DEFECT. Swapping the gate from ui.mode to ui.tool opened a temporal hole: ui.mode was
  writable only by two toolbar buttons, unclickable mid-drag because input.ts holds pointer capture;
  ui.tool is written by b/e/g and hold-X. Release X before the mouse and the stroke is stranded —
  pixels land, NO undo entry pushed, strokeLayer/strokeCtx/strokeSnapshot never cleared, and the next
  brush stroke reverts the layer from the stale snapshot.
  The spec's verification list said "switching tools mid-gesture cannot strand a drag". My plan
  Step 7 item 5 rewrote it as "switch to brush mid-gesture is not required" — I softened the exact
  check that finds this, and the ledger then recorded the weaker substitute as passing.
  Ruling: ACCEPTED both, fixed before merge. Cost if wrong: none — both were reproduced first.

Final fix: commit 04c9d72 — 66/66 (63 + 3 new).
  C2 before: faint true and false both [fill 0.25, stroke 1, fill 1]. After: faint true
  [fill 0.0875, stroke 0.35, fill 0.35], ratio exactly 0.35 at every op; faint false unchanged.
  C1 before: hold-X erase, release X before mouseup -> one Ctrl+Z undid the ENTIRE PRIOR STROKE, and a
  later unrelated stroke un-erased AND un-did the Ctrl+Z. After: one Ctrl+Z undoes exactly the erase
  (canvas byte-identical to pre-erase, diff bbox count 0); a following stroke touches nothing else.
  IMPLEMENTER FOUND MY BRIEF WRONG: latching a paint/non-paint BOOLEAN was insufficient. Brush
  settings are read live from ui.tool, so the final render pass repainted the erase as a brush stroke.
  The fix latches the full Tool value. Good catch — my brief specified the weaker fix.
  Also added `|| flags.capsule` to the outer overlay gate (inert today, removes the latent trap).
  Known gap, disclosed: C1 has no unit test — draw-dispatch.ts's stroke path needs real Canvas2D/
  Path2D/DOM and this project has no jsdom or canvas polyfill. Relies on browser reproduction.
  Scoped re-review dispatched.
Fix-wave re-review: All findings addressed. Verified independently rather than trusted:
  C1 latch reads the latched Tool at both live-decision sites (fill check, buildBrushSettings eraser
  flag); grep confirms no other live ui.tool read on the stroke-decision path; the clear runs
  unconditionally before every early return, so nothing strands even on a gesture that never paints.
  C2 origin-dot fill explicitly scaled to `base`, the exact partial fix the brief warned about — and
  the new test's exact-array assertion would catch that partial regression, not just total removal.
  `|| flags.capsule` confirmed inert by reading overlayFlags directly.
  On the missing C1 unit test: acceptable but a genuine gap, not a neutral tradeoff — the fix now has
  zero CI protection, and a future refactor could reintroduce the live ui.tool read with nothing
  failing. Adding jsdom/canvas is a legitimate follow-up, not a blocker.
INCREMENT COMPLETE at 04c9d72, 66/66.

---

## Outcome

Six commits, `40b3794..04c9d72`. 66 tests (was 56 at branch point), `svelte-check` clean.

| Commit | What |
|---|---|
| `b2faf83` | `isPaintTool`, `ui.showBones`, `bone` joins the `Tool` union |
| `f084f14` | the swap: every mode check becomes a tool check, `ui.mode` deleted |
| `0829b8f` | two stale mode comments reworded |
| `eef77a8` | swept the rest of the stale mode language |
| `8d0ce99` | overlay flags, faint bones, slot-derivation skip |
| `04c9d72` | both whole-branch Criticals fixed |

**What changed for the user.** There is no Draw/Rig switch any more. Bones stay on canvas while you
paint, drawn faintly, and picking the bone tool brings up the mesh, the weight tint and the reach
capsule. You can redraw a limb and watch its weights update without going anywhere — the loop the
project exists for, which used to cost a mode switch to observe.

## What the two Criticals cost, and why they got that far

Both were found only by the whole-branch review, after three task reviews had passed.

**The headline feature never worked.** `flags.faint` set `globalAlpha = 0.35`, but `drawBone`
overwrote it with absolute assignments. Canvas alpha is a value, not a multiplier. Three gates
missed it for two distinct reasons, both worth remembering:

- The four unit tests assert the **flag's value**, never its **effect**. A rule can be perfectly
  computed and perfectly ignored.
- The browser check — "bones are drawn, visibly faint" — passed because the bone fill is already
  0.25 translucent in *both* states. **A check with no contrast is not a check.** The same shape as
  the previous increment's blocker, where one synthetic call was the only input that returned the
  right answer.

**The other was a plan defect.** Swapping the gate from `ui.mode` to `ui.tool` opened a temporal
hole that did not exist before: `ui.mode` was writable only by two toolbar buttons, unclickable
mid-drag because pointer capture is held on the canvas; `ui.tool` is written by `b`/`e`/`g` and
hold-`X`. Release X a beat before the mouse and the stroke stranded — pixels landed, no undo entry
was pushed, and the next brush stroke silently reverted the layer from the stale snapshot.

The spec's verification list said *"switching tools mid-gesture cannot strand a drag: releasing
still ends it cleanly."* The plan rewrote that as *"switch to brush mid-gesture is not required."*
The check that would have found this was softened during planning, and the ledger then recorded the
weaker substitute as passing. **When a plan step waters down a spec requirement, that is the step to
look at hardest** — the spec asked for that check for a reason it did not have to justify.

## The method lesson: dispatch the class, not the instances

A reviewer named two comments carrying stale mode language. I sent those two; exactly those two came
back fixed, and a third survived three lines away. Round two asked for a *sweep* instead and found
three more — two that no reviewer had spotted. Enumerating instances and fixing the enumeration
would have taken several more rounds. When a finding is a class, dispatch the class.

## Carried forward

- **Increment 2: the tree and inspector.** One tree with a Drawing/Rig toggle, shared selection,
  meshes as first-class rows. Gets its own spec. `App.svelte` picking the panel by tool is the
  transitional wart it removes.
- **C1 has no regression test.** `draw-dispatch.ts`'s stroke path needs a real Canvas2D and this
  project has no jsdom or canvas polyfill, so the latch rests on a browser reproduction. A future
  refactor could reintroduce the live `ui.tool` read with nothing failing. Adding the polyfill is a
  legitimate follow-up.
- **Space+left-drag under the bone tool** pans *and* drags a bone — both halves claim the gesture.
  Pre-existing and byte-for-byte unchanged by this branch, but more reachable now that `bone` is a
  peer tool.
- **No keyboard shortcut selects the bone tool.** `b`/`e`/`g` are one-way exits from it.
- **`fillFired` can strand** if the tool changes between pointerdown and pointerup during a fill,
  no-op'ing the next fill click. Pre-existing, same shape as C1.
- **The `overlayFlags` outer-gate coupling**, now defused with `|| flags.capsule`.
- **Still open from the previous increment:** exporting before adding any bone ships every vertex
  with `boneCount: 0`, collapsing the character to the skeleton origin. Needs a behaviour decision.
