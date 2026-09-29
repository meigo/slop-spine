import { describe, it, expect } from "vitest";
import { floodFill } from "../fill";

/** A w×h layer as the bucket sees it: just getImageData / putImageData over one RGBA buffer. */
function fakeLayer(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  const ctx = {
    canvas: { width: w, height: h },
    getImageData: () => ({ data: new Uint8ClampedArray(data), width: w, height: h }),
    putImageData: (img: { data: Uint8ClampedArray }) => data.set(img.data),
  } as unknown as CanvasRenderingContext2D;
  const px = (x: number, y: number) =>
    Array.from(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
  const paint = (x: number, y: number, rgba: number[]) => data.set(rgba, (y * w + x) * 4);
  return { ctx, px, paint };
}

describe("floodFill", () => {
  it("recolours a painted area, stopping at a line of another colour", () => {
    // 5×1: red red black red red. Tap the left red run.
    const { ctx, px, paint } = fakeLayer(5, 1);
    const red = [255, 0, 0, 255];
    [0, 1, 3, 4].forEach((x) => paint(x, 0, red));
    paint(2, 0, [0, 0, 0, 255]);

    floodFill(ctx, 0, 0, { r: 0, g: 0, b: 255, a: 255 }, { tolerance: 32 });

    expect(px(0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(1, 0)).toEqual([0, 0, 255, 255]);
    expect(px(2, 0)).toEqual([0, 0, 0, 255]);
    expect(px(3, 0)).toEqual(red);
  });

  it("fills an empty area up to painted pixels", () => {
    const { ctx, px, paint } = fakeLayer(5, 1);
    paint(2, 0, [0, 0, 0, 255]);

    floodFill(ctx, 0, 0, { r: 0, g: 0, b: 255, a: 255 }, { tolerance: 32 });

    expect(px(1, 0)).toEqual([0, 0, 255, 255]);
    expect(px(2, 0)).toEqual([0, 0, 0, 255]);
    expect(px(3, 0)).toEqual([0, 0, 0, 0]);
  });
});
