import type { SelectionRect } from "../core/selection";

/** Pixels copied or cut out of a marquee, plus the rect they came from. Deliberately NOT the
 *  system clipboard: keeping them in-process is what lets a paste land as a movable float on the
 *  active layer instead of as a flat new layer, and it survives without clipboard permissions or a
 *  secure context (the LAN dev server on iPad is plain http). Importing an *external* image is the
 *  other path — see Toolbar's paste-as-layer, which does go through navigator.clipboard. */
let pixels: { canvas: HTMLCanvasElement; rect: SelectionRect } | null = null;

/** Reactive mirror of `pixels !== null`, so the toolbar's Paste button can enable itself. The
 *  canvas is kept out of $state on purpose: it is a large mutable DOM object that nothing renders
 *  from reactively, and proxying it would only add churn. */
export const clipboard = $state({ hasPixels: false });

export function setClipboardPixels(canvas: HTMLCanvasElement, rect: SelectionRect) {
  pixels = { canvas, rect: { ...rect } };
  clipboard.hasPixels = true;
}

export function getClipboardPixels(): { canvas: HTMLCanvasElement; rect: SelectionRect } | null {
  return pixels;
}
