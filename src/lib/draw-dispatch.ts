// Extracted from Canvas.svelte by Task 10 (rig mode adds a 7th concern to that file; this is
// Task 9's "which layer takes a stroke, with which brush" concern, unchanged otherwise). Pointer
// events (already parsed into document-space InputPoints by input.ts) land on ui.selectedLayerId's
// own canvas, resolved by id (layer array order is a display concern, not identity). Mild
// pressure-response curve, applied uniformly regardless of brush engine.
import { document as doc, markLayerDirty } from "../state/doc.svelte";
import { ui } from "../state/ui.svelte";
import type { InputPoint } from "../core/input";
import { drawStroke, type BrushSettings } from "../core/brush";
import { drawInkStrokeIncremental, resetInkState } from "../core/ink-brush";
import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
import { floodFill, hexToRgba } from "../core/fill";
import { PressureCurve } from "../core/pressure-curve";
import type { Layer } from "../rig/document";

// Pressure widens/thins the nominal size by this factor; mouse (no pressure) always draws at
// constant nominal width (see widthRange in brush.ts).
const PRESSURE_SIZE_RANGE = 1.8;
const FILL_COLOR = "#000000";

export function createDrawDispatch() {
  const pressureCurve = new PressureCurve();

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
    // Rig mode drives its own pointer handling (see Canvas.svelte); this dispatcher only draws.
    if (ui.mode !== "draw") return;
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

  return { handleStroke };
}
