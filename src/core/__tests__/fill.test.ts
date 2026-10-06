import { describe, it, expect } from "vitest";
import { fillMask, floodFill, hexToRgba, rgbToHex, sameImageData } from "../fill";

describe("hexToRgba", () => {
  it("parses black at full opacity", () => {
    const c = hexToRgba("#000000", 100);
    expect(c).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it("parses white at full opacity", () => {
    const c = hexToRgba("#ffffff", 100);
    expect(c).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("parses red", () => {
    const c = hexToRgba("#ff0000", 100);
    expect(c).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("handles half opacity", () => {
    const c = hexToRgba("#000000", 50);
    expect(c.a).toBe(128);
  });

  it("handles zero opacity", () => {
    const c = hexToRgba("#ffffff", 0);
    expect(c.a).toBe(0);
  });

  it("parses hex colors correctly", () => {
    const c = hexToRgba("#1a2b3c", 100);
    expect(c.r).toBe(0x1a);
    expect(c.g).toBe(0x2b);
    expect(c.b).toBe(0x3c);
  });
});

describe("rgbToHex", () => {
  it("pads each channel to two digits", () => {
    expect(rgbToHex(0, 10, 255)).toBe("#000aff");
  });

  it("round-trips with hexToRgba", () => {
    const { r, g, b } = hexToRgba("#1a2b3c", 100);
    expect(rgbToHex(r, g, b)).toBe("#1a2b3c");
  });
});

describe("sameImageData", () => {
  const img = (...v: number[]) => ({ data: new Uint8ClampedArray(v) }) as ImageData;

  it("is true for identical pixels", () => {
    expect(sameImageData(img(1, 2, 3, 4), img(1, 2, 3, 4))).toBe(true);
  });

  it("is false when any byte differs", () => {
    expect(sameImageData(img(1, 2, 3, 4), img(1, 2, 3, 5))).toBe(false);
  });

  it("is false for different sizes", () => {
    expect(sameImageData(img(1, 2, 3, 4), img(1, 2, 3, 4, 5, 6, 7, 8))).toBe(false);
  });
});

describe("fillMask", () => {
  /** A w×h transparent image with opaque black pixels wherever `ink(x, y)` is true. */
  function image(w: number, h: number, ink: (x: number, y: number) => boolean) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (ink(x, y)) data[(y * w + x) * 4 + 3] = 255;
    return data;
  }
  const count = (m: Uint8Array | null) => (m ? m.reduce((a, b) => a + b, 0) : -1);
  // A 20×20 box outline (x, y 5..24) on a 30×30 canvas, with a `gap`-px break in its top edge.
  const box = (gap: number) =>
    image(30, 30, (x, y) => {
      const edge = x === 5 || x === 24 || y === 5 || y === 24;
      const inBox = x >= 5 && x <= 24 && y >= 5 && y <= 24;
      const inBreak = y === 5 && x >= 15 && x < 15 + gap;
      return inBox && edge && !inBreak;
    });
  const INSIDE = 18 * 18;

  it("fills only the inside of a closed outline", () => {
    expect(count(fillMask(box(0), 30, 30, 15, 15, 32))).toBe(INSIDE);
  });

  it("leaks through a break without a bridge", () => {
    expect(count(fillMask(box(3), 30, 30, 15, 15, 32))).toBeGreaterThan(INSIDE + 100);
  });

  it("bridges a break of about twice the gap, reaching the lines", () => {
    const m = fillMask(box(3), 30, 30, 15, 15, 32, 2)!;
    // Inside, right up to the lines: the corners by the walls are filled too.
    expect(m[6 * 30 + 6]).toBe(1);
    expect(m[23 * 30 + 23]).toBe(1);
    // Outside, away from the break, stays empty; at most a small bulge pokes out of it.
    expect(m[1 * 30 + 1]).toBe(0);
    expect(m[27 * 30 + 15]).toBe(0);
    expect(count(m)).toBeLessThan(INSIDE + 3 + 12);
  });

  it("never paints the lines themselves", () => {
    const data = box(3);
    const m = fillMask(data, 30, 30, 15, 15, 32, 2)!;
    for (let i = 0; i < 30 * 30; i++) if (data[i * 4 + 3]) expect(m[i]).toBe(0);
  });

  it("fills a pocket too narrow to survive the bridge without bridging", () => {
    // A 3px-wide closed channel: thickening its walls by 2 swallows it.
    const data = image(20, 20, (x, y) => x === 4 || x === 8 || y === 2 || y === 17);
    expect(count(fillMask(data, 20, 20, 6, 10, 32, 2))).toBe(3 * 14);
  });

  it("doesn't slip through a 1px diagonal line while growing back", () => {
    // A closed box whose right part is cut off by a 1px diagonal: the fill stays on its side.
    const data = image(
      30,
      30,
      (x, y) => x === 0 || y === 0 || x === 29 || y === 29 || x + y === 30,
    );
    const m = fillMask(data, 30, 30, 5, 5, 32, 3)!;
    for (let y = 1; y < 29; y++)
      for (let x = 1; x < 29; x++) if (x + y > 30) expect(m[y * 30 + x]).toBe(0);
    expect(m[3 * 30 + 3]).toBe(1);
  });

  it("returns null for a tap off the canvas", () => {
    expect(fillMask(box(0), 30, 30, -1, 5, 32)).toBeNull();
  });
});

// slop-spine's own floodFill tests, kept from before the port.
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

  it("with Soft, recolouring a painted square on a transparent layer paints nothing around it", () => {
    // slop-paint b63a5b3: from a painted seed the transparent space round the art read as
    // full-strength line, and Soft filled a ring up to 32 px wide outside the square.
    const { ctx, px, paint } = fakeLayer(60, 60);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) paint(x, y, [255, 0, 0, 255]);
    floodFill(ctx, 30, 30, { r: 0, g: 0, b: 255, a: 255 }, { tolerance: 32, softEdge: 1 });
    let outside = 0;
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) {
        const inSquare = x >= 20 && x < 40 && y >= 20 && y < 40;
        if (!inSquare && px(x, y)[3] > 0) outside++;
      }
    expect(px(30, 30)).toEqual([0, 0, 255, 255]);
    expect(outside).toBe(0);
  });
});
