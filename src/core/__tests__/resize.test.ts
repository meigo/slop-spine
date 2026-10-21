import { describe, it, expect } from "vitest";
import { docSide, halvingSteps, linkedSize, MAX_DOC_PX, MIN_DOC_SIDE } from "../resize";

describe("linkedSize", () => {
  it("keeps the document's ratio", () => {
    expect(linkedSize(960, 1920, 1080)).toBe(540); // width → height
    expect(linkedSize(1080, 1080, 1920)).toBe(1920); // height → width
    expect(linkedSize(1000, 1920, 1080)).toBe(563); // rounded
  });

  it("clamps to 1…8192", () => {
    expect(linkedSize(1, 1920, 1080)).toBe(1);
    expect(linkedSize(8192, 1080, 1920)).toBe(MAX_DOC_PX);
  });

  it("falls back to the other side for a bad input", () => {
    expect(linkedSize(Number.NaN, 1920, 1080)).toBe(1080);
    expect(linkedSize(500, 0, 1080)).toBe(1080);
  });
});

describe("docSide", () => {
  it("rounds a typed side", () => {
    expect(docSide(1920)).toBe(1920);
    expect(docSide(511.6)).toBe(512);
    expect(docSide(MIN_DOC_SIDE)).toBe(MIN_DOC_SIDE);
    expect(docSide(MAX_DOC_PX)).toBe(MAX_DOC_PX);
  });

  it("refuses an empty, zero, negative or too large side instead of clamping it", () => {
    expect(docSide(null)).toBeNull(); // '' through Svelte's number binding
    expect(docSide(undefined)).toBeNull();
    expect(docSide(Number.NaN)).toBeNull();
    expect(docSide(0)).toBeNull();
    expect(docSide(0.4)).toBeNull(); // rounds to 0
    expect(docSide(-3)).toBeNull();
    expect(docSide(MIN_DOC_SIDE - 1)).toBeNull();
    expect(docSide(MAX_DOC_PX + 1)).toBeNull();
  });
});

describe("halvingSteps", () => {
  it("halves down to a large shrink, then lands on the target", () => {
    expect(halvingSteps(4000, 2000, 500, 250)).toEqual([
      { w: 2000, h: 1000 },
      { w: 1000, h: 500 },
      { w: 500, h: 250 },
    ]);
    expect(halvingSteps(1920, 1080, 300, 200)).toEqual([
      { w: 960, h: 540 },
      { w: 480, h: 270 },
      { w: 300, h: 200 },
    ]);
  });

  it("is one step for growing or a shrink under 2×", () => {
    expect(halvingSteps(800, 600, 1600, 1200)).toEqual([{ w: 1600, h: 1200 }]);
    expect(halvingSteps(800, 600, 500, 400)).toEqual([{ w: 500, h: 400 }]);
  });

  it("halves a side that shrinks 2× or more even when the other doesn't", () => {
    expect(halvingSteps(3000, 2000, 1000, 2000)).toEqual([
      { w: 1500, h: 2000 },
      { w: 1000, h: 2000 },
    ]);
    expect(halvingSteps(8000, 2000, 1000, 2400)).toEqual([
      { w: 4000, h: 2000 },
      { w: 2000, h: 2000 },
      { w: 1000, h: 2000 },
      { w: 1000, h: 2400 },
    ]);
  });

  it("never shrinks a side below its target, when only one side shrinks a lot", () => {
    const steps = halvingSteps(4000, 1000, 500, 900);
    for (const s of steps) {
      expect(s.w).toBeGreaterThanOrEqual(500);
      expect(s.h).toBeGreaterThanOrEqual(900);
    }
    expect(steps.at(-1)).toEqual({ w: 500, h: 900 });
  });
});
