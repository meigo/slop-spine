<script lang="ts">
  import { onMount } from "svelte";
  import {
    document as doc,
    addBone,
    moveBone,
    setBoneLength,
    setBoneRotation,
    setReach,
    removeBone,
    markLayerDirty,
    descendantsOf,
    snapshotRig,
    pushRigCommand,
    insertJoint,
    setParent,
    type RigSnapshot,
  } from "../state/doc.svelte";
  import { ui, overlayFlags, isSelectTool, toolFromKey } from "../state/ui.svelte";
  import { boneTip, reparentDropTarget } from "../rig/chain";
  import type { Tool } from "../state/ui.svelte";
  import { Viewport } from "../core/viewport";
  import { setupInput } from "../core/input";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { createDrawDispatch } from "./draw-dispatch";
  import { history } from "../state/history.svelte";
  import { pixelCommand } from "../core/history";
  import { Selection } from "../core/selection";
  import SelectionActions from "./SelectionActions.svelte";
  import { deriveSlot } from "../rig/derive";
  import { distanceToBone } from "../rig/weights";
  import {
    drawRigOverlay,
    poseDeform,
    drawWarpedLayer,
    reachHandlePosition,
    posedPoint,
    ancestorExtras,
    makeBonePoses,
    posedOverlayBone,
  } from "./RigOverlay";
  import { stepWobble, stepTip, wobbleSettled, boneRestTip, type WobbleAxis } from "./pose-wobble";
  import type { Bone } from "../rig/document";

  let stage: HTMLDivElement;
  // Viewport needs a real element with a parent to transform; it stays invisible and its CSS
  // transform is never used — the pan/zoom/rotation it tracks are read back into the 2D context
  // transform below instead, since the canvas is sized to the viewport, not to the document.
  let anchor: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let overlayEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let viewport: Viewport | null = null;
  let didInitialFit = false;

  // Bumped by the resize observer so the redraw $effect also reruns on container resize.
  let size = $state({ width: 0, height: 0 });

  // --- Bone tool: transient pose-drag offset. This is the ONE piece of rig state that must be
  // $state — it never touches doc.bones (pose is never stored), so it needs its own reactive
  // trigger for the redraw below. Everything else rig-related reads doc.bones/doc.density/ui
  // directly, which are already reactive. `pivot` is the dragged bone's rest origin; `dtheta` is
  // 0 for a body-drag (translate) and the bearing change from a tip-drag (rotate). ---
  let poseDrag = $state<{ bone: string; pivot: { x: number; y: number }; dtheta: number; dx: number; dy: number } | null>(
    null,
  );

  type PoseSimBone = {
    tipX: WobbleAxis;
    tipY: WobbleAxis;
    dx: WobbleAxis;
    dy: WobbleAxis;
    extraTheta: number;
  };
  let poseSim = $state<{
    names: string[];
    dragged: string;
    settling: boolean;
    bones: Record<string, PoseSimBone>;
  } | null>(null);
  let poseRaf = 0;
  let poseLastT = 0;

  function zeroAxis(): WobbleAxis {
    return { pos: 0, vel: 0 };
  }

  function poseNamesFor(dragged: string): string[] {
    return [dragged, ...descendantsOf(dragged).map((b) => b.name)];
  }

  function anyWobble(names: string[]): boolean {
    return names.some((n) => (doc.bones.find((b) => b.name === n)?.wobble ?? 0) > 0);
  }

  function initPoseSim(dragged: string) {
    const names = poseNamesFor(dragged);
    if (!anyWobble(names)) {
      poseSim = null;
      return;
    }
    const bones: Record<string, PoseSimBone> = {};
    for (const n of names) {
      const b = doc.bones.find((x) => x.name === n);
      const tip = b ? boneRestTip(b) : { x: 0, y: 0 };
      bones[n] = {
        tipX: { pos: tip.x, vel: 0 },
        tipY: { pos: tip.y, vel: 0 },
        dx: zeroAxis(),
        dy: zeroAxis(),
        extraTheta: 0,
      };
    }
    poseSim = { names, dragged, settling: false, bones };
    startPoseLoop();
  }

  function startPoseLoop() {
    if (poseRaf) return;
    poseLastT = 0;
    const tick = (t: number) => {
      poseRaf = 0;
      const dt = poseLastT === 0 ? 1 / 60 : Math.min(0.05, (t - poseLastT) / 1000);
      poseLastT = t;
      if (!advancePoseSim(dt)) return;
      poseRaf = requestAnimationFrame(tick);
    };
    poseRaf = requestAnimationFrame(tick);
  }

  function stopPoseLoop() {
    if (poseRaf) cancelAnimationFrame(poseRaf);
    poseRaf = 0;
    poseLastT = 0;
  }

  function clearPose() {
    stopPoseLoop();
    poseSim = null;
    poseDrag = null;
  }

  function advancePoseSim(dt: number): boolean {
    if (!poseSim || !poseDrag) return false;
    const target = poseSim.settling
      ? { dtheta: 0, dx: 0, dy: 0 }
      : { dtheta: poseDrag.dtheta, dx: poseDrag.dx, dy: poseDrag.dy };
    const bones: Record<string, PoseSimBone> = {};
    const posed = new Map<string, { origin: { x: number; y: number }; extraTheta: number }>();
    let allSettled = poseSim.settling;
    const parentOf = (n: string) => doc.bones.find((b) => b.name === n)?.parent ?? null;
    for (const name of poseSim.names) {
      const bone = doc.bones.find((b) => b.name === name);
      const wobble = bone?.wobble ?? 0;
      const move = !!bone?.wobbleMove;
      const follow = !poseSim.settling && name === poseSim.dragged;
      const prev = poseSim.bones[name] ?? {
        tipX: zeroAxis(),
        tipY: zeroAxis(),
        dx: zeroAxis(),
        dy: zeroAxis(),
        extraTheta: 0,
      };
      // Translation: the dragged bone follows the pointer; others snap unless wobbleMove.
      const dx = follow || !move || wobble <= 0 ? { pos: target.dx, vel: 0 } : stepWobble(prev.dx, target.dx, wobble, dt);
      const dy = follow || !move || wobble <= 0 ? { pos: target.dy, vel: 0 } : stepWobble(prev.dy, target.dy, wobble, dt);
      const delta = { pivot: poseDrag.pivot, dtheta: target.dtheta, dx: dx.pos, dy: dy.pos };
      const restO = bone ? { x: bone.x, y: bone.y } : { x: 0, y: 0 };
      const restT = bone ? boneRestTip(bone) : { x: 0, y: 0 };
      const ancestors = ancestorExtras(name, parentOf, posed);
      const origin = posedPoint(restO, delta, ancestors);
      const rigidTip = posedPoint(restT, delta, ancestors);
      const tip = stepTip(
        { x: prev.tipX, y: prev.tipY },
        rigidTip,
        origin,
        bone?.length ?? 0,
        wobble,
        dt,
      );
      const next = { tipX: tip.x, tipY: tip.y, dx, dy, extraTheta: tip.extraTheta };
      posed.set(name, { origin, extraTheta: next.extraTheta });
      bones[name] = next;
      if (
        poseSim.settling &&
        (Math.abs(next.extraTheta) > 0.04 ||
          Math.abs(next.tipX.vel) > 8 ||
          Math.abs(next.tipY.vel) > 8 ||
          (move && (!wobbleSettled(next.dx, 0) || !wobbleSettled(next.dy, 0))))
      ) {
        allSettled = false;
      }
    }
    poseSim = { ...poseSim, bones };
    if (poseSim.settling && allSettled) {
      clearPose();
      return false;
    }
    return true;
  }

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

    // The dragged bone and every descendant pose about the dragged bone's pivot. Bones with
    // wobble lag that target (poseSim); the rest follow it rigidly.
    const poseBones = poseSim?.names ?? (poseDrag ? poseNamesFor(poseDrag.bone) : null);
    const poseBoneSet = poseBones ? new Set(poseBones) : null;
    const poses =
      poseDrag && poseBones
        ? makeBonePoses(
            poseBones,
            (name) => doc.bones.find((x) => x.name === name),
            (name) => {
              const sim = poseSim?.bones[name];
              const b = doc.bones.find((x) => x.name === name);
              const move = !!b?.wobbleMove;
              const settling = !!poseSim?.settling;
              const targetDx = settling ? 0 : poseDrag!.dx;
              const targetDy = settling ? 0 : poseDrag!.dy;
              return {
                pivot: poseDrag!.pivot,
                dtheta: settling ? 0 : poseDrag!.dtheta,
                dx: move ? (sim?.dx.pos ?? targetDx) : targetDx,
                dy: move ? (sim?.dy.pos ?? targetDy) : targetDy,
              };
            },
            (name) => poseSim?.bones[name]?.extraTheta ?? 0,
          )
        : null;
    if (ui.showDrawings) {
      for (const layer of doc.layers) {
        if (!layer.visible) continue;
        ctx.globalAlpha = layer.opacity;
        const warped = poseBones && poses && warpFor(layer.id);
        // Reach does the scoping now, so most layers have zero weight for the posed bones — skip
        // the warp for those and draw normally, rather than clipping them to their mesh hull (which
        // loses soft brush fringe outside the hull) for no visual difference.
        const hasInfluence = warped && warped.weights.some((infs) => infs.some((i) => poseBoneSet!.has(i.bone)));
        if (warped && hasInfluence) {
          const deformed = poseDeform(warped.mesh, warped.weights, poses!);
          drawWarpedLayer(ctx, layer.canvas, warped.mesh, deformed);
        } else {
          ctx.drawImage(layer.canvas, 0, 0);
        }
      }
    }
    ctx.globalAlpha = 1;

    const flags = overlayFlags(ui.tool, ui.showBones, ui.showMeshes);
    if (flags.bones || flags.mesh || flags.tint || flags.capsule) {
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
      const overlayBones = poses
        ? doc.bones.map((b) => {
            const pose = poses.find((p) => p.bone === b.name);
            return pose ? posedOverlayBone(b, pose) : b;
          })
        : doc.bones;
      drawRigOverlay(ctx, { bones: overlayBones, selectedBone: ui.selectedBone, slots }, viewport.zoom, flags);
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
    JSON.stringify(doc);
    void ui.tool;
    if (ui.tool !== "bone") setRigCursor(null);
    void ui.showBones;
    void ui.showDrawings;
    void ui.showMeshes;
    void ui.selectedBone;
    void ui.selectedLayerId;
    void poseDrag;
    void poseSim;
    void size.width;
    void size.height;
    redraw();
  });

  $effect(() => {
    void ui.tool;
    if (!selection) return;
    selection.mode = ui.tool === "lasso" ? "lasso" : "rect";
    if (!isSelectTool(ui.tool) && selection.active) {
      if (selection.hasFloating) selection.commit();
      else selection.cancel();
    }
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
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
    if (e.key === "Enter" && selection?.hasFloating) {
      e.preventDefault();
      selection.commit();
      return;
    }
    if (e.key === "Escape" && selection?.active) {
      e.preventDefault();
      selection.cancel();
      return;
    }
    if (!(e.metaKey || e.ctrlKey)) {
      const tool = toolFromKey(e.key);
      if (tool) ui.tool = tool;
    }
    // Hold X for temporary eraser, matching slop-paint's App.svelte. e.repeat is checked so an
    // auto-repeated keydown doesn't re-remember "eraser" as the tool to restore on keyup.
    if (e.key === "x" && !e.repeat && !toolBeforeEraser && ui.tool !== "eraser") {
      toolBeforeEraser = ui.tool;
      ui.tool = "eraser";
    }
    if ((e.key === "Backspace" || e.key === "Delete") && ui.selectedBone) {
      e.preventDefault();
      const before = snapshotRig();
      removeBone(ui.selectedBone);
      ui.selectedBone = null;
      pushRigCommand(before, snapshotRig());
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

  // --- Bone-tool gestures. Runs alongside setupInput's own listeners on canvasEl (handleStroke
  // no-ops for any non-painting tool (see isPaintTool), so the two never fight over a stroke).
  // Raw PointerEvents rather than
  // input.ts's InputPoint pipeline, because bone dragging wants exact deltas and shift/alt, neither
  // of which the stroke pipeline carries. ---
  const RIG_HIT_RADIUS = 16; // screen px, shaft / body
  const HANDLE_HIT_RADIUS = 22; // screen px, tip (rotate/length) and reach handle
  // Rotate cursor: CSS has no built-in 'rotate'. White halo + black stroke, hotspot at centre.
  const ROTATE_CURSOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="white" stroke-width="4"/>' +
    '<path d="M21 3v5h-5" stroke="white" stroke-width="4"/>' +
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="black" stroke-width="2"/>' +
    '<path d="M21 3v5h-5" stroke="black" stroke-width="2"/>' +
    "</svg>";
  const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(ROTATE_CURSOR_SVG)}") 12 12, crosshair`;

  function nonRootBones(): Bone[] {
    return doc.bones.filter((b) => b.name !== "root");
  }
  /** Closest non-root origin, no distance cutoff. Shift-create and alt-pose still use this
   *  as a parent/target pick from empty space. Move uses shaftHit instead. */
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
  /** Closest non-root bone whose segment is within `radius` (the kite, not just the origin). */
  function shaftHit(pt: { x: number; y: number }, radius: number): Bone | null {
    let best: Bone | null = null;
    let bestD = Infinity;
    for (const b of nonRootBones()) {
      const d = distanceToBone(pt.x, pt.y, b);
      if (d < radius && d < bestD) {
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

  type RigHover = { kind: "reach" | "rotate" | "move"; bone: Bone };

  function rigHover(pt: { x: number; y: number }): RigHover | null {
    if (!viewport) return null;
    const bodyR = RIG_HIT_RADIUS / viewport.zoom;
    const handleR = HANDLE_HIT_RADIUS / viewport.zoom;
    if (ui.selectedBone) {
      const selected = doc.bones.find((b) => b.name === ui.selectedBone);
      const handle = selected ? reachHandlePosition(selected) : null;
      if (selected && handle && Math.hypot(handle.x - pt.x, handle.y - pt.y) < handleR) {
        return { kind: "reach", bone: selected };
      }
    }
    const tip = tipHit(pt, handleR);
    if (tip) return { kind: "rotate", bone: tip };
    const shaft = shaftHit(pt, bodyR);
    if (shaft) return { kind: "move", bone: shaft };
    return null;
  }

  function setRigCursor(kind: RigHover["kind"] | "grabbing" | null) {
    if (!canvasEl) return;
    if (kind === "rotate") canvasEl.style.cursor = ROTATE_CURSOR;
    else if (kind === "reach") canvasEl.style.cursor = "ew-resize";
    else if (kind === "move") canvasEl.style.cursor = "grab";
    else if (kind === "grabbing") canvasEl.style.cursor = "grabbing";
    else canvasEl.style.cursor = "";
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
  let rigDragBefore: RigSnapshot | null = null;
  let poseStart: { x: number; y: number } | null = null;
  // Only meaningful during a pose drag: whether it's a tip-grab (rotate) rather than a body-grab
  // (translate), and — for rotate — the bearing from the bone's origin to the pointer at drag
  // start, so onRigPointerMove can turn "bearing now" into a Δθ.
  let poseIsRotate = false;
  let poseStartBearing = 0;

  // --- Select / lasso. Overlay is display-only (pointer-events: none); these handlers share
  // canvasEl with the bone tool and stand down unless isSelectTool. Lift bakes into the layer
  // on Enter/commit; Escape restores the pre-lift snapshot. dpr is 1: layer canvases are 1:1
  // with document pixels. ---
  let selection: Selection | null = null;
  let selectionMode: "create" | "drag" | null = null;
  let selCtx: CanvasRenderingContext2D | null = null;
  let selBefore: ImageData | null = null;
  let selLayerId: number | null = null;

  function applySelectionView(c: CanvasRenderingContext2D) {
    if (!viewport) return;
    c.translate(viewport.panX, viewport.panY);
    c.rotate(viewport.rotation);
    c.scale(viewport.zoom, viewport.zoom);
  }

  function syncSelectionOverlay() {
    if (!selection || !viewport || !overlayEl) return;
    selection.screenScale = viewport.zoom;
    selection.drawOverlay();
  }

  function liftSelection(): boolean {
    const layer = doc.layers.find((l) => l.id === ui.selectedLayerId);
    if (!layer || !selection) return false;
    const lctx = layer.canvas.getContext("2d");
    if (!lctx) return false;
    selBefore = lctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    const pixels = selection.liftPixels(lctx, 1);
    if (!pixels) {
      selBefore = null;
      return false;
    }
    selCtx = lctx;
    selLayerId = layer.id;
    markLayerDirty(layer.id);
    selection.beginTransform(pixels);
    redraw();
    return true;
  }

  function enterTransform() {
    if (!selection || selection.state !== "selected") return;
    liftSelection();
  }

  function enterWarp(rows: number, cols: number) {
    if (!selection) return;
    if (selection.state === "selected") liftSelection();
    if (selection.state === "transforming") selection.beginWarp(rows, cols);
    else if (selection.state === "warping") selection.densifyWarp(rows, cols);
  }

  function setupSelection() {
    selection = new Selection(overlayEl);
    selection.applyView = applySelectionView;
    selection.onChange = () => {
      redraw();
      syncSelectionOverlay();
    };
    selection.onStateChange = () => syncSelectionOverlay();
    selection.onCommit = () => {
      if (!selCtx || !selBefore || selLayerId === null || !selection) return;
      selection.renderFloatingTo(selCtx);
      const layerId = selLayerId;
      const ctx2 = selCtx;
      const before = selBefore;
      const after = ctx2.getImageData(0, 0, ctx2.canvas.width, ctx2.canvas.height);
      markLayerDirty(layerId);
      history.push(
        pixelCommand(
          () => {
            ctx2.putImageData(before, 0, 0);
            markLayerDirty(layerId);
          },
          () => {
            ctx2.putImageData(after, 0, 0);
            markLayerDirty(layerId);
          },
          before,
          after,
        ),
      );
      selCtx = null;
      selBefore = null;
      selLayerId = null;
      redraw();
    };
    selection.onCancel = () => {
      if (selCtx && selBefore && selLayerId !== null) {
        selCtx.putImageData(selBefore, 0, 0);
        markLayerDirty(selLayerId);
      }
      selCtx = null;
      selBefore = null;
      selLayerId = null;
      redraw();
    };
  }

  function onSelPointerDown(e: PointerEvent) {
    if (!isSelectTool(ui.tool) || e.button !== 0) return;
    if (!(e.pointerType === "mouse" || e.pointerType === "pen")) return;
    if (!viewport || !selection) return;
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    selection.mode = ui.tool === "lasso" ? "lasso" : "rect";
    const pt = viewport.screenToCanvas(e.clientX, e.clientY);
    const handle = selection.hitTest(pt.x, pt.y);
    if (selection.state === "selected" && handle === "move") {
      if (!liftSelection()) return;
      selectionMode = "drag";
      selection.startDrag("move", pt.x, pt.y);
    } else if ((selection.state === "transforming" || selection.state === "warping") && handle) {
      selectionMode = "drag";
      selection.startDrag(handle, pt.x, pt.y);
    } else {
      if (selection.hasFloating) selection.commit();
      else if (selection.active) selection.cancel();
      selectionMode = "create";
      selection.startCreate(pt.x, pt.y);
    }
  }

  function onSelPointerMove(e: PointerEvent) {
    if (!selectionMode || !viewport || !selection) return;
    const pt = viewport.screenToCanvas(e.clientX, e.clientY);
    if (selectionMode === "create") selection.updateCreate(pt.x, pt.y);
    else if (selectionMode === "drag") selection.updateDrag(pt.x, pt.y);
  }

  function onSelPointerUp(e: PointerEvent) {
    if (!selection) return;
    if (selectionMode === "create") selection.endCreate();
    selection.endDrag();
    selectionMode = null;
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  function onRigPointerDown(e: PointerEvent) {
    if (ui.tool !== "bone" || e.button !== 0) return;
    if (!(e.pointerType === "mouse" || e.pointerType === "pen")) return;
    if (!viewport) return;
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    const pt = viewport.screenToCanvas(e.clientX, e.clientY);
    const hitRadius = RIG_HIT_RADIUS / viewport.zoom;

    const creating = e.shiftKey || (!e.altKey && ui.boneMode === "create");
    const posing = e.altKey || (!e.shiftKey && ui.boneMode === "pose");
    if (!posing) clearPose();

    if (creating) {
      const handleR = HANDLE_HIT_RADIUS / viewport.zoom;
      const onShaft = shaftHit(pt, hitRadius);
      const onTip = tipHit(pt, handleR);
      const onOrigin = onShaft && Math.hypot(pt.x - onShaft.x, pt.y - onShaft.y) < handleR;
      if (onShaft && !onTip && !onOrigin) {
        rigDragBefore = snapshotRig();
        const name = insertJoint(onShaft.name, pt.x, pt.y);
        if (name) {
          ui.selectedBone = name;
          pushRigCommand(rigDragBefore, snapshotRig());
          rigDragBefore = null;
          return;
        }
        rigDragBefore = null;
      }
      // Root counts as an existing parent, so the very first bone can be shift-dragged from
      // empty canvas with nothing placed yet.
      const parent = nearestBone(pt) ?? doc.bones.find((b) => b.name === "root") ?? null;
      if (!parent) return;
      rigDragBefore = snapshotRig();
      const name = addBone(parent.name, pt.x, pt.y);
      if (name) {
        ui.selectedBone = name;
        dragState = { type: "length", bone: name, created: true };
      } else {
        rigDragBefore = null;
      }
      return;
    }
    if (posing) {
      // Same tip-vs-body distinction bone editing uses: grabbing a tip rotates, grabbing the
      // shaft translates. Handle-sized tip hit, segment-sized body hit.
      const handleR = HANDLE_HIT_RADIUS / viewport.zoom;
      const tip = tipHit(pt, handleR);
      if (tip) {
        dragState = { type: "pose", bone: tip.name };
        poseStart = pt;
        poseIsRotate = true;
        poseStartBearing = Math.atan2(pt.y - tip.y, pt.x - tip.x);
        poseDrag = { bone: tip.name, pivot: { x: tip.x, y: tip.y }, dtheta: 0, dx: 0, dy: 0 };
        initPoseSim(tip.name);
        setRigCursor("rotate");
        return;
      }
      const b = shaftHit(pt, hitRadius);
      if (!b) return;
      dragState = { type: "pose", bone: b.name };
      poseStart = pt;
      poseIsRotate = false;
      poseDrag = { bone: b.name, pivot: { x: b.x, y: b.y }, dtheta: 0, dx: 0, dy: 0 };
      initPoseSim(b.name);
      setRigCursor("grabbing");
      return;
    }
    const hover = rigHover(pt);
    if (!hover) {
      ui.selectedBone = null;
      setRigCursor(null);
      return;
    }
    ui.selectedBone = hover.bone.name;
    rigDragBefore = snapshotRig();
    if (hover.kind === "reach") {
      dragState = { type: "reach", bone: hover.bone.name };
      setRigCursor("reach");
    } else if (hover.kind === "rotate") {
      dragState = { type: "length", bone: hover.bone.name };
      setRigCursor("rotate");
    } else {
      dragState = { type: "move", bone: hover.bone.name };
      setRigCursor("grabbing");
    }
  }

  function onRigPointerMove(e: PointerEvent) {
    if (!viewport) return;
    if (ui.tool !== "bone") {
      setRigCursor(null);
      return;
    }
    const pt = viewport.screenToCanvas(e.clientX, e.clientY);
    if (!dragState) {
      setRigCursor(rigHover(pt)?.kind ?? null);
      return;
    }
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
    if (dragState.type === "move" && viewport) {
      const bone = doc.bones.find((b) => b.name === dragState!.bone);
      if (bone) {
        const forbidden = new Set([bone.name, ...descendantsOf(bone.name).map((d) => d.name)]);
        const target = reparentDropTarget(
          { x: bone.x, y: bone.y },
          doc.bones,
          RIG_HIT_RADIUS / viewport.zoom,
          forbidden,
        );
        if (target && bone.parent !== target) setParent(bone.name, target);
      }
    }
    if (rigDragBefore) {
      pushRigCommand(rigDragBefore, snapshotRig());
      rigDragBefore = null;
    }
    const wasPose = dragState.type === "pose";
    dragState = null;
    poseStart = null;
    if (wasPose && poseSim && anyWobble(poseSim.names)) {
      poseSim = { ...poseSim, settling: true };
      startPoseLoop();
    } else if (wasPose) {
      clearPose();
    }
    if (viewport && ui.tool === "bone") {
      setRigCursor(rigHover(viewport.screenToCanvas(e.clientX, e.clientY))?.kind ?? null);
    } else {
      setRigCursor(null);
    }
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  onMount(() => {
    ctx = canvasEl.getContext("2d");
    viewport = new Viewport(anchor);
    viewport.onChange = () => {
      redraw();
      syncSelectionOverlay();
    };
    setupSelection();

    const resizeObserver = new ResizeObserver(() => {
      const rect = stage.getBoundingClientRect();
      canvasEl.width = Math.max(1, Math.round(rect.width));
      canvasEl.height = Math.max(1, Math.round(rect.height));
      overlayEl.width = canvasEl.width;
      overlayEl.height = canvasEl.height;
      syncSelectionOverlay();
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
    canvasEl.addEventListener("pointerdown", onSelPointerDown);
    canvasEl.addEventListener("pointermove", onSelPointerMove);
    canvasEl.addEventListener("pointerup", onSelPointerUp);
    canvasEl.addEventListener("pointercancel", onSelPointerUp);
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
      stopPoseLoop();
      cleanupTouch();
      cleanupInput();
      resizeObserver.disconnect();
      stage.removeEventListener("pointerdown", onStagePointerDown, { capture: true });
      stage.removeEventListener("pointermove", onStagePointerMove, { capture: true });
      stage.removeEventListener("pointerup", onStagePointerUp, { capture: true });
      stage.removeEventListener("pointercancel", onStagePointerUp, { capture: true });
      stage.removeEventListener("wheel", onWheel);
      canvasEl.removeEventListener("pointerdown", onSelPointerDown);
      canvasEl.removeEventListener("pointermove", onSelPointerMove);
      canvasEl.removeEventListener("pointerup", onSelPointerUp);
      canvasEl.removeEventListener("pointercancel", onSelPointerUp);
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
  <canvas bind:this={overlayEl} class="pointer-events-none absolute left-0 top-0 z-10 h-full w-full"></canvas>
  <SelectionActions
    getSelection={() => selection}
    getViewport={() => viewport}
    getContainer={() => stage}
    onTransform={enterTransform}
    onDistort={() => enterWarp(2, 2)}
    onMesh={() => enterWarp(3, 3)}
    onCommit={() => selection?.commit()}
    onCancel={() => selection?.cancel()}
    onDensify={(d) => {
      if (!selection || selection.state !== "warping") return;
      const n = Math.max(2, selection.warpRows + d);
      selection.densifyWarp(n, n);
    }}
    onSetDeformMode={(m) => selection?.setDeformMode(m)}
    onResetPins={() => selection?.resetPins()}
  />
</div>
