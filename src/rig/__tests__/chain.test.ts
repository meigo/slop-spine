import { describe, it, expect } from "vitest";
import { splitBoneAt, reparentDropTarget, boneTip, MIN_SPLIT } from "../chain";
import type { Bone } from "../document";

function b(partial: Partial<Bone> & { name: string }): Bone {
  return {
    parent: "root",
    x: 0,
    y: 0,
    rotation: 0,
    length: 100,
    wobble: 0,
    ...partial,
  };
}

describe("splitBoneAt", () => {
  const bone = { x: 0, y: 0, rotation: 0, length: 100 };

  it("splits at the projection onto the shaft", () => {
    const s = splitBoneAt(bone, { x: 40, y: 10 });
    expect(s).not.toBeNull();
    expect(s!.parentLength).toBeCloseTo(40, 5);
    expect(s!.child.x).toBeCloseTo(40, 5);
    expect(s!.child.y).toBeCloseTo(0, 5);
    expect(s!.child.length).toBeCloseTo(60, 5);
    expect(s!.child.rotation).toBe(0);
  });

  it("refuses a hit too close to either end", () => {
    expect(splitBoneAt(bone, { x: 2, y: 0 })).toBeNull();
    expect(splitBoneAt(bone, { x: 98, y: 0 })).toBeNull();
  });

  it("refuses a bone shorter than two stubs", () => {
    expect(splitBoneAt({ ...bone, length: MIN_SPLIT * 2 - 1 }, { x: 8, y: 0 })).toBeNull();
  });
});

describe("reparentDropTarget", () => {
  const bones: Bone[] = [
    b({ name: "root", parent: null, x: 0, y: 0, length: 0 }),
    b({ name: "upper", x: 0, y: 0, length: 100 }),
    b({ name: "hand", parent: "upper", x: 100, y: 0, length: 50 }),
  ];

  it("picks the bone whose tip or origin is nearest", () => {
    expect(reparentDropTarget({ x: 100, y: 0 }, bones, 10, new Set(["hand"]))).toBe("upper");
    expect(reparentDropTarget({ x: 0, y: 0 }, bones, 10, new Set(["upper"]))).toBe("root");
  });

  it("ignores the dragged bone and its descendants", () => {
    expect(reparentDropTarget({ x: 2, y: 0 }, bones, 10, new Set(["upper", "hand"]))).toBe("root");
    expect(reparentDropTarget({ x: 100, y: 0 }, bones, 10, new Set(["upper", "hand"]))).toBeNull();
  });

  it("returns null when nothing is in range", () => {
    expect(reparentDropTarget({ x: 500, y: 500 }, bones, 10, new Set())).toBeNull();
  });
});

describe("boneTip", () => {
  it("is origin plus length along rotation", () => {
    expect(boneTip({ x: 0, y: 0, rotation: 0, length: 10 })).toEqual({ x: 10, y: 0 });
  });
});
