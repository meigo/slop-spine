import { describe, it, expect } from "vitest";
import { computeFitTransform, computeActualSizeTransform } from "../viewport-fit";

describe("computeActualSizeTransform", () => {
  it("is 1:1 and centered", () => {
    expect(computeActualSizeTransform(800, 600, 200, 100)).toEqual({
      zoom: 1,
      panX: 300,
      panY: 250,
    });
  });

  it("centers even when the canvas is larger than the parent (negative pan)", () => {
    const t = computeActualSizeTransform(400, 300, 800, 600);
    expect(t.zoom).toBe(1);
    expect(t.panX).toBe(-200);
    expect(t.panY).toBe(-150);
  });

  it("returns identity for degenerate sizes", () => {
    expect(computeActualSizeTransform(0, 100, 50, 50)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});

describe("computeFitTransform", () => {
  it("fits the smaller axis with the default margin and centers", () => {
    const t = computeFitTransform(1000, 500, 100, 100);
    expect(t.zoom).toBeCloseTo(4.5);
    expect(t.panX).toBeCloseTo((1000 - 450) / 2);
    expect(t.panY).toBeCloseTo((500 - 450) / 2);
  });
});
