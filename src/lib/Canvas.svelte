<script lang="ts">
  import { onMount } from "svelte";
  import { document as doc, markLayerDirty } from "../state/doc.svelte";
  import { ui } from "../state/ui.svelte";
  import { Viewport } from "../core/viewport";
  import { setupInput, type InputPoint } from "../core/input";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { drawStroke, type BrushSettings } from "../core/brush";
  import { drawInkStrokeIncremental, resetInkState } from "../core/ink-brush";
  import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
  import { floodFill, hexToRgba } from "../core/fill";
  import { PressureCurve } from "../core/pressure-curve";
  import type { Layer } from "../rig/document";

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
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  $effect(() => {
    // Track layer identity + the fields that affect the picture, plus container size.
    void doc.layers.map((l) => [l.id, l.visible, l.opacity, l.revision]);
    void size.width;
    void size.height;
    redraw();
  });

  // --- Drawing: pointer events (already parsed into document-space InputPoints by input.ts) land
  // on ui.selectedLayerId's own canvas, resolved by id (layer array order is a display concern,
  // not identity). Mild pressure-response curve, applied uniformly regardless of brush engine. ---
  const pressureCurve = new PressureCurve();
  // Pressure widens/thins the nominal size by this factor; mouse (no pressure) always draws at
  // constant nominal width (see widthRange in brush.ts).
  const PRESSURE_SIZE_RANGE = 1.8;
  const FILL_COLOR = "#000000";

  function resolveSelectedLayer(): Layer | null {
    return doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null;
  }

  function buildBrushSettings(isEraser: boolean): BrushSettings {
    return {
      size: ui.brushSize,
      color: FILL_COLOR,
      opacity: ui.brushOpacity,
      smoothing: 0,
      isEraser,
      drawBehind: false,
      alphaLock: false,
    };
  }

  // Locked to the layer the current stroke started on, so a mid-stroke selection change (unlikely,
  // but possible via a keyboard shortcut) can't redirect it mid-flight.
  let strokeLayer: Layer | null = null;
  let strokeCtx: CanvasRenderingContext2D | null = null;
  let strokeSnapshot: ImageData | null = null;
  let fillFired = false;

  function endStroke() {
    strokeLayer = null;
    strokeCtx = null;
    strokeSnapshot = null;
  }

  function handleStroke(points: InputPoint[], done: boolean) {
    if (points.length === 0) return;

    if (ui.tool === "fill") {
      if (!fillFired) {
        const layer = resolveSelectedLayer();
        const fctx = layer?.canvas.getContext("2d") ?? null;
        if (layer && fctx) {
          const p = points[0];
          floodFill(fctx, p.x, p.y, hexToRgba(FILL_COLOR, 100), { alphaThreshold: 128 });
          markLayerDirty(layer.id);
        }
        fillFired = true;
      }
      if (done) fillFired = false;
      return;
    }

    if (!strokeLayer) {
      strokeLayer = resolveSelectedLayer();
      strokeCtx = strokeLayer ? strokeLayer.canvas.getContext("2d") : null;
      strokeSnapshot = strokeCtx
        ? strokeCtx.getImageData(0, 0, strokeCtx.canvas.width, strokeCtx.canvas.height)
        : null;
      resetInkState();
      resetStampState();
    }
    if (!strokeLayer || !strokeCtx) {
      if (done) endStroke();
      return;
    }

    const curved = points.map((p) => ({ ...p, pressure: pressureCurve.evaluate(p.pressure) }));
    const sizeRange = curved[0]?.hasPressure ? PRESSURE_SIZE_RANGE : 1;
    const settings = buildBrushSettings(ui.tool === "eraser");
    const brushType = ui.brushType; // local so TS narrows it across the branches

    if (brushType === "smooth") {
      // perfect-freehand renders the whole path every call, so each call must restore the
      // pre-stroke snapshot first or the shape would double up on itself.
      if (strokeSnapshot) strokeCtx.putImageData(strokeSnapshot, 0, 0);
      drawStroke(strokeCtx, curved, settings, done, sizeRange);
    } else if (brushType === "ink") {
      drawInkStrokeIncremental(strokeCtx, curved, settings, sizeRange);
    } else {
      drawStampStrokeIncremental(strokeCtx, curved, { ...settings, brushType }, sizeRange);
    }

    markLayerDirty(strokeLayer.id);
    if (done) endStroke();
  }

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
      onUndo: () => {},
      onRedo: () => {},
      onToggleEraser: () => {},
      onViewportChange: redraw,
    });

    const cleanupInput = setupInput(canvasEl, handleStroke, transformCoords);

    // Capture-phase on `stage` so a pan preempts input.ts's bubble-phase listeners on `canvasEl`
    // (same precedence slop-animator's Canvas.svelte uses).
    stage.addEventListener("pointerdown", onStagePointerDown, { capture: true });
    stage.addEventListener("pointermove", onStagePointerMove, { capture: true });
    stage.addEventListener("pointerup", onStagePointerUp, { capture: true });
    stage.addEventListener("pointercancel", onStagePointerUp, { capture: true });
    stage.addEventListener("wheel", onWheel, { passive: false });
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
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });
</script>

<div bind:this={stage} class="relative h-full w-full touch-none overflow-hidden bg-neutral-950">
  <div bind:this={anchor} class="absolute h-0 w-0"></div>
  <canvas bind:this={canvasEl} class="absolute left-0 top-0 h-full w-full"></canvas>
</div>
