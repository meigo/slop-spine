import { describe, it, expect } from "vitest";
import { anchorOffset, resizeRig } from "../resize-rig";
import { boneWorld } from "../../export/spine-json";
import type { Bone, Slot } from "../document";

const bone = (name: string, x: number, y: number, extra: Partial<Bone> = {}): Bone => ({
  name,
  parent: name === "root" ? null : "root",
  x,
  y,
  rotation: 30,
  length: 100,
  wobble: 0,
  ...extra,
});
const slot = (name: string, density?: number): Slot => ({
  name,
  layerId: 1,
  bone: "root",
  order: 0,
  density,
});
const rig = () => ({
  bones: [bone("root", 500, 500, { length: 0 }), bone("arm", 600, 400, { reach: 80 })],
  slots: [slot("a"), slot("b", 40)],
  density: 24,
});

describe("anchorOffset", () => {
  it("is where the old canvas lands in the new one, in whole px", () => {
    expect(anchorOffset(1000, 1200, 0)).toBe(0); // left: nothing moves
    expect(anchorOffset(1000, 1200, 0.5)).toBe(100); // centre: half the added space
    expect(anchorOffset(1000, 1200, 1)).toBe(200); // right: all of it
    expect(anchorOffset(1000, 800, 0.5)).toBe(-100); // a crop moves it back
    expect(anchorOffset(1000, 1001, 0.5)).toBe(1); // rounded
  });
});

describe("resizeRig", () => {
  it("Crop / extend shifts the bones by the anchor offset and changes nothing else", () => {
    const r = resizeRig(rig(), {
      mode: "canvas",
      from: [1000, 1000],
      to: [1400, 800],
      anchor: [1, 0.5],
    });
    expect(r.bones.map((b) => [b.x, b.y])).toEqual([
      [900, 400],
      [1000, 300],
    ]);
    expect(r.bones[1]).toMatchObject({ rotation: 30, length: 100, reach: 80 });
    expect(r.slots.map((s) => s.density)).toEqual([undefined, 40]);
    expect(r.density).toBe(24);
  });

  it("Scale scales positions, lengths, reach and densities, and keeps rotations", () => {
    const r = resizeRig(rig(), {
      mode: "scale",
      from: [1000, 1000],
      to: [500, 500],
      anchor: [0.5, 0.5],
    });
    expect(r.bones.map((b) => [b.x, b.y])).toEqual([
      [250, 250],
      [300, 200],
    ]);
    expect(r.bones[1]).toMatchObject({ rotation: 30, length: 50, reach: 40 });
    expect(r.bones[0].reach).toBeUndefined(); // unlimited stays unlimited
    expect(r.slots.map((s) => s.density)).toEqual([undefined, 20]); // an inherited one still inherits
    expect(r.density).toBe(12);
  });

  it("keeps a scaled density inside the Inspector's 8–96 range", () => {
    const down = resizeRig(rig(), {
      mode: "scale",
      from: [2048, 2048],
      to: [512, 512],
      anchor: [0, 0],
    });
    expect(down.density).toBe(8);
    const up = resizeRig(rig(), {
      mode: "scale",
      from: [512, 512],
      to: [4096, 4096],
      anchor: [0, 0],
    });
    expect(up.density).toBe(96);
  });

  it("does not touch the rig it was given", () => {
    const before = rig();
    resizeRig(before, { mode: "scale", from: [1000, 1000], to: [500, 500], anchor: [0, 0] });
    expect(before).toEqual(rig());
  });

  it("a centred extend leaves every bone where it was in the Spine export", () => {
    // The export's origin is the canvas centre, and a centred extend adds space evenly round it.
    const r = resizeRig(rig(), {
      mode: "canvas",
      from: [1000, 1000],
      to: [1600, 1200],
      anchor: [0.5, 0.5],
    });
    for (let i = 0; i < r.bones.length; i++) {
      expect(boneWorld({ width: 1600, height: 1200 }, r.bones[i])).toEqual(
        boneWorld({ width: 1000, height: 1000 }, rig().bones[i]),
      );
    }
  });
});
