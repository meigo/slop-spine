<script lang="ts">
  import { onMount } from "svelte";
  import {
    document as doc,
    addBone,
    moveBone,
    setBoneLength,
    setBoneRotation,
  } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import { Viewport } from "../core/viewport";
  import { setupInput } from "../core/input";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { createDrawDispatch } from "./draw-dispatch";
  import { history } from "../state/history.svelte";
  import { deriveSlot } from "../rig/derive";
  import { drawRigOverlay, poseDeform, drawWarpedLayer } from "./RigOverlay";
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
  // directly, which are already reactive. ---
  let poseDrag = $state<{ bone: string; dx: number; dy: number } | null>(null);

  function redraw() {
    if (!ctx || !viewport || !canvasEl) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.translate(viewport.panX, viewport.panY);
    ctx.rotate(viewport.rotation);
    ctx.scale(viewport.zoom, viewport.zoom);
    // Page bounds, screen-draw only (never fills a layer.canvas — export trims each layer to its
    // own alpha, so an opaque layer would trim to the full page). White is the expected ground:
    // this project's art is grayscale line work on white over transparent layers. The border
    // keeps the edge visible once the fill is too small on screen to read as a page.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, doc.canvas.width, doc.canvas.height);
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(0, 0, doc.canvas.width, doc.canvas.height);

    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      const warped = poseDrag && warpFor(layer.id, poseDrag.bone);
      if (warped) {
        const deformed = poseDeform(warped.mesh, warped.weights, poseDrag!.bone, poseDrag!.dx, poseDrag!.dy);
        drawWarpedLayer(ctx, layer.canvas, warped.mesh, deformed);
      } else {
        ctx.drawImage(layer.canvas, 0, 0);
      }
    }
    ctx.globalAlpha = 1;

    if (ui.mode === "rig") {
      const slot = doc.slots.find((s) => s.layerId === ui.selectedLayerId);
      const derived = slot ? deriveSlot(doc, slot.name) : null;
      drawRigOverlay(
        ctx,
        {
          bones: doc.bones,
          selectedBone: ui.selectedBone,
          mesh: derived?.mesh ?? null,
          weights: derived?.weights ?? null,
        },
        viewport.zoom,
      );
    }
  }

  /** The slot bound to `layer`, if `bone` is among its influencing bones — that's the mesh/weights
   *  a live pose-drag on `bone` needs to warp that layer's drawing. */
  function warpFor(layerId: number, bone: string) {
    const slot = doc.slots.find((s) => s.layerId === layerId);
    if (!slot) return null;
    const bindBones = doc.binds.find((b) => b.slot === slot.name)?.bones ?? [];
    if (!bindBones.includes(bone)) return null;
    return deriveSlot(doc, slot.name);
  }

  $effect(() => {
    // Track layer identity + the fields that affect the picture, plus container size.
    void doc.layers.map((l) => [l.id, l.visible, l.opacity, l.revision]);
    void size.width;
    void size.height;
    // Rig mode: mode/selection changes and bone edits also need a redraw. doc.bones is read
    // field-by-field (not just .length) so dragging a bone re-triggers this.
    void ui.mode;
    void ui.selectedBone;
    void ui.selectedLayerId;
    void doc.density;
    void doc.bones.map((b) => [b.name, b.x, b.y, b.rotation, b.length]);
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
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === " ") spaceHeld = false;
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
  function onWheel(e: WheelEvent) {
    if (!viewport) return;
    e.preventDefault();
    viewport.zoomAt(e.clientX, e.clientY, e.deltaY);
  }

  // --- Rig mode: bones. Runs alongside setupInput's own listeners on canvasEl (handleStroke
  // no-ops outside draw mode, so the two never fight over a stroke). Raw PointerEvents rather than
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

  type DragState = { type: "move" | "length"; bone: string } | { type: "pose"; bone: string };
  let dragState: DragState | null = null;
  let poseStart: { x: number; y: number } | null = null;

  function onRigPointerDown(e: PointerEvent) {
    if (ui.mode !== "rig" || e.button !== 0) return;
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
        dragState = { type: "length", bone: name };
      }
      return;
    }
    if (e.altKey) {
      const b = nearestBone(pt);
      if (!b) return;
      dragState = { type: "pose", bone: b.name };
      poseStart = pt;
      poseDrag = { bone: b.name, dx: 0, dy: 0 };
      return;
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
    if (dragState.type === "move") {
      moveBone(dragState.bone, pt.x, pt.y);
    } else if (dragState.type === "length") {
      const bone = doc.bones.find((b) => b.name === dragState!.bone);
      if (bone) {
        const dx = pt.x - bone.x;
        const dy = pt.y - bone.y;
        setBoneLength(dragState.bone, Math.hypot(dx, dy));
        setBoneRotation(dragState.bone, (Math.atan2(dy, dx) * 180) / Math.PI);
      }
    } else if (dragState.type === "pose" && poseStart && poseDrag) {
      poseDrag.dx = pt.x - poseStart.x;
      poseDrag.dy = pt.y - poseStart.y;
    }
  }

  function onRigPointerUp(e: PointerEvent) {
    if (!dragState) return;
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
      onToggleEraser: () => {},
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
    };
  });
</script>

<div bind:this={stage} class="relative h-full w-full touch-none overflow-hidden bg-neutral-950">
  <div bind:this={anchor} class="absolute h-0 w-0"></div>
  <canvas bind:this={canvasEl} class="absolute left-0 top-0 h-full w-full"></canvas>
</div>
