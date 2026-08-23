import type { Bone } from "./document";
import type { RigMesh } from "./mesh";

export interface Influence {
  bone: string;
  weight: number;
}

/** Shortest distance from p to the segment from the bone's origin along its length. Exported so
 *  the influence-radius handle (Canvas.svelte) can reuse this exact projection instead of a
 *  second copy that would drift from this one. */
export function distanceToBone(px: number, py: number, b: Bone): number {
  const rad = (b.rotation * Math.PI) / 180;
  const ex = b.x + Math.cos(rad) * b.length;
  const ey = b.y + Math.sin(rad) * b.length;
  const dx = ex - b.x;
  const dy = ey - b.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - b.x) * dx + (py - b.y) * dy) / len2));
  return Math.hypot(px - (b.x + t * dx), py - (b.y + t * dy));
}

/** Per-vertex bone influences. Inverse-square falloff on Euclidean distance to the bone segment,
 *  capped and normalised. Pure. */
export function computeWeights(mesh: RigMesh, bones: Bone[], maxInfluences = 4): Influence[][] {
  if (bones.length === 0) return mesh.vertices.map(() => []);
  return mesh.vertices.map((v) => {
    const raw = bones.map((b) => {
      const d = distanceToBone(v.x, v.y, b);
      let w = 1 / Math.max(d, 1) ** 2;
      // Same compact falloff window as geodesic.ts's poseWeights, applied to Euclidean
      // distance instead of geodesic distance: 1 at d=0, smoothly down to 0 at d=R.
      const R = b.reach;
      if (R != null && R > 0) {
        if (d >= R) w = 0;
        else {
          const t = d / R;
          const win = 1 - t * t;
          w *= win * win;
        }
      }
      return { bone: b.name, weight: w, distance: d };
    });
    // Bones beyond their reach contribute nothing and must not occupy an influence slot.
    const inRange = raw.filter((i) => i.weight > 0);
    if (inRange.length === 0) {
      // Every bone was out of reach: fall back to the single nearest bone at weight 1. Without
      // this, the vertex would export boneCount: 0, which spine-ts collapses to the skeleton
      // origin (the v1.1 bug) instead of erroring.
      const nearest = raw.reduce((a, b) => (b.distance < a.distance ? b : a));
      return [{ bone: nearest.bone, weight: 1 }];
    }
    inRange.sort((a, b) => b.weight - a.weight);
    const kept = inRange.slice(0, maxInfluences);
    const total = kept.reduce((s, i) => s + i.weight, 0);
    return kept.map((i) => ({ bone: i.bone, weight: i.weight / total }));
  });
}
