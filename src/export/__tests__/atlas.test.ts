import { describe, it, expect } from "vitest";
import { packAtlas } from "../atlas";

const item = (name: string, w: number, h: number) => ({ name, trim: { x: 10, y: 20, width: w, height: h } });

describe("packAtlas", () => {
  it("places regions without overlapping", () => {
    const { regions } = packAtlas([item("a", 100, 50), item("b", 80, 70), item("c", 40, 40)], 2048, 2048);
    for (let i = 0; i < regions.length; i++)
      for (let j = i + 1; j < regions.length; j++) {
        const A = regions[i], B = regions[j];
        const disjoint =
          A.pageX + A.trim.width <= B.pageX || B.pageX + B.trim.width <= A.pageX ||
          A.pageY + A.trim.height <= B.pageY || B.pageY + B.trim.height <= A.pageY;
        expect(disjoint).toBe(true);
      }
  });

  it("writes offsets that reconstruct the original canvas placement", () => {
    const { text } = packAtlas([item("a", 100, 50)], 2048, 2048);
    // Spine offsets are: offsetX, offsetY (from bottom-left), originalWidth, originalHeight
    expect(text).toContain("offsets:10,1978,2048,2048");
    expect(text).toContain("rotate:false");
  });

  it("keeps every region inside the page", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`r${i}`, 200, 200));
    const { regions, pageWidth, pageHeight } = packAtlas(items, 2048, 2048);
    for (const r of regions) {
      expect(r.pageX + r.trim.width).toBeLessThanOrEqual(pageWidth);
      expect(r.pageY + r.trim.height).toBeLessThanOrEqual(pageHeight);
    }
  });

  it("grows page width to fit wide regions", () => {
    const { regions, pageWidth } = packAtlas([item("wide", 2048, 100)], 2048, 2048);
    const r = regions[0];
    expect(r.pageX + r.trim.width).toBeLessThanOrEqual(pageWidth);
  });
});
