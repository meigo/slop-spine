<script lang="ts">
  import { onMount } from "svelte";
  import {
    document as doc,
    docLoad,
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
    addLayer,
    type RigSnapshot,
  } from "../state/doc.svelte";
  import {
    ui,
    overlayFlags,
    isSelectTool,
    toolFromKey,
    whyNotEditable,
    editBlockLabel,
    needsEditableLayer,
  } from "../state/ui.svelte";
  import { setClipboardPixels, getClipboardPixels } from "../state/clipboard.svelte";
  import { selectionCommands } from "../state/selection-commands";
  import { boneTip, reparentDropTarget } from "../rig/chain";
  import type { Tool } from "../state/ui.svelte";
  import { Viewport } from "../core/viewport";
  import { setupInput, isStageChromeTarget } from "../core/input";
  import { computeImagePlacement } from "../core/image-fit";
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
  // Paper wrapper: document-sized, CSS-transformed by Viewport (same as slop-paint / animator).
  // Pan/zoom/rotate stay on the GPU; we only re-blit layers when pixels or pose change.
  let paper: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let rigEl: HTMLCanvasElement;
  let overlayEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let rigCtx: CanvasRenderingContext2D | null = null;
  let viewport: Viewport | null = null;
  let didInitialFit = false;
  let compositeRaf = 0;

  // Bumped by the resize observer so the redraw $effect also reruns on container resize.
  let size = $state({ width: 0, height: 0 });

  // --- Bone tool: transient pose-drag offset. This is the ONE piece of rig state that must be
  // $state — it never touches doc.bones (pose is never stored), so it needs its own reactive
  // trigger for the redraw below. Everything else rig-related reads doc.bones/doc.density/ui
  // directly, which are already reactive. `pivot` is the dragged bone's rest origin; `dtheta` is
  // 0 for a body-drag (translate) and the bearing change from a tip-drag (rotate). ---
  let poseDrag = $state<{
    bone: string;
    pivot: { x: number; y: number };
    dtheta: number;
    dx: number;
    dy: number;
  } | null>(null);

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
      const dx =
        follow || !move || wobble <= 0
          ? { pos: target.dx, vel: 0 }
          : stepWobble(prev.dx, target.dx, wobble, dt);
      const dy =
        follow || !move || wobble <= 0
          ? { pos: target.dy, vel: 0 }
          : stepWobble(prev.dy, target.dy, wobble, dt);
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
  function currentPoses() {
    const poseBones = poseSim?.names ?? (poseDrag ? poseNamesFor(poseDrag.bone) : null);
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
    return { poseBones, poseBoneSet: poseBones ? new Set(poseBones) : null, poses };
  }

  /** Composite layers onto the document-sized paper canvas. No pan/zoom — that's CSS. */
  function compositeDisplay() {
    if (!ctx || !canvasEl) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    const { poseBones, poseBoneSet, poses } = currentPoses();
    if (ui.showDrawings) {
      for (const layer of doc.layers) {
        if (!layer.visible) continue;
        ctx.globalAlpha = layer.opacity;
        const warped = poseBones && poses && warpFor(layer.id);
        const hasInfluence =
          warped && warped.weights.some((infs) => infs.some((i) => poseBoneSet!.has(i.bone)));
        if (warped && hasInfluence) {
          const deformed = poseDeform(warped.mesh, warped.weights, poses!);
          drawWarpedLayer(ctx, layer.canvas, warped.mesh, deformed);
        } else {
          ctx.drawImage(layer.canvas, 0, 0);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Bones/meshes on a stage-sized overlay so 1px strokes stay 1 screen px (not CSS-scaled). */
  function redrawRig() {
    if (!rigCtx || !rigEl || !viewport) return;
    rigCtx.setTransform(1, 0, 0, 1, 0, 0);
    rigCtx.clearRect(0, 0, rigEl.width, rigEl.height);
    const flags = overlayFlags(ui.tool, ui.showBones, ui.showMeshes);
    if (!(flags.bones || flags.mesh || flags.tint || flags.capsule)) return;
    rigCtx.translate(viewport.panX, viewport.panY);
    rigCtx.rotate(viewport.rotation);
    rigCtx.scale(viewport.zoom, viewport.zoom);
    const { poses } = currentPoses();
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
    drawRigOverlay(
      rigCtx,
      { bones: overlayBones, selectedBone: ui.selectedBone, slots },
      viewport.zoom,
      flags,
    );
  }

  function redraw() {
    compositeDisplay();
    redrawRig();
  }

  function scheduleComposite() {
    if (compositeRaf) return;
    compositeRaf = requestAnimationFrame(() => {
      compositeRaf = 0;
      compositeDisplay();
    });
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

  // Document size the view was last fitted to. A read-back of `canvasEl.width` cannot stand in
  // for this: the template's `width={doc.canvas.width}` is a render effect, and render effects
  // flush before user effects, so by the time this runs canvasEl already matches and the resize
  // would never be noticed.
  let fittedW = 0;
  let fittedH = 0;

  $effect(() => {
    const w = doc.canvas.width;
    const h = doc.canvas.height;
    if (!canvasEl || !paper) return;
    // Paper is sized here rather than with a `style=` attribute in the template. Svelte compiles
    // that to set_style(), which assigns `style.cssText` wholesale — wiping the transform and
    // transform-origin the Viewport writes to this same element. The Viewport's pan/zoom state
    // survived that wipe, so the canvas jumped to the top-left while strokes still landed at the
    // old transform's coordinates, until the next zoom re-applied it.
    paper.style.width = `${w}px`;
    paper.style.height = `${h}px`;
    if (w === fittedW && h === fittedH) return;
    fittedW = w;
    fittedH = h;
    canvasEl.width = w;
    canvasEl.height = h;
    viewport?.fitView(w, h);
  });

  // Per-document transient state, dropped on load rather than on size change. A project opened at
  // the same canvas size never reaches the branch above, and a marquee now survives tool switches
  // and clips brush/eraser/fill — so without this, painting in the new document stays confined to
  // a selection that belonged to the old one.
  $effect(() => {
    void docLoad.count;
    clearPose();
    if (selection?.active) selection.cancel();
  });

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

  let selection: Selection | null = null;

  const activeLayer = $derived(doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null);
  const editBlock = $derived(whyNotEditable(activeLayer));
  const toolBlocked = $derived(needsEditableLayer(ui.tool) && editBlock !== null);
  const editBlockCaption = $derived(toolBlocked && editBlock ? editBlockLabel(editBlock) : null);

  $effect(() => {
    void ui.tool;
    if (!selection) return;
    // Only the select/lasso tools own the marquee *shape*. Switching to brush must not
    // flip a lasso into a rect, or applyClip would drop the path.
    if (isSelectTool(ui.tool)) selection.mode = ui.tool === "lasso" ? "lasso" : "rect";
    // A floating transform/warp has uncommitted pixels and must resolve. A plain marquee
    // survives so brush/eraser/fill can clip to it (same as slop-paint / animator).
    if (!isSelectTool(ui.tool) && selection.hasFloating) selection.commit();
  });

  const drawDispatch = createDrawDispatch({
    onPainted: scheduleComposite,
    getSelection: () => selection,
  });

  function transformCoords(sx: number, sy: number): { x: number; y: number } {
    return viewport ? viewport.screenToCanvas(sx, sy) : { x: sx, y: sy };
  }

  // --- Mouse pan (middle-button or space+drag) and wheel zoom. ---
  let spaceHeld = $state(false);
  let panning = $state(false);

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
    // Selection clipboard. Copy/cut need a marquee; paste reports whether it consumed the gesture,
    // and a decline falls through to the window `paste` listener, which imports an image instead.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      copySelection();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "x") {
      cutSelection();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      // No return: a decline must still reach the browser's own paste, which fires the window
      // `paste` listener that imports an image.
      pasteSelection();
      return;
    }
    // Plain digits, matching slop-animator's `0` for fit — NOT slop-paint's Cmd/Ctrl+0 and +1.
    // Browsers reserve those two for page-zoom-reset and switch-to-tab-N and handle them ahead of
    // the page, so preventDefault cannot claim them: the app command never runs and the browser
    // does something disruptive instead. Digits are free here (tool keys are letters) and this
    // handler already bails inside INPUT/TEXTAREA/SELECT.
    if (!e.metaKey && !e.ctrlKey && e.key === "0") {
      e.preventDefault();
      viewport?.fitView(doc.canvas.width, doc.canvas.height);
      return;
    }
    if (!e.metaKey && !e.ctrlKey && e.key === "1") {
      e.preventDefault();
      viewport?.actualSizeView(doc.canvas.width, doc.canvas.height);
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
    // An active marquee takes Delete before the selected bone does: the marquee is the more recent,
    // more visible intent, and it is dismissed with Escape, so the bone is one keystroke away.
    if (e.key === "Backspace" || e.key === "Delete") {
      if (selection?.state === "selected") {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (ui.selectedBone) {
        e.preventDefault();
        const before = snapshotRig();
        removeBone(ui.selectedBone);
        ui.selectedBone = null;
        pushRigCommand(before, snapshotRig());
      }
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

  // --- Bone-tool gestures. Runs alongside setupInput's own listeners on stage (handleStroke
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
  function snapToBoneEnd(
    pt: { x: number; y: number },
    exclude: string,
    radius: number,
  ): { x: number; y: number } {
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

  // --- Selection clipboard commands. Registered on `selectionCommands` in onMount so the toolbar
  // row and the keyboard both reach the same implementations. Each resolves the layer through
  // `whyNotEditable`, so a hidden or missing layer refuses here exactly as painting does. ---

  /** Document px a paste is nudged by, so pasting over the source reads as a second copy. */
  const PASTE_OFFSET = 8;

  /** The clipboard hands out the same canvas on every paste; the float takes ownership of the
   *  pixels it is given (commit/cancel can discard it), so each paste gets its own copy. */
  function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d")?.drawImage(src, 0, 0);
    return c;
  }

  /** The layer these commands act on, or null when it cannot be written. */
  function commandLayer() {
    const layer = doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null;
    return layer && !whyNotEditable(layer) ? layer : null;
  }

  function copySelection() {
    if (!selection || selection.state !== "selected") return;
    const layer = commandLayer();
    const lctx = layer?.canvas.getContext("2d");
    if (!layer || !lctx || !selection.rect) return;
    // copyPixelsFromDoc is lasso-aware: a lasso copies only what is inside its path, not the AABB.
    const cvs = selection.copyPixelsFromDoc(lctx, 1);
    if (cvs) setClipboardPixels(cvs, selection.rect);
  }

  function deleteSelection() {
    if (!selection || selection.state !== "selected") return;
    const layer = commandLayer();
    const lctx = layer?.canvas.getContext("2d");
    if (!layer || !lctx) return;
    const cw = layer.canvas.width;
    const ch = layer.canvas.height;
    const before = lctx.getImageData(0, 0, cw, ch);
    selection.clearRegion(lctx, 1);
    const after = lctx.getImageData(0, 0, cw, ch);
    markLayerDirty(layer.id);
    history.push(
      pixelCommand(
        () => {
          lctx.putImageData(before, 0, 0);
          markLayerDirty(layer.id);
        },
        () => {
          lctx.putImageData(after, 0, 0);
          markLayerDirty(layer.id);
        },
        before,
        after,
      ),
    );
    // Nothing is floating, so onCancel no-ops — this just drops the marquee.
    selection.cancel();
    scheduleComposite();
  }

  function cutSelection() {
    copySelection();
    deleteSelection();
  }

  /** Paste the pixel clipboard as a float on the active layer. Returns false when there is nothing
   *  to paste or nowhere to put it, so Cmd+V can fall through to importing an image instead. */
  function pasteSelection(): boolean {
    const clip = getClipboardPixels();
    if (!clip || !selection) return false;
    const layer = commandLayer();
    const lctx = layer?.canvas.getContext("2d");
    if (!layer || !lctx) return false;
    // A float already in flight has uncommitted pixels; bake it before starting another.
    if (selection.hasFloating) selection.commit();
    // Same bracket the lift path sets up, so commit bakes and cancel restores.
    selBefore = lctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    selCtx = lctx;
    selLayerId = layer.id;
    const r = clip.rect;
    // Offset so a paste over its own source is visibly a separate copy rather than a no-op.
    selection.pasteFloat(cloneCanvas(clip.canvas), {
      x: r.x + PASTE_OFFSET,
      y: r.y + PASTE_OFFSET,
      w: r.w,
      h: r.h,
    });
    redraw();
    return true;
  }

  function deselectSelection() {
    selection?.cancel();
  }

  // --- Image import: an external image becomes its own layer, never a float. addLayer already
  // creates the matching rig slot and bind, so a pasted image is riggable the moment it lands. ---

  async function pasteImageAsLayer(blob: Blob) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (e) {
      console.error("paste image failed", e);
      alert("Couldn't read that image.");
      return;
    }
    const id = addLayer("pasted");
    const layer = doc.layers.find((l) => l.id === id);
    const lctx = layer?.canvas.getContext("2d");
    if (!layer || !lctx) {
      bitmap.close();
      return;
    }
    const p = computeImagePlacement(
      bitmap.width,
      bitmap.height,
      layer.canvas.width,
      layer.canvas.height,
    );
    lctx.drawImage(bitmap, p.x, p.y, p.w, p.h);
    bitmap.close();
    markLayerDirty(layer.id);
    ui.selectedLayerId = layer.id;
    scheduleComposite();
  }

  /** The no-keyboard path (iPad), driven from the File menu. The async Clipboard API only exists in
   *  a secure context, which the LAN dev server over plain http is not — say so rather than failing
   *  with a bare permission error. Same message slop-animator shows. */
  async function pasteImageFromSystemClipboard() {
    if (!navigator.clipboard?.read) {
      alert(
        "Clipboard paste needs HTTPS. On iPad, open the app over https, or use Cmd+V with a keyboard.",
      );
      return;
    }
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          await pasteImageAsLayer(await item.getType(type));
          return;
        }
      }
      alert("No image found in the clipboard.");
    } catch {
      alert("Couldn't read the clipboard (permission denied or unsupported).");
    }
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
    selection.onStateChange = () => {
      ui.selectionActive = selection?.state === "selected";
      syncSelectionOverlay();
    };
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
    if (editBlock) return;
    if (!(e.pointerType === "mouse" || e.pointerType === "pen")) return;
    // Svelte 5 delegates the panel's onpointerdown to document, so this native
    // stage listener fires first. Without this, Transform/Distort look like
    // "click outside" and cancel the selection. Same guard as setupInput.
    if (isStageChromeTarget(e.target)) return;
    if (!viewport || !selection) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
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
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  function onRigPointerDown(e: PointerEvent) {
    if (ui.tool !== "bone" || e.button !== 0) return;
    if (!(e.pointerType === "mouse" || e.pointerType === "pen")) return;
    if (!viewport) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
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
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  onMount(() => {
    canvasEl.width = doc.canvas.width;
    canvasEl.height = doc.canvas.height;
    ctx = canvasEl.getContext("2d");
    rigCtx = rigEl.getContext("2d");
    viewport = new Viewport(paper);
    viewport.onChange = () => {
      redrawRig();
      syncSelectionOverlay();
    };
    setupSelection();

    const resizeObserver = new ResizeObserver(() => {
      const rect = stage.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      overlayEl.width = w;
      overlayEl.height = h;
      rigEl.width = w;
      rigEl.height = h;
      syncSelectionOverlay();
      redrawRig();
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
      onViewportChange: () => {},
    });

    const cleanupInput = setupInput(stage, drawDispatch.handleStroke, transformCoords);

    // Capture-phase on `stage` so a pan preempts input.ts's bubble-phase listeners
    // (same precedence slop-animator's Canvas.svelte uses).
    stage.addEventListener("pointerdown", onStagePointerDown, { capture: true });
    stage.addEventListener("pointermove", onStagePointerMove, { capture: true });
    stage.addEventListener("pointerup", onStagePointerUp, { capture: true });
    stage.addEventListener("pointercancel", onStagePointerUp, { capture: true });
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onSelPointerDown);
    stage.addEventListener("pointermove", onSelPointerMove);
    stage.addEventListener("pointerup", onSelPointerUp);
    stage.addEventListener("pointercancel", onSelPointerUp);
    stage.addEventListener("pointerdown", onRigPointerDown);
    stage.addEventListener("pointermove", onRigPointerMove);
    stage.addEventListener("pointerup", onRigPointerUp);
    stage.addEventListener("pointercancel", onRigPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // Bridge for Toolbar.svelte's "Fit View" button — the viewport instance is local to this
    // component (needs its own anchor element), so a window event is the smallest cross-component
    // link back to it. See Toolbar.svelte's dispatch.
    const onFitViewRequest = () => viewport?.fitView(doc.canvas.width, doc.canvas.height);
    const onActualSizeRequest = () => viewport?.actualSizeView(doc.canvas.width, doc.canvas.height);
    window.addEventListener("slop-spine:fit-view", onFitViewRequest);
    window.addEventListener("slop-spine:actual-size", onActualSizeRequest);

    selectionCommands.copy = copySelection;
    selectionCommands.cut = cutSelection;
    selectionCommands.paste = pasteSelection;
    selectionCommands.del = deleteSelection;
    selectionCommands.deselect = deselectSelection;

    // Image import. Precedence is read straight off the clipboard rather than latched from the
    // keydown: a flag set by Cmd/Ctrl+V is only cleared by a FOLLOWING paste event, so a keystroke
    // that produced no paste event left it armed and silently ate the next real image paste. A
    // non-empty pixel clipboard simply means the keydown already handled this — importing an image
    // while pixels are held is what File > "Paste image as layer" is for. The listener is on window
    // because a paste has no pointer target and the stage is not focusable.
    const onWindowPaste = (e: ClipboardEvent) => {
      if (getClipboardPixels()) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (blob) {
            e.preventDefault();
            void pasteImageAsLayer(blob);
          }
          return;
        }
      }
    };
    window.addEventListener("paste", onWindowPaste);
    const onPasteImageRequest = () => void pasteImageFromSystemClipboard();
    window.addEventListener("slop-spine:paste-image", onPasteImageRequest);

    return () => {
      stopPoseLoop();
      if (compositeRaf) cancelAnimationFrame(compositeRaf);
      cleanupTouch();
      cleanupInput();
      resizeObserver.disconnect();
      stage.removeEventListener("pointerdown", onStagePointerDown, { capture: true });
      stage.removeEventListener("pointermove", onStagePointerMove, { capture: true });
      stage.removeEventListener("pointerup", onStagePointerUp, { capture: true });
      stage.removeEventListener("pointercancel", onStagePointerUp, { capture: true });
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onSelPointerDown);
      stage.removeEventListener("pointermove", onSelPointerMove);
      stage.removeEventListener("pointerup", onSelPointerUp);
      stage.removeEventListener("pointercancel", onSelPointerUp);
      stage.removeEventListener("pointerdown", onRigPointerDown);
      stage.removeEventListener("pointermove", onRigPointerMove);
      stage.removeEventListener("pointerup", onRigPointerUp);
      stage.removeEventListener("pointercancel", onRigPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("slop-spine:fit-view", onFitViewRequest);
      window.removeEventListener("slop-spine:actual-size", onActualSizeRequest);
      window.removeEventListener("paste", onWindowPaste);
      window.removeEventListener("slop-spine:paste-image", onPasteImageRequest);
      // Leaving these bound would let the toolbar drive a destroyed canvas's marquee.
      selectionCommands.copy = null;
      selectionCommands.cut = null;
      selectionCommands.paste = null;
      selectionCommands.del = null;
      selectionCommands.deselect = null;
    };
  });
</script>

<div
  bind:this={stage}
  class="relative size-full touch-none overflow-hidden bg-canvas-bg"
  class:cursor-not-allowed={toolBlocked && !panning && !spaceHeld}
>
  <!-- No `style=` here: the Viewport owns this element's inline style (see the sizing $effect). -->
  <div bind:this={paper} class="absolute top-0 left-0 will-change-transform">
    <div
      class="pointer-events-none absolute inset-0 {ui.whiteBg ? 'paper-white' : 'paper-checker'}"
    ></div>
    <canvas
      bind:this={canvasEl}
      class="absolute top-0 left-0"
      width={doc.canvas.width}
      height={doc.canvas.height}
      style="width: {doc.canvas.width}px; height: {doc.canvas.height}px"
    ></canvas>
  </div>
  <canvas bind:this={rigEl} class="pointer-events-none absolute inset-0 z-5"></canvas>
  <canvas bind:this={overlayEl} class="pointer-events-none absolute inset-0 z-10"></canvas>
  {#if editBlockCaption}
    <div
      class="pointer-events-none absolute top-2 left-2 z-10 rounded bg-surface/70 px-1.5 py-0.5 text-xs text-amber-500"
    >
      {editBlockCaption}
    </div>
  {/if}
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
