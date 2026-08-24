import { describe, it, expect } from "vitest";
import { drawRigOverlay, poseDeform, makeBonePoses, posedOverlayBone } from "../RigOverlay";
import type { Bone } from "../../rig/document";

// Regression for C2: drawBone used to assign globalAlpha as an absolute value (0.25, then 1),
// discarding whatever ambient alpha drawRigOverlay's caller set for `faint`. RigOverlay.ts imports
// only types, so it runs against a plain recording stub — no canvas package, no DOM.
class RecordingCtx {
  globalAlpha = 1;
  strokeStyle = "";
  fillStyle = "";
  lineWidth = 0;
  ops: Array<["fill" | "stroke", number]> = [];
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  arc() {}
  fill() {
    this.ops.push(["fill", this.globalAlpha]);
  }
  stroke() {
    this.ops.push(["stroke", this.globalAlpha]);
  }
}

function bone(name: string): Bone {
  return {
    name,
    parent: "root",
    x: 0,
    y: 0,
    rotation: 0,
    length: 100,
    wobble: 0,
    reach: undefined,
  };
}

function recordBoneOps(faint: boolean): Array<["fill" | "stroke", number]> {
  const ctx = new RecordingCtx();
  drawRigOverlay(
    ctx as unknown as CanvasRenderingContext2D,
    { bones: [bone("limb")], selectedBone: null, slots: [] },
    1,
    { bones: true, faint, mesh: false, tint: false, capsule: false },
  );
  return ctx.ops;
}

describe("drawRigOverlay bone alpha", () => {
  it("scales the kite fill, kite stroke, origin dot, and tip knob by the ambient alpha when faint", () => {
    const faintOps = recordBoneOps(true);
    // Ambient alpha under `faint` is 0.35 (set by drawRigOverlay itself); drawBone must multiply
    // its own literals by that, not overwrite it.
    expect(faintOps).toEqual([
      ["fill", 0.35 * 0.25],
      ["stroke", 0.35],
      ["fill", 0.35],
      ["fill", 0.35],
    ]);
  });

  it("leaves full-strength drawing untouched when not faint", () => {
    const normalOps = recordBoneOps(false);
    expect(normalOps).toEqual([
      ["fill", 0.25],
      ["stroke", 1],
      ["fill", 1],
      ["fill", 1],
    ]);
  });

  it("the faint and non-faint sequences differ by exactly the 0.35 ratio at every op", () => {
    const faintOps = recordBoneOps(true);
    const normalOps = recordBoneOps(false);
    for (let i = 0; i < normalOps.length; i++) {
      expect(faintOps[i][1] / normalOps[i][1]).toBeCloseTo(0.35, 10);
    }
  });
});

describe("poseDeform extraTheta", () => {
  const mesh = {
    vertices: [{ x: 10, y: 0 }],
    triangles: [] as [number, number, number][],
    hull: 0,
  };
  const weights = [[{ bone: "b", weight: 1 }]];
  const rest = { pivot: { x: 0, y: 0 }, dtheta: 0, dx: 0, dy: 0 };

  it("swings around the bone origin, not as a lagged copy of the parent pivot", () => {
    const out = poseDeform(mesh, weights, [
      { bone: "b", delta: rest, origin: { x: 0, y: 0 }, extraTheta: Math.PI / 2 },
    ]);
    expect(out[0].x).toBeCloseTo(0, 5);
    expect(out[0].y).toBeCloseTo(10, 5);
  });

  it("keeps a child origin on the parent's swung tip", () => {
    const childOrigin = { x: 100, y: 0 };
    const poses = makeBonePoses(
      ["upper", "lower"],
      (name) =>
        name === "upper" ? { parent: "root", x: 0, y: 0 } : { parent: "upper", x: 100, y: 0 },
      () => rest,
      (name) => (name === "upper" ? Math.PI / 2 : 0),
    );
    const mesh = {
      vertices: [childOrigin, { x: 200, y: 0 }],
      triangles: [] as [number, number, number][],
      hull: 0,
    };
    const weights = [[{ bone: "lower", weight: 1 }], [{ bone: "lower", weight: 1 }]];
    const out = poseDeform(mesh, weights, poses);
    expect(out[0].x).toBeCloseTo(0, 5);
    expect(out[0].y).toBeCloseTo(100, 5);
    expect(out[1].x).toBeCloseTo(0, 5);
    expect(out[1].y).toBeCloseTo(200, 5);

    const lower: Bone = {
      name: "lower",
      parent: "upper",
      x: 100,
      y: 0,
      rotation: 0,
      length: 100,
      wobble: 1,
    };
    const overlay = posedOverlayBone(lower, poses[1]);
    expect(overlay.x).toBeCloseTo(0, 5);
    expect(overlay.y).toBeCloseTo(100, 5);
    expect(overlay.rotation).toBeCloseTo(90, 5);
  });
});
