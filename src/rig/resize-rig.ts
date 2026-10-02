import type { Bone, Slot } from "./document";

/**
 * The rig's part of File ▸ Resize… (2026-10-02). Bones, reach and mesh density are all in canvas
 * pixels, so a resize has to carry them along with the drawing. Pure: returns new bones and slots.
 *
 * - "canvas" (Crop / extend): the drawing doesn't move on the page, the page grows or shrinks
 *   around it at the anchor, so every bone shifts by the anchor offset and nothing else changes.
 * - "scale": the drawing scales with the page, so bone positions scale per axis and lengths, reach
 *   and densities by one factor (the dialog locks Keep ratio in this mode, so the axes agree to
 *   within a pixel's rounding). Rotations are unchanged. A density scales too, so a mesh keeps the
 *   same number of points, kept inside the Inspector's 8–96.
 *
 * The Spine export's origin is the canvas centre (`toSkeletonSpace`), and it follows the new
 * canvas: a resize that isn't centred moves the character in skeleton space, as on the page.
 */

/** Density limits, as the Inspector's slider. */
const DENSITY_MIN = 8;
const DENSITY_MAX = 96;

/** Where the old canvas's top-left lands in the new one along one axis, in whole px: `anchor`
 *  0 keeps the start edge, 0.5 the centre, 1 the end edge. */
export function anchorOffset(oldSize: number, newSize: number, anchor: number): number {
  return Math.round((newSize - oldSize) * anchor);
}

export interface ResizeSpec {
  mode: "canvas" | "scale";
  from: [number, number];
  to: [number, number];
  /** 0 / 0.5 / 1 per axis; "canvas" mode only. */
  anchor: [number, number];
}

export function resizeRig(
  rig: { bones: Bone[]; slots: Slot[]; density: number },
  spec: ResizeSpec,
): { bones: Bone[]; slots: Slot[]; density: number } {
  const [fromW, fromH] = spec.from;
  const [toW, toH] = spec.to;
  if (spec.mode === "canvas") {
    const dx = anchorOffset(fromW, toW, spec.anchor[0]);
    const dy = anchorOffset(fromH, toH, spec.anchor[1]);
    return {
      bones: rig.bones.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })),
      slots: rig.slots.map((s) => ({ ...s })),
      density: rig.density,
    };
  }
  const sx = toW / fromW;
  const sy = toH / fromH;
  const s = (sx + sy) / 2;
  const density = (d: number) => Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, Math.round(d * s)));
  return {
    bones: rig.bones.map((b) => ({
      ...b,
      x: b.x * sx,
      y: b.y * sy,
      length: b.length * s,
      // Unlimited (undefined or 0) stays unlimited.
      ...(b.reach ? { reach: b.reach * s } : {}),
    })),
    slots: rig.slots.map((sl) =>
      sl.density === undefined ? { ...sl } : { ...sl, density: density(sl.density) },
    ),
    density: density(rig.density),
  };
}
