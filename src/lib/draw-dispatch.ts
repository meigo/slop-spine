// Extracted from Canvas.svelte by Task 10 (bone editing adds a 7th concern to that file; this is
// Task 9's "which layer takes a stroke, with which brush" concern, unchanged otherwise). Pointer
// events (already parsed into document-space InputPoints by input.ts) land on ui.selectedLayerId's
// own canvas, resolved by id (layer array order is a display concern, not identity). Mild
// pressure-response curve, applied uniformly regardless of brush engine.
import { document as doc, markLayerDirty } from "../state/doc.svelte";
import { ui, isPaintTool, type Tool } from "../state/ui.svelte";
import type { InputPoint } from "../core/input";
import { drawStroke, type BrushSettings } from "../core/brush";
import { drawInkStrokeIncremental, resetInkState } from "../core/ink-brush";
import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
import { floodFill, hexToRgba } from "../core/fill";
import { PressureCurve } from "../core/pressure-curve";
import type { Layer } from "../rig/document";
import { pixelCommand } from "../core/history";
import { history } from "../state/history.svelte";

// Pressure widens/thins the nominal size by this factor; mouse (no pressure) always draws at
// constant nominal width (see widthRange in brush.ts).
const PRESSURE_SIZE_RANGE = 1.8;

// Module-level (not inside createDrawDispatch) so Toolbar.svelte's pressure curve editor can
// mutate the same instance handleStroke reads below — createDrawDispatch() runs once, from
// Canvas.svelte's onMount, so a closure-local instance would be unreachable from the toolbar.
export const pressureCurve = new PressureCurve();

export function createDrawDispatch() {
  function resolveSelectedLayer(): Layer | null {
    return doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null;
  }

  function buildBrushSettings(isEraser: boolean): BrushSettings {
    return {
      size: ui.brushSize,
      color: ui.brushValue,
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

  // Same latching idea as strokeLayer above, but for the tool itself: input.ts holds one stroke
  // session open for the whole pointer-down-to-up gesture regardless of tool, and b/e/g/hold-X
  // can all reassign ui.tool mid-gesture. Deciding the gesture's tool once, at its first call, and
  // using that latched value everywhere below (not a fresh read of ui.tool) keeps a gesture that
  // started painting completing as that same tool — eraser stays eraser for the whole gesture even
  // if a hold-X release flips ui.tool back before the pointer lifts, so the final render pass
  // doesn't silently repaint the accumulated path as a brush stroke — with one undo entry pushed
  // and stroke state cleared. It also keeps a gesture that started on the bone tool from ever
  // painting, even if ui.tool becomes a paint tool before release. `null` means no gesture is in
  // flight; reset there on every `done` call so the next gesture re-latches.
  let strokeTool: Tool | null = null;

  // Undo capture. One scratch canvas reused for every stroke: at stroke start the layer is
  // blitted into it with `drawImage` (a GPU copy, no `getImageData`), so at stroke end `before`
  // can be read out of the scratch and `after` out of the live layer at the same (small) rect.
  // A full 2048x2048 ImageData is 16MB; pixelCommand stores two, so capturing the whole canvas
  // per stroke would evict the 256MB-budgeted history after ~8 strokes instead of ~dozens.
  let scratch: HTMLCanvasElement | null = null;
  let scratchCtx: CanvasRenderingContext2D | null = null;

  function ensureScratch(width: number, height: number) {
    if (scratch && scratch.width === width && scratch.height === height) return;
    scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    scratchCtx = scratch.getContext("2d");
  }

  /** Snapshots `layer` into the scratch canvas — the pre-stroke "before" state. Resizing the
   *  scratch canvas already clears it, but the reused case needs an explicit clear: `drawImage`
   *  composites (source-over) onto whatever the scratch held from the previous stroke, and the
   *  layer is transparent wherever nothing is drawn, so leftover scratch pixels would bleed
   *  through and corrupt the captured "before" rect. */
  function captureScratch(layer: Layer) {
    ensureScratch(layer.canvas.width, layer.canvas.height);
    if (!scratchCtx) return;
    scratchCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    scratchCtx.drawImage(layer.canvas, 0, 0);
  }

  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  /** Bounding box of every point touched during the stroke (input.ts hands `handleStroke` the
   *  whole accumulated points array on every call, so the final call already has them all —
   *  no need to track the box incrementally), padded by the brush radius and clamped to the
   *  layer's bounds. */
  function computeDirtyRect(points: InputPoint[], layer: Layer): Rect {
    const pad = (ui.brushSize * PRESSURE_SIZE_RANGE) / 2 + 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const cw = layer.canvas.width;
    const ch = layer.canvas.height;
    const x0 = Math.max(0, Math.min(cw, Math.floor(minX)));
    const y0 = Math.max(0, Math.min(ch, Math.floor(minY)));
    const x1 = Math.max(0, Math.min(cw, Math.ceil(maxX)));
    const y1 = Math.max(0, Math.min(ch, Math.ceil(maxY)));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  /** Pushes one undo command for a pixel edit confined to `rect` on `layer`. Both directions
   *  restore with `putImageData` (replace, not composite — required to keep transparent areas
   *  transparent) then call `markLayerDirty`, so `deriveSlot`'s cache never serves a mesh derived
   *  from pixels an undo/redo just replaced. */
  function pushPixelCommand(layer: Layer, ctx: CanvasRenderingContext2D, rect: Rect, before: ImageData, after: ImageData) {
    const layerId = layer.id;
    history.push(
      pixelCommand(
        () => {
          ctx.putImageData(before, rect.x, rect.y);
          markLayerDirty(layerId);
        },
        () => {
          ctx.putImageData(after, rect.x, rect.y);
          markLayerDirty(layerId);
        },
        before,
        after,
      ),
    );
  }

  function endStroke() {
    strokeLayer = null;
    strokeCtx = null;
    strokeSnapshot = null;
  }

  function handleStroke(points: InputPoint[], done: boolean) {
    // The rig gestures drive their own pointer handling (see Canvas.svelte); this dispatcher only
    // draws, so it stands down for any gesture that didn't start under a painting tool. Latched
    // at the first call of the gesture (see strokeTool above) rather than re-read from ui.tool on
    // every call, and used in place of ui.tool for the rest of this function.
    if (strokeTool === null) strokeTool = ui.tool;
    const tool = strokeTool;
    if (done) strokeTool = null;
    if (!isPaintTool(tool)) return;
    if (points.length === 0) return;

    if (tool === "fill") {
      if (!fillFired) {
        const layer = resolveSelectedLayer();
        const fctx = layer?.canvas.getContext("2d") ?? null;
        if (layer && fctx) {
          const p = points[0];
          // Fill's affected rect is the whole canvas — a getImageData either side of it, not the
          // scratch-canvas dance the stroke path below uses, because fills are rare.
          const cw = layer.canvas.width;
          const ch = layer.canvas.height;
          const before = fctx.getImageData(0, 0, cw, ch);
          floodFill(fctx, p.x, p.y, hexToRgba(ui.brushValue, 100), { alphaThreshold: 128 });
          markLayerDirty(layer.id);
          const after = fctx.getImageData(0, 0, cw, ch);
          pushPixelCommand(layer, fctx, { x: 0, y: 0, w: cw, h: ch }, before, after);
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
      if (strokeLayer) captureScratch(strokeLayer);
    }
    if (!strokeLayer || !strokeCtx) {
      if (done) endStroke();
      return;
    }

    const curved = points.map((p) => ({ ...p, pressure: pressureCurve.evaluate(p.pressure) }));
    const sizeRange = curved[0]?.hasPressure ? PRESSURE_SIZE_RANGE : 1;
    const settings = buildBrushSettings(tool === "eraser");
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
    if (done) {
      if (scratchCtx) {
        const rect = computeDirtyRect(points, strokeLayer);
        const before = scratchCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
        const after = strokeCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
        pushPixelCommand(strokeLayer, strokeCtx, rect, before, after);
      }
      endStroke();
    }
  }

  return { handleStroke };
}
