import { describe, it, expect } from "vitest";
import { computeImagePlacement } from "../image-fit";

describe("computeImagePlacement", () => {
  it("keeps native size and centers when the image fits", () => {
    expect(computeImagePlacement(200, 100, 800, 600)).toEqual({ x: 300, y: 250, w: 200, h: 100 });
  });

  it("never scales a small image up", () => {
    const p = computeImagePlacement(10, 10, 2048, 2048);
    expect(p.w).toBe(10);
    expect(p.h).toBe(10);
  });

  it("places an exactly-canvas-sized image at the origin", () => {
    expect(computeImagePlacement(800, 600, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it("shrinks to the width when the image is too wide, preserving aspect", () => {
    const p = computeImagePlacement(2000, 500, 1000, 1000);
    expect(p.w).toBeCloseTo(1000);
    expect(p.h).toBeCloseTo(250);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(375);
  });

  it("shrinks to the height when the image is too tall, preserving aspect", () => {
    const p = computeImagePlacement(500, 2000, 1000, 1000);
    expect(p.w).toBeCloseTo(250);
    expect(p.h).toBeCloseTo(1000);
    expect(p.x).toBeCloseTo(375);
    expect(p.y).toBeCloseTo(0);
  });

  it("uses the tighter axis when the image overflows both", () => {
    // 4000x1000 into 1000x900: width needs 0.25, height needs 0.9 — width wins.
    const p = computeImagePlacement(4000, 1000, 1000, 900);
    expect(p.w).toBeCloseTo(1000);
    expect(p.h).toBeCloseTo(250);
  });

  it("returns an empty placement for degenerate sizes", () => {
    expect(computeImagePlacement(0, 100, 800, 600)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(computeImagePlacement(100, 100, 0, 600)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(computeImagePlacement(-5, 100, 800, 600)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
