// Extracted from Canvas.svelte by Task 10 (bone editing adds a 7th concern to that file; this is
// Task 9's "which layer takes a stroke, with which brush" concern, unchanged otherwise). Pointer
// events (already parsed into document-space InputPoints by input.ts) land on ui.selectedLayerId's
// own canvas, resolved by id (layer array order is a display concern, not identity). Mild
// pressure-response curve, applied uniformly regardless of brush engine.
import { document as doc, markLayerDirty, clearLayerPixels } from "../state/doc.svelte";
import {
  ui,
  isPaintTool,
  whyNotEditable,
  editBlockLabel,
  slotFor,
  pressureCurves,
  flashStatus,
  type Tool,
} from "../state/ui.svelte";
import type { InputPoint } from "../core/input";
import { drawStroke, widthRange, type BrushSettings } from "../core/brush";
import { drawInkStroke, MAX_DWELL_SWELL } from "../core/ink-brush";
import { drawDryStroke } from "../core/dry-brush";
import { pathSmoothRadius } from "../core/stroke-smoothing";
import { settledIndex } from "../core/stroke-freeze";
import { drawCalligraphyStroke } from "../core/calligraphy-brush";
import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
import { floodFill, hexToRgba, enclosedFillRegion, fillRegionBehind } from "../core/fill";
import { clampGap } from "../core/fill-holes";
import type { Layer } from "../rig/document";
import type { Selection } from "../core/selection";
import { pixelCommand } from "../core/history";
import { history, setStrokeOpen } from "../state/history.svelte";

let getSelection: () => Selection | null = () => null;

/** Clip subsequent draws to the marching-ants marquee. No-op when idle or floating.
 *  `finally`, because `ctx` is the layer's own long-lived context: a throw in `draw` that skipped
 *  `restore` would strand the clip there and silently confine every later stroke on that layer. */
function withClip(ctx: CanvasRenderingContext2D, draw: () => void) {
  ctx.save();
  try {
    getSelection()?.applyClip(ctx);
    draw();
  } finally {
    ctx.restore();
  }
}

/** Flood/enclosed fill writes unconstrained ImageData, so paint on a copy then composite through
 *  the clip, and through the layer's alpha lock (`source-atop`: only where pixels already are). */
function fillThroughClip(
  ctx: CanvasRenderingContext2D,
  paint: (target: CanvasRenderingContext2D) => void,
  alphaLock = false,
) {
  const sel = getSelection();
  const clipSel = sel?.state === "selected" ? sel : null;
  if (clipSel || alphaLock) {
    const tmp = document.createElement("canvas");
    tmp.width = ctx.canvas.width;
    tmp.height = ctx.canvas.height;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    tctx.drawImage(ctx.canvas, 0, 0);
    paint(tctx);
    ctx.save();
    try {
      clipSel?.applyClip(ctx);
      // `copy`, not the default source-over: tmp starts as a copy of this very layer, so blending it
      // back would composite every pixel inside the clip with itself — a stroke edge at alpha 0.5
      // becomes 0.75, darkening again on each fill. `copy` replaces instead, and the clip limits it
      // to the marquee. Cost: on an anti-aliased lasso edge the boundary pixels become src*coverage
      // rather than a blend, leaving a hairline seam. A rect marquee is pixel-exact.
      ctx.globalCompositeOperation = alphaLock ? "source-atop" : "copy";
      ctx.drawImage(tmp, 0, 0);
    } finally {
      // Leaking `copy` onto the layer's persistent context would make every later draw erase.
      ctx.restore();
    }
  } else {
    paint(ctx);
  }
}

// Pressure widens/thins the nominal size by this factor; mouse (no pressure) always draws at
// constant nominal width (see widthRange in brush.ts).
function pressFor(tool: Tool): number {
  return ui.stroke[slotFor(tool)].press;
}

/** Clear the selected layer to transparent — Edit ▸ Clear layer and the panel's Clear. Refused,
 *  with the reason, where the pen is refused (slop-paint e745612): it used to wipe a hidden layer,
 *  an edit you couldn't see. */
export function clearSelectedLayer() {
  const layer = doc.layers.find((l) => l.id === ui.selectedLayerId);
  const block = whyNotEditable(layer);
  if (block || !layer) {
    flashStatus(`Clear layer — ${editBlockLabel(block ?? "no-layer")}`);
    return;
  }
  clearLayerPixels(layer.id);
}

/** Fill every ink-enclosed region on the selected layer, behind the strokes. */
export function fillAllEnclosed() {
  const layer = doc.layers.find((l) => l.id === ui.selectedLayerId);
  const ctx = layer?.canvas.getContext("2d");
  if (!layer || !ctx || whyNotEditable(layer)) return;
  // Fill enclosed paints BEHIND the strokes, into transparent pixels — exactly what a locked
  // transparency refuses — so say so rather than run and change nothing.
  if (layer.alphaLock) {
    flashStatus("Fill enclosed — the layer's transparency is locked");
    return;
  }
  const { region, area } = enclosedFillRegion(layer.canvas, {
    gap: clampGap(ui.fillGap),
    expand: Math.max(0, Math.floor(ui.fillExpand)),
  });
  if (area === 0) {
    flashStatus("Nothing enclosed — the outline isn't closed, or is already filled");
    return;
  }
  const cw = layer.canvas.width;
  const ch = layer.canvas.height;
  const before = ctx.getImageData(0, 0, cw, ch);
  fillThroughClip(ctx, (target) => {
    fillRegionBehind(target, region, hexToRgba(ui.fillValue, ui.fillOpacity));
  });
  markLayerDirty(layer.id);
  const after = ctx.getImageData(0, 0, cw, ch);
  history.push(
    pixelCommand(
      () => {
        ctx.putImageData(before, 0, 0);
        markLayerDirty(layer.id);
      },
      () => {
        ctx.putImageData(after, 0, 0);
        markLayerDirty(layer.id);
      },
      before,
      after,
    ),
  );
}

export function createDrawDispatch(opts?: {
  onPainted?: () => void;
  getSelection?: () => Selection | null;
  /** Screen px per document px: Smooth's radius is a screen distance (`pathSmoothRadius`). */
  getZoom?: () => number;
}) {
  // Assigned unconditionally: a dispatch created without a selection source must leave the module
  // reading `null`, not the previous Canvas instance's (possibly destroyed) selection.
  getSelection = opts?.getSelection ?? (() => null);
  function resolveSelectedLayer(): Layer | null {
    const layer = doc.layers.find((l) => l.id === ui.selectedLayerId) ?? null;
    return whyNotEditable(layer) ? null : layer;
  }

  function buildBrushSettings(tool: Tool, layer: Layer): BrushSettings {
    const slot = ui.stroke[slotFor(tool)];
    const isEraser = tool === "eraser";
    return {
      size: slot.size,
      color: ui.brushValue,
      opacity: slot.opacity,
      smoothing: slot.smoothing,
      pathSmoothRadius: pathSmoothRadius(slot.smoothing, opts?.getZoom?.() ?? 1),
      sharpCorners: ui.sharpCorners,
      isEraser,
      // Brush only, as slop-paint: the eraser ignores draw-behind.
      drawBehind: !isEraser && ui.drawBehind,
      alphaLock: layer.alphaLock ?? false,
      nibAngle: ui.nibAngle,
      nibFlatness: ui.nibFlatness,
      dwellPool: ui.dwellPool,
      dryness: ui.dryness,
      dryTaper: ui.dryTaper,
      pencilGrade: ui.pencilGrade,
      charcoalTexture: ui.charcoalTexture,
      taper: ui.taper,
    };
  }

  // Locked to the layer the current stroke started on, so a mid-stroke selection change (unlikely,
  // but possible via a keyboard shortcut) can't redirect it mid-flight.
  let strokeLayer: Layer | null = null;
  let strokeCtx: CanvasRenderingContext2D | null = null;
  let fillFired = false;
  let lastPoints: InputPoint[] = [];
  let drawRaf = 0;

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

  /**
   * Freezing a long stroke (slop-paint b89284d). Ink and Calligraphy redraw the whole stroke every
   * frame (a piecewise draw would composite edge pixels many times and harden them), so a frame
   * cost more the longer the stroke — laggy on iPad after ~20 s of Pencil. For an OPAQUE stroke
   * the settled part — far enough behind the pen that new points can no longer change it — is
   * baked every `FREEZE_STEP` points into `frozen`, a copy of the pre-stroke layer that each frame
   * then restores from, so only the rest is redrawn. The engines draw a RANGE of the stroke from
   * geometry worked out over the whole of it, so the baked part is the same pixels; each draw
   * starts `FREEZE_OVERLAP` points early, so the cut lies inside paint and can't show as a seam
   * (opaque paint drawn twice looks the same). Translucent strokes keep the full redraw: drawn
   * twice, the overlap would darken. `scratch` stays the untouched pre-stroke copy, as undo reads
   * its "before" from it (slop-paint keeps a separate undo snapshot instead). `frozen` exists only
   * while a stroke has frozen something: one more layer-sized canvas, released at the stroke's end.
   */
  const FREEZE_STEP = 300;
  const FREEZE_OVERLAP = 8;
  let frozenTo = 0;
  let frozen: HTMLCanvasElement | null = null;

  /** Where this frame's draw starts: the whole stroke, or just past the frozen part. */
  const unfrozenFrom = () => (frozenTo === 0 ? 0 : frozenTo - FREEZE_OVERLAP);

  /** Bake the stroke's settled part into `frozen` once it has grown by FREEZE_STEP points.
   *  Settled = at least 2 × the widest nib plus 30 px of travel (`settledIndex`: a resting pen's
   *  jitter doesn't count), and 40 points, behind the pen:
   *  Calligraphy's normals reach half a width back, its smoothing 2 points, Ink's Pool 32 ms. */
  function freezeSettled(
    ctx: CanvasRenderingContext2D,
    pts: InputPoint[],
    draw: (target: CanvasRenderingContext2D, from: number, to: number) => void,
    size: number,
    sizeRange: number,
  ) {
    // Dev-only off switch, to compare a frozen stroke with a full redraw (test:ipad does).
    if (import.meta.env.DEV && (window as unknown as { slopNoFreeze?: boolean }).slopNoFreeze)
      return;
    if (!scratch) return;
    const i = settledIndex(pts, 2 * widthRange(size, sizeRange).max + 30, 40);
    if (i - frozenTo < FREEZE_STEP) return;
    if (!frozen) {
      frozen = document.createElement("canvas");
      frozen.width = scratch.width;
      frozen.height = scratch.height;
      frozen.getContext("2d")!.drawImage(scratch, 0, 0);
    }
    const f = frozen.getContext("2d")!;
    f.save();
    try {
      f.setTransform(ctx.getTransform());
      withClip(f, () => draw(f, unfrozenFrom(), i));
    } finally {
      f.restore();
    }
    frozenTo = i;
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
  function computeDirtyRect(
    points: InputPoint[],
    layer: Layer,
    size: number,
    sizeRange: number,
  ): Rect {
    // Ink's pooling can swell the mark past its widest pressure width, by up to MAX_DWELL_SWELL.
    const pad = (size * sizeRange * (1 + MAX_DWELL_SWELL)) / 2 + 2;
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
  function pushPixelCommand(
    layer: Layer,
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    before: ImageData,
    after: ImageData,
  ) {
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
    if (drawRaf) {
      cancelAnimationFrame(drawRaf);
      drawRaf = 0;
    }
    lastPoints = [];
    strokeLayer = null;
    strokeCtx = null;
    frozenTo = 0;
    frozen = null;
    setStrokeOpen(false);
  }

  /** Restore the pre-stroke layer via GPU `drawImage` of the scratch — `putImageData` of a
   *  2048×2048 snapshot is a 16MB CPU upload per Pencil sample and is why live drawing crawled
   *  on iPad. */
  function restorePreStroke(ctx: CanvasRenderingContext2D, layer: Layer) {
    const from = frozen ?? scratch; // with the stroke's frozen part, once it has one
    if (!from) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.drawImage(from, 0, 0);
    ctx.restore();
  }

  function paintStroke(points: InputPoint[], done: boolean, tool: Tool) {
    if (!strokeLayer || !strokeCtx) return;
    const ctx = strokeCtx;
    const curve = pressureCurves[slotFor(tool)];
    const curved = points.map((p) => ({ ...p, pressure: curve.evaluate(p.pressure) }));
    const sizeRange = curved[0]?.hasPressure ? pressFor(tool) : 1;
    const settings = buildBrushSettings(tool, strokeLayer);
    const brushType = ui.stroke[slotFor(tool)].brushType;

    // Smooth, ink, calligraphy and dry redraw the WHOLE stroke each frame from the pre-stroke
    // copy: a per-segment redraw re-composites each overlap and hardens the antialiased edge (see
    // ink-brush.ts). The stamp tips draw incrementally.
    if (
      brushType === "smooth" ||
      brushType === "ink" ||
      brushType === "calligraphy" ||
      brushType === "dry"
    ) {
      // Ink and Calligraphy draw a range: from the frozen part on (see `frozenTo`).
      const ranged = (target: CanvasRenderingContext2D, from: number, to = Infinity) => {
        if (brushType === "ink") drawInkStroke(target, curved, settings, sizeRange, from, to);
        else drawCalligraphyStroke(target, curved, settings, sizeRange, from, to);
      };
      if ((brushType === "ink" || brushType === "calligraphy") && settings.opacity >= 100 && !done)
        freezeSettled(ctx, curved, ranged, settings.size, sizeRange);
      restorePreStroke(ctx, strokeLayer);
      withClip(ctx, () => {
        if (brushType === "ink" || brushType === "calligraphy") ranged(ctx, unfrozenFrom());
        else if (brushType === "dry") drawDryStroke(ctx, curved, settings, sizeRange);
        else drawStroke(ctx, curved, settings, done, sizeRange);
      });
    } else {
      withClip(ctx, () =>
        drawStampStrokeIncremental(ctx, curved, { ...settings, brushType }, sizeRange),
      );
    }
    opts?.onPainted?.();
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
          fillThroughClip(
            fctx,
            (target) => {
              floodFill(target, p.x, p.y, hexToRgba(ui.fillValue, ui.fillOpacity), {
                tolerance: ui.fillTolerance,
                // Expand grows the fill BEHIND existing content, which alpha lock refuses outright;
                // without it the fill recolours the region and source-atop keeps it on the pixels.
                expand: layer.alphaLock ? 0 : ui.fillExpand,
              });
            },
            layer.alphaLock,
          );
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
      resetStampState();
      if (strokeLayer) {
        captureScratch(strokeLayer);
        setStrokeOpen(true);
      }
    }
    if (!strokeLayer || !strokeCtx) {
      if (done) endStroke();
      return;
    }

    lastPoints = points;
    if (done) {
      if (drawRaf) {
        cancelAnimationFrame(drawRaf);
        drawRaf = 0;
      }
      paintStroke(points, true, tool);
      markLayerDirty(strokeLayer.id);
      if (scratchCtx) {
        const rect = computeDirtyRect(
          points,
          strokeLayer,
          ui.stroke[slotFor(tool)].size,
          points[0]?.hasPressure ? pressFor(tool) : 1,
        );
        const before = scratchCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
        const after = strokeCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
        pushPixelCommand(strokeLayer, strokeCtx, rect, before, after);
      }
      endStroke();
    } else if (!drawRaf) {
      drawRaf = requestAnimationFrame(() => {
        drawRaf = 0;
        paintStroke(lastPoints, false, tool);
      });
    }
  }

  return { handleStroke };
}
