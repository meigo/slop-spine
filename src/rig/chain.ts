import type { Bone } from "./document";

export interface Pt {
  x: number;
  y: number;
}

export function boneTip(b: { x: number; y: number; rotation: number; length: number }): Pt {
  const rad = (b.rotation * Math.PI) / 180;
  return { x: b.x + Math.cos(rad) * b.length, y: b.y + Math.sin(rad) * b.length };
}

/** Too close to either end to split — would leave a degenerate stub. */
export const MIN_SPLIT = 8;

export interface SplitBone {
  parentLength: number;
  child: { x: number; y: number; rotation: number; length: number };
}

/** Project `pt` onto `bone`'s shaft. Null if the hit is too close to origin or tip. */
export function splitBoneAt(
  bone: { x: number; y: number; rotation: number; length: number },
  pt: Pt,
  minEnd = MIN_SPLIT,
): SplitBone | null {
  if (bone.length < minEnd * 2) return null;
  const tip = boneTip(bone);
  const dx = tip.x - bone.x;
  const dy = tip.y - bone.y;
  const len2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((pt.x - bone.x) * dx + (pt.y - bone.y) * dy) / len2));
  const parentLength = t * bone.length;
  const childLength = bone.length - parentLength;
  if (parentLength < minEnd || childLength < minEnd) return null;
  return {
    parentLength,
    child: {
      x: bone.x + dx * t,
      y: bone.y + dy * t,
      rotation: bone.rotation,
      length: childLength,
    },
  };
}

/** Nearest other bone whose origin or tip is within `radius` of `pt`. `forbidden` is the
 *  dragged bone plus its descendants (parenting to those would cycle). `root` is allowed. */
export function reparentDropTarget(
  pt: Pt,
  bones: Bone[],
  radius: number,
  forbidden: Set<string>,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const b of bones) {
    if (forbidden.has(b.name)) continue;
    for (const c of [{ x: b.x, y: b.y }, boneTip(b)]) {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d < radius && d < bestD) {
        bestD = d;
        best = b.name;
      }
    }
  }
  return best;
}
