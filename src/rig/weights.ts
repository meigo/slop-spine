import type { Bone } from "./document";
import type { RigMesh } from "./mesh";

export interface Influence {
  bone: string;
  weight: number;
}

/** Shortest distance from p to the segment from the bone's origin along its length. */
function distanceToBone(px: number, py: number, b: Bone): number {
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
      return { bone: b.name, weight: 1 / Math.max(d, 1) ** 2 };
    });
    raw.sort((a, b) => b.weight - a.weight);
    const kept = raw.slice(0, maxInfluences);
    const total = kept.reduce((s, i) => s + i.weight, 0);
    return kept.map((i) => ({ bone: i.bone, weight: i.weight / total }));
  });
}
