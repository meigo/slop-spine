export interface Trim {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Opaque bounding box of a layer canvas, in canvas coordinates. Empty layers give a 1x1 box
 *  at the origin so packing and UV maths never divide by zero. */
export function trimLayer(canvas: HTMLCanvasElement, alphaThreshold = 8): Trim {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
