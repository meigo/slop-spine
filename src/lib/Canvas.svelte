<script lang="ts">
  import { onMount } from "svelte";
  import {
    document as doc,
    addBone,
    moveBone,
    setBoneLength,
    setBoneRotation,
    setReach,
    descendantsOf,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import type { Tool } from "../state/ui.svelte";
  import { Viewport } from "../core/viewport";
  import { setupInput } from "../core/input";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { createDrawDispatch } from "./draw-dispatch";
  import { history } from "../state/history.svelte";
  import { deriveSlot } from "../rig/derive";
  import { distanceToBone } from "../rig/weights";
  import { drawRigOverlay, poseDeform, drawWarpedLayer, reachHandlePosition, type PoseDelta } from "./RigOverlay";
  import type { Bone } from "../rig/document";

  let stage: HTMLDivElement;
  // Viewport needs a real element with a parent to transform; it stays invisible and its CSS
  // transform is never used — the pan/zoom/rotation it tracks are read back into the 2D context
  // transform below instead, since the canvas is sized to the viewport, not to the document.
  let anchor: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let viewport: Viewport | null = null;
  let didInitialFit = false;

  // Bumped by the resize observer so the redraw $effect also reruns on container resize.
  let size = $state({ width: 0, height: 0 });

  // --- Rig mode: transient pose-drag offset. This is the ONE piece of rig state that must be
  // $state — it never touches doc.bones (pose is never stored), so it needs its own reactive
  // trigger for the redraw below. Everything else rig-related reads doc.bones/doc.density/ui
  // directly, which are already reactive. `pivot` is the dragged bone's rest origin; `dtheta` is
  // 0 for a body-drag (translate) and the bearing change from a tip-drag (rotate). ---
  let poseDrag = $state<{ bone: string; pivot: { x: number; y: number }; dtheta: number; dx: number; dy: number } | null>(
    null,
  );

  // Screen-only page ground: a checkerboard so a white stroke (now paintable, Task 14) reads
  // against the page instead of vanishing into a flat white fill. Never touches a layer.canvas —
  // export trims each layer to its own alpha, so a checkerboard baked into a layer would trim to
  // the full 2048x2048 page and destroy the atlas. Built once from a small offscreen tile and
  // tiled via createPattern rather than looping fillRect at low zoom.
  const CHECKER_SQUARE = 32; // document units per square
  const CHECKER_LIGHT = "#f2f2f2";
  const CHECKER_DARK = "#dcdcdc";
  let checkerPattern: CanvasPattern | null = null;

  function getCheckerPattern(context: CanvasRenderingContext2D): CanvasPattern {
    if (checkerPattern) return checkerPattern;
    const tile = document.createElement("canvas");
    tile.width = CHECKER_SQUARE * 2;
    tile.height = CHECKER_SQUARE * 2;
    const tctx = tile.getContext("2d")!;
    tctx.fillStyle = CHECKER_LIGHT;
    tctx.fillRect(0, 0, tile.width, tile.height);
    tctx.fillStyle = CHECKER_DARK;
    tctx.fillRect(0, 0, CHECKER_SQUARE, CHECKER_SQUARE);
    tctx.fillRect(CHECKER_SQUARE, CHECKER_SQUARE, CHECKER_SQUARE, CHECKER_SQUARE);
    checkerPattern = context.createPattern(tile, "repeat")!;
    return checkerPattern;
  }

  function redraw() {
    if (!ctx || !viewport || !canvasEl) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.translate(viewport.panX, viewport.panY);
    ctx.rotate(viewport.rotation);
    ctx.scale(viewport.zoom, viewport.zoom);
    // Page bounds, screen-draw only (never fills a layer.canvas — export trims each layer to its
    // own alpha, so an opaque layer would trim to the full page). Checkerboard, not flat white:
    // this project's art is grayscale line work with a paintable white value, and a white stroke
    // on a flat white page would be invisible. The border keeps the edge visible once the fill is
    // too small on screen to read as a page.
    ctx.fillStyle = getCheckerPattern(ctx);
    ctx.fillRect(0, 0, doc.canvas.width, doc.canvas.height);
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(0, 0, doc.canvas.width, doc.canvas.height);

    // The dragged bone and every descendant pose together, rigidly, about the dragged bone's
    // pivot — rotating a shoulder must carry the forearm (see poseDeform's doc comment).
    const poseBones = poseDrag ? [poseDrag.bone, ...descendantsOf(poseDrag.bone).map((b) => b.name)] : null;
    const poseBoneSet = poseBones ? new Set(poseBones) : null;
    const poseDelta: PoseDelta | null = poseDrag
      ? { pivot: poseDrag.pivot, dtheta: poseDrag.dtheta, dx: poseDrag.dx, dy: poseDrag.dy }
      : null;
    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      const warped = poseBones && poseDelta && warpFor(layer.id);
      // Reach does the scoping now, so most layers have zero weight for the posed bones — skip
      // the warp for those and draw normally, rather than clipping them to their mesh hull (which
      // loses soft brush fringe outside the hull) for no visual difference.
      const hasInfluence = warped && warped.weights.some((infs) => infs.some((i) => poseBoneSet!.has(i.bone)));
      if (warped && hasInfluence) {
        const deformed = poseDeform(warped.mesh, warped.weights, poseBones!, poseDelta!);
        drawWarpedLayer(ctx, layer.canvas, warped.mesh, deformed);
      } else {
        ctx.drawImage(layer.canvas, 0, 0);
      }
    }
    ctx.globalAlpha = 1;

    if (ui.showBones || ui.tool === "bone") {
      // Every visible layer's slot, not just the selected one — bleed (Task 21) is a relationship
      // between two parts' meshes, invisible if only one is ever drawn.
      const slots = doc.layers
        .filter((l) => l.visible)
        .map((l) => doc.slots.find((s) => s.layerId === l.id))
        .filter((s) => s !== undefined)
        .map((slot) => {
          const derived = deriveSlot(doc, slot.name);
          return { ...derived, selected: slot.layerId === ui.selectedLayerId };
        });
      drawRigOverlay(ctx, { bones: doc.bones, selectedBone: ui.selectedBone, slots }, viewport.zoom);
    }
  }

  /** The mesh/weights a live pose-drag needs to warp `layer`'s drawing, if it has a slot at all.
   *  No bind check here: a bone with no weight on any of this slot's vertices already deforms
   *  nothing (poseDeform sums weights per vertex), so filtering by bind would be redundant even
   *  where binds are still meaningful — and once reach fully replaces binds (Task 4 makes every
   *  new slot's bind `[]`), a bind check here would make the pose preview stop working entirely. */
  function warpFor(layerId: number) {
    const slot = doc.slots.find((s) => s.layerId === layerId);
    if (!slot) return null;
    return deriveSlot(doc, slot.name);
  }

  $effect(() => {
    // Track layer identity + the fields that affect the picture, plus container size.
    void doc.layers.map((l) => [l.id, l.visible, l.opacity, l.revision]);
    void size.width;
    void size.height;
    // Tool, bone-visibility, and selection changes, plus bone edits, all need a redraw. doc.bones is read
    // field-by-field (not just .length) so dragging a bone re-triggers this.
    void ui.tool;
    void ui.showBones;
    void ui.selectedBone;
    void ui.selectedLayerId;
    void doc.density;
    void JSON.stringify(doc.bones);
    void poseDrag;
    redraw();
  });

  const drawDispatch = createDrawDispatch();

  function transformCoords(sx: number, sy: number): { x: number; y: number } {
    return viewport ? viewport.screenToCanvas(sx, sy) : { x: sx, y: sy };
  }

  // --- Mouse pan (middle-button or space+drag) and wheel zoom. ---
  let spaceHeld = $state(false);
  let panning = false;

  // Hold-X temporary eraser (matches slop-paint's App.svelte): remembers the tool active before
  // X was pressed so keyup can restore it. Set only from onKeyDown's guarded path, so a keyup
  // that arrives with this still null (X pressed while a text input had focus) is a no-op.
  let toolBeforeEraser: Tool | null = null;

  // One-finger double-tap eraser toggle (touch-gestures.ts's onToggleEraser), matching
  // slop-animator's toggleEraser. This is sticky (stays until toggled again), unlike hold-X
  // above which is momentary, so it needs its own remembered tool — sharing toolBeforeEraser
  // would let a hold-X release while double-tap-erasing clobber it back to the wrong tool.
  let toolBeforeDoubleTapEraser: Tool | null = null;
  function toggleEraserGesture() {
    if (ui.tool === "eraser") {
      ui.tool = toolBeforeDoubleTapEraser ?? "brush";
      toolBeforeDoubleTapEraser = null;
    } else {
      toolBeforeDoubleTapEraser = ui.tool;
      ui.tool = "eraser";
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === " ") {
      spaceHeld = true;
      e.preventDefault();
    }
    // Cmd on Mac, Ctrl elsewhere. Redo is Shift+Z, not the Ctrl+Y some apps also bind — this
    // project only wires the one shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    }
    // Save/Load, matching slop-paint's Ctrl+S/Ctrl+O. Both buttons live in Toolbar.svelte, so a
    // window event bridges to them the same way Canvas.svelte's own Fit View listener does.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      window.dispatchEvent(new Event("slop-spine:save"));
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      window.dispatchEvent(new Event("slop-spine:load"));
      return;
    }
    // Tool keys, matching slop-animator's App.svelte exactly.
    if (e.key === "b") ui.tool = "brush";
    else if (e.key === "e") ui.tool = "eraser";
    else if (e.key === "g") ui.tool = "fill";
    // Hold X for temporary eraser, matching slop-paint's App.svelte. e.repeat is checked so an
    // auto-repeated keydown doesn't re-remember "eraser" as the tool to restore on keyup.
    if (e.key === "x" && !e.repeat && !toolBeforeEraser && ui.tool !== "eraser") {
      toolBeforeEraser = ui.tool;
      ui.tool = "eraser";
    }
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === " ") spaceHeld = false;
    if (e.key === "x" && toolBeforeEraser) {
      ui.tool = toolBeforeEraser;
      toolBeforeEraser = null;
    }
  }

  function onStagePointerDown(e: PointerEvent) {
    if (!viewport) return;
    const wantPan = e.button === 1 || (spaceHeld && e.button === 0);
    if (!wantPan) return;
    e.preventDefault();
    viewport.startPan(e.clientX, e.clientY);
    panning = true;
    stage.setPointerCapture(e.pointerId);
  }
  function onStagePointerMove(e: PointerEvent) {
    if (!panning || !viewport) return;
    viewport.updatePan(e.clientX, e.clientY);
  }
  function onStagePointerUp(e: PointerEvent) {
    if (!panning) return;
    viewport?.endPan();
    panning = false;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }
  // Wheel/trackpad: plain scroll pans; ⌘/Ctrl + scroll (and trackpad pinch, which arrives as
  // ctrl+wheel) zooms at the cursor.
  function onWheel(e: WheelEvent) {
    if (!viewport) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) viewport.zoomAt(e.clientX, e.clientY, e.deltaY);
    else viewport.panBy(-e.deltaX, -e.deltaY); // content follows the scroll
  }

  // --- Rig mode: bones. Runs alongside setupInput's own listeners on canvasEl (handleStroke
  // no-ops for any non-painting tool (see isPaintTool), so the two never fight over a stroke).
  // Raw PointerEvents rather than
  // input.ts's InputPoint pipeline, because bone dragging wants exact deltas and shift/alt, neither
  // of which the stroke pipeline carries. ---
  const RIG_HIT_RADIUS = 14; // screen px, converted to canvas px by dividing by zoom below

  function nonRootBones(): Bone[] {
    return doc.bones.filter((b) => b.name !== "root");
  }
  function boneTip(b: Bone) {
    const rad = (b.rotation * Math.PI) / 180;
    return { x: b.x + Math.cos(rad) * b.length, y: b.y + Math.sin(rad) * b.length };
  }
  /** Always returns the closest bone, with no distance cutoff — "drag from empty space" is
   *  defined by the brief as grabbing whichever bone origin is nearest, however far that is. */
  function nearestBone(pt: { x: number; y: number }): Bone | null {
    let best: Bone | null = null;
    let bestD = Infinity;
    for (const b of nonRootBones()) {
      const d = Math.hypot(b.x - pt.x, b.y - pt.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
  function tipHit(pt: { x: number; y: number }, radius: number): Bone | null {
    let best: Bone | null = null;
    let bestD = Infinity;
    for (const b of nonRootBones()) {
      if (b.length <= 0) continue; // zero-length bone has no distinct tip to grab
      const tip = boneTip(b);
      const d = Math.hypot(tip.x - pt.x, tip.y - pt.y);
      if (d < radius && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Nearest point among every OTHER bone's origin and tip, if within `radius` — lets a dragged
   *  origin or tip snap exactly onto another bone's end so chains connect instead of landing by
   *  eye. `exclude` is the bone being dragged, so it can't snap to its own origin/tip. root is a
   *  legitimate target (origin and tip coincide there, at canvas centre). Returns `pt` unchanged
   *  when nothing is close enough. */
  function snapToBoneEnd(pt: { x: number; y: number }, exclude: string, radius: number): { x: number; y: number } {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const b of doc.bones) {
      if (b.name === exclude) continue;
      for (const c of [{ x: b.x, y: b.y }, boneTip(b)]) {
        const d = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (d < radius && d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best ?? pt;
  }

  type DragState =
    | { type: "move"; bone: string }
    | { type: "length"; bone: string; created?: true }
    | { type: "pose"; bone: string }
    | { type: "reach"; bone: string };
  let dragState: DragState | null = null;
  let poseStart: { x: number; y: number } | null = null;
  // Only meaningful during a pose drag: whether it's a tip-grab (rotate) rather than a body-grab
  // (translate), and — for rotate — the bearing from the bone's origin to the pointer at drag
  // start, so onRigPointerMove can turn "bearing now" into a Δθ.
  let poseIsRotate = false;
  let poseStartBearing = 0;

  function onRigPointerDown(e: PointerEvent) {
    if (ui.tool !== "bone" || e.button !== 0) return;
    if (!(e.pointerType === "mouse" || e.pointerType === "pen")) return;
    if (!viewport) return;
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    const pt = viewport.screenToCanvas(e.clientX, e.clientY);
    const hitRadius = RIG_HIT_RADIUS / viewport.zoom;

    if (e.shiftKey) {
      // Root counts as an existing parent, so the very first bone can be shift-dragged from
      // empty canvas with nothing placed yet.
      const parent = nearestBone(pt) ?? doc.bones.find((b) => b.name === "root") ?? null;
      if (!parent) return;
      const name = addBone(parent.name, pt.x, pt.y);
      if (name) {
        ui.selectedBone = name;
        dragState = { type: "length", bone: name, created: true };
      }
      return;
    }
    if (e.altKey) {
      // Same tip-vs-body distinction bone editing uses just below: grabbing a tip rotates,
      // grabbing anywhere else on/near a bone translates. Reusing tipHit/hitRadius rather than a
      // second threshold keeps the two gestures' hit-testing from drifting apart.
      const tip = tipHit(pt, hitRadius);
      if (tip) {
        dragState = { type: "pose", bone: tip.name };
        poseStart = pt;
        poseIsRotate = true;
        poseStartBearing = Math.atan2(pt.y - tip.y, pt.x - tip.x);
        poseDrag = { bone: tip.name, pivot: { x: tip.x, y: tip.y }, dtheta: 0, dx: 0, dy: 0 };
        return;
      }
      const b = nearestBone(pt);
      if (!b) return;
      dragState = { type: "pose", bone: b.name };
      poseStart = pt;
      poseIsRotate = false;
      poseDrag = { bone: b.name, pivot: { x: b.x, y: b.y }, dtheta: 0, dx: 0, dy: 0 };
      return;
    }
    // The influence-radius handle, checked ahead of tip/move hit-testing so grabbing it (drawn
    // only for the selected bone — see RigOverlay's drawRigOverlay) always wins over re-selecting
    // or moving that same bone.
    if (ui.selectedBone) {
      const selected = doc.bones.find((b) => b.name === ui.selectedBone);
      const handle = selected ? reachHandlePosition(selected) : null;
      if (handle && Math.hypot(handle.x - pt.x, handle.y - pt.y) < hitRadius) {
        dragState = { type: "reach", bone: selected!.name };
        return;
      }
    }
    const tip = tipHit(pt, hitRadius);
    if (tip) {
      ui.selectedBone = tip.name;
      dragState = { type: "length", bone: tip.name };
      return;
    }
    const near = nearestBone(pt);
    if (near) {
      ui.selectedBone = near.name;
      dragState = { type: "move", bone: near.name };
    }
  }

  function onRigPointerMove(e: PointerEvent) {
    if (!dragState || !viewport) return;
    const pt = viewport.screenToCanvas(e.clientX, e.clientY);
    const hitRadius = RIG_HIT_RADIUS / viewport.zoom;
    if (dragState.type === "move") {
      // moveBone re-derives the delta it drags descendants by from (snapped x/y) - (bone's
      // current x/y), so snapping here is enough to keep the subtree attached to the snap too.
      const snapped = snapToBoneEnd(pt, dragState.bone, hitRadius);
      moveBone(dragState.bone, snapped.x, snapped.y);
    } else if (dragState.type === "length") {
      const bone = doc.bones.find((b) => b.name === dragState!.bone);
      if (bone) {
        const snapped = snapToBoneEnd(pt, dragState.bone, hitRadius);
        const dx = snapped.x - bone.x;
        const dy = snapped.y - bone.y;
        setBoneLength(dragState.bone, Math.hypot(dx, dy));
        setBoneRotation(dragState.bone, (Math.atan2(dy, dx) * 180) / Math.PI);
      }
    } else if (dragState.type === "reach") {
      // Reuses distanceToBone's own point-to-segment projection (src/rig/weights.ts) rather than
      // a second copy of that maths, which would drift from the one computeWeights actually uses.
      const bone = doc.bones.find((b) => b.name === dragState!.bone);
      if (bone) setReach(dragState.bone, distanceToBone(pt.x, pt.y, bone));
    } else if (dragState.type === "pose" && poseStart && poseDrag) {
      if (poseIsRotate) {
        // Δθ is the change in bearing from the bone's origin to the pointer.
        const bearing = Math.atan2(pt.y - poseDrag.pivot.y, pt.x - poseDrag.pivot.x);
        poseDrag.dtheta = bearing - poseStartBearing;
      } else {
        poseDrag.dx = pt.x - poseStart.x;
        poseDrag.dy = pt.y - poseStart.y;
      }
    }
  }

  function onRigPointerUp(e: PointerEvent) {
    if (!dragState) return;
    // Seed reach once, at the end of the drag that created the bone — not in setBoneLength, which
    // runs on every pointermove of that same drag and would otherwise lock reach to whatever the
    // hand's first few pixels of motion happened to be (see doc.svelte.ts's setBoneLength for why
    // that made every new bone's influence region ~100x too small). `length > 0` excludes a
    // shift-click with no drag: seeding a zero-length bone would give it a 1px influence region,
    // and leaving reach undefined (unlimited) is the less surprising of two bad outcomes for it.
    if (dragState.type === "length" && dragState.created) {
      const bone = doc.bones.find((b) => b.name === dragState!.bone);
      if (bone && bone.length > 0 && bone.reach === undefined) setReach(bone.name, bone.length);
    }
    dragState = null;
    poseStart = null;
    poseDrag = null;
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  onMount(() => {
    ctx = canvasEl.getContext("2d");
    viewport = new Viewport(anchor);
    viewport.onChange = redraw;

    const resizeObserver = new ResizeObserver(() => {
      const rect = stage.getBoundingClientRect();
      canvasEl.width = Math.max(1, Math.round(rect.width));
      canvasEl.height = Math.max(1, Math.round(rect.height));
      if (!didInitialFit && rect.width > 0 && rect.height > 0 && viewport) {
        viewport.fitView(doc.canvas.width, doc.canvas.height);
        didInitialFit = true;
      }
      size = { width: rect.width, height: rect.height };
    });
    resizeObserver.observe(stage);

    const cleanupTouch = setupTouchGestures(stage, viewport, {
      onUndo: () => history.undo(),
      onRedo: () => history.redo(),
      onToggleEraser: () => toggleEraserGesture(),
      onViewportChange: redraw,
    });

    const cleanupInput = setupInput(canvasEl, drawDispatch.handleStroke, transformCoords);

    // Capture-phase on `stage` so a pan preempts input.ts's bubble-phase listeners on `canvasEl`
    // (same precedence slop-animator's Canvas.svelte uses).
    stage.addEventListener("pointerdown", onStagePointerDown, { capture: true });
    stage.addEventListener("pointermove", onStagePointerMove, { capture: true });
    stage.addEventListener("pointerup", onStagePointerUp, { capture: true });
    stage.addEventListener("pointercancel", onStagePointerUp, { capture: true });
    stage.addEventListener("wheel", onWheel, { passive: false });
    canvasEl.addEventListener("pointerdown", onRigPointerDown);
    canvasEl.addEventListener("pointermove", onRigPointerMove);
    canvasEl.addEventListener("pointerup", onRigPointerUp);
    canvasEl.addEventListener("pointercancel", onRigPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // Bridge for Toolbar.svelte's "Fit View" button — the viewport instance is local to this
    // component (needs its own anchor element), so a window event is the smallest cross-component
    // link back to it. See Toolbar.svelte's dispatch.
    const onFitViewRequest = () => viewport?.fitView(doc.canvas.width, doc.canvas.height);
    window.addEventListener("slop-spine:fit-view", onFitViewRequest);

    return () => {
      cleanupTouch();
      cleanupInput();
      resizeObserver.disconnect();
      stage.removeEventListener("pointerdown", onStagePointerDown, { capture: true });
      stage.removeEventListener("pointermove", onStagePointerMove, { capture: true });
      stage.removeEventListener("pointerup", onStagePointerUp, { capture: true });
      stage.removeEventListener("pointercancel", onStagePointerUp, { capture: true });
      stage.removeEventListener("wheel", onWheel);
      canvasEl.removeEventListener("pointerdown", onRigPointerDown);
      canvasEl.removeEventListener("pointermove", onRigPointerMove);
      canvasEl.removeEventListener("pointerup", onRigPointerUp);
      canvasEl.removeEventListener("pointercancel", onRigPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("slop-spine:fit-view", onFitViewRequest);
    };
  });
</script>

<div bind:this={stage} class="relative h-full w-full touch-none overflow-hidden bg-canvas-bg">
  <div bind:this={anchor} class="absolute h-0 w-0"></div>
  <canvas bind:this={canvasEl} class="absolute left-0 top-0 h-full w-full"></canvas>
</div>
