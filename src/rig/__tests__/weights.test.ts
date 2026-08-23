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

  it("gives exactly zero from a bone once a vertex is beyond its reach", () => {
    const near = { ...bone("near", 0, 0, 10), reach: 20 };
    const far = bone("far", 1000, 1000, 10);
    const w = computeWeights(mesh([[100, 0]]), [near, far]);
    expect(w[0].find((i) => i.bone === "near")).toBeUndefined();
  });

  it("windows a bone's weight strictly below its unwindowed value at the same distance", () => {
    // "Nearer is heavier" alone can't distinguish a window from no window: 1/d^2 is already
    // monotonic in distance with or without the (1-t^2)^2 multiplier. So instead compare the
    // SAME bone at the SAME distance across two calls that differ only in whether reach is set.
    // "ref" sits far enough away that its own weight is unaffected by either call and serves as
    // a fixed denominator term, so any reduction in t's raw weight must show up in its normalised
    // weight too (x/(x+c) is strictly increasing in x for fixed c > 0).
    const vertex: [number, number] = [30, 0];
    const ref = bone("ref", 1000, 1000, 0);
    const withWindow = computeWeights(mesh([vertex]), [{ ...bone("t", 0, 0, 0), reach: 100 }, ref]);
    const withoutWindow = computeWeights(mesh([vertex]), [bone("t", 0, 0, 0), ref]);
    const windowed = withWindow[0].find((i) => i.bone === "t")!.weight;
    const unwindowed = withoutWindow[0].find((i) => i.bone === "t")!.weight;
    expect(windowed).toBeLessThan(unwindowed);
  });

  it("falls back to the nearest bone at weight 1 when a vertex is outside every reach", () => {
    const a = { ...bone("a", 0, 0, 10), reach: 5 };
    const b = { ...bone("b", 1000, 1000, 10), reach: 5 };
    const w = computeWeights(mesh([[100, 0]]), [a, b]);
    expect(w[0]).toEqual([{ bone: "a", weight: 1 }]);
  });

  it("undefined reach behaves exactly as today: pins the current influence values", () => {
    // Hand-derived, not run-and-pasted. Vertex (10,0): bone a is the segment (0,0)-(100,0), and
    // (10,0) lies exactly on it, so d_a = 0. Bone b is the segment (0,400)-(100,400); its closest
    // point to (10,0) is (10,400), so d_b = 400. Neither bone sets reach, so no window applies —
    // this exercises exactly the pre-reach formula: 1 / max(d, 1) ** 2, then normalised.
    const dA = 0;
    const dB = 400;
    const wA = 1 / Math.max(dA, 1) ** 2; // = 1
    const wB = 1 / Math.max(dB, 1) ** 2; // = 1/160000
    const total = wA + wB;
    const w = computeWeights(mesh([[10, 0]]), [bone("a", 0, 0, 100), bone("b", 0, 400, 100)]);
    expect(w[0]).toEqual([
      { bone: "a", weight: wA / total },
      { bone: "b", weight: wB / total },
    ]);
  });
});
