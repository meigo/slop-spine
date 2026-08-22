import { describe, it, expect } from "vitest";
import { computeWeights } from "../weights";
import type { Bone } from "../document";
import type { RigMesh } from "../mesh";

const bone = (name: string, x: number, y: number, length: number, rotation = 0): Bone =>
  ({ name, parent: null, x, y, rotation, length, wobble: 0 });

const mesh = (pts: [number, number][]): RigMesh => ({
  vertices: pts.map(([x, y]) => ({ x, y })),
  triangles: [],
  hull: 0,
});

describe("computeWeights", () => {
  it("gives every vertex weights summing to 1", () => {
    const w = computeWeights(mesh([[0, 0], [50, 0], [100, 0]]), [bone("a", 0, 0, 100), bone("b", 0, 80, 100)]);
    for (const v of w) expect(v.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 5);
  });

  it("weights a vertex on a bone almost entirely to that bone", () => {
    const w = computeWeights(mesh([[10, 0]]), [bone("a", 0, 0, 100), bone("b", 0, 400, 100)]);
    const a = w[0].find((i) => i.bone === "a")!;
    expect(a.weight).toBeGreaterThan(0.95);
  });

  it("caps influences per vertex", () => {
    const bones = ["a", "b", "c", "d", "e", "f"].map((n, i) => bone(n, 0, i * 10, 100));
    const w = computeWeights(mesh([[50, 25]]), bones, 4);
    expect(w[0].length).toBeLessThanOrEqual(4);
  });

  it("returns a single full-weight influence when there is one bone", () => {
    const w = computeWeights(mesh([[500, 500]]), [bone("a", 0, 0, 10)]);
    expect(w[0]).toEqual([{ bone: "a", weight: 1 }]);
  });

  it("prefers bones whose segments are near over bones whose origins are near", () => {
    // Bone a: origin (0,0), extends right to (100,0).
    // Bone b: origin (50,10), extends up to (50,60).
    // Vertex at (50,0): exactly on a's segment (segment-distance 0), but far from a's origin.
    // b's origin is much closer (distance 10), but b's segment points away (closest point also 10).
    // With correct segment-distance, a dominates. With buggy origin-distance, b would win.
    const w = computeWeights(
      mesh([[50, 0]]),
      [bone("a", 0, 0, 100, 0), bone("b", 50, 10, 50, 90)]
    );
    const a = w[0].find((i) => i.bone === "a")!;
    const b = w[0].find((i) => i.bone === "b")!;
    expect(a.weight).toBeGreaterThan(0.95);
    expect(b.weight).toBeLessThan(0.05);
  });
});
