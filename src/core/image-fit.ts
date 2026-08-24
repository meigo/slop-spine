/** Pure placement math (no DOM) for dropping an image onto a document-sized layer canvas.
 *  Native size when the image fits, scaled down proportionally on the tighter axis when it does
 *  not, always centered. Never scales up: a small pasted sprite keeps its exact pixels rather than
 *  being resampled to fill the page. Degenerate inputs (any dimension ≤ 0) return an empty
 *  placement, which drawImage treats as a no-op. */
export function computeImagePlacement(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; w: number; h: number } {
  if (imgW <= 0 || imgH <= 0 || canvasW <= 0 || canvasH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(1, canvasW / imgW, canvasH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}
