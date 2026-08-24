import { describe, it, expect } from "vitest";
import { meshFromMask, type Mask } from "../mesh";

/** A 100x100 mask with a solid 60x60 square at (20,20). */
const square: Mask = {
  width: 100,
  height: 100,
  at: (x, y) => x >= 20 && x < 80 && y >= 20 && y < 80,
};

describe("meshFromMask", () => {
  it("puts every vertex inside the shape", () => {
    const m = meshFromMask(square, 12);
    expect(m.vertices.length).toBeGreaterThan(3);
    for (const v of m.vertices) expect(square.at(Math.round(v.x), Math.round(v.y))).toBe(true);
  });

  it("puts hull vertices first", () => {
    const m = meshFromMask(square, 12);
    expect(m.hull).toBeGreaterThan(3);
    expect(m.hull).toBeLessThanOrEqual(m.vertices.length);
    // Hull vertices sit on the boundary: at least one 4-neighbour is outside.
    for (let i = 0; i < m.hull; i++) {
      const { x, y } = m.vertices[i];
      const edge =
        !square.at(x + 1, y) ||
        !square.at(x - 1, y) ||
        !square.at(x, y + 1) ||
        !square.at(x, y - 1);
      expect(edge).toBe(true);
    }
  });

  it("returns an empty mesh for an empty mask", () => {
    const m = meshFromMask({ width: 10, height: 10, at: () => false }, 4);
    expect(m.vertices).toEqual([]);
    expect(m.triangles).toEqual([]);
    expect(m.hull).toBe(0);
  });
});
