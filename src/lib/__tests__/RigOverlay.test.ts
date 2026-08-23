import { describe, it, expect } from "vitest";
import { drawRigOverlay } from "../RigOverlay";
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
  it("scales the kite fill, kite stroke, and origin dot by the ambient alpha when faint", () => {
    const faintOps = recordBoneOps(true);
    // Ambient alpha under `faint` is 0.35 (set by drawRigOverlay itself); drawBone must multiply
    // its own literals by that, not overwrite it.
    expect(faintOps).toEqual([
      ["fill", 0.35 * 0.25],
      ["stroke", 0.35],
      ["fill", 0.35],
    ]);
  });

  it("leaves full-strength drawing untouched when not faint", () => {
    const normalOps = recordBoneOps(false);
    expect(normalOps).toEqual([
      ["fill", 0.25],
      ["stroke", 1],
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
