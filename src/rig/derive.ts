import type { Bone, RigDocument } from "./document";
import { defaultBind } from "./document";
import { maskFromCanvas, meshFromMask, type RigMesh } from "./mesh";
import { computeWeights, type Influence } from "./weights";

interface CacheEntry {
  /** Full key: meshKey + boneSig. A mismatch here means the weights (at least) are stale. */
  key: string;
  /** Just the mesh-affecting part of the key (layer.revision + density). Unchanged means the
   *  mesh can be reused even though the full key (and therefore the weights) changed. */
  meshKey: string;
  mesh: RigMesh;
  weights: Influence[][];
}

const cache = new Map<string, CacheEntry>();

function boneSignature(bones: Bone[]): string {
  return bones.map((b) => `${b.name}:${b.x}:${b.y}:${b.rotation}:${b.length}`).join(",");
}

/** Drop cached derivation for one slot, or every slot. Not required for correctness — the cache
 *  key already changes on any input change — but keeps the map from growing after a slot is
 *  removed (see doc.svelte.ts's removeLayer). */
export function invalidate(slotName?: string) {
  if (slotName) cache.delete(slotName);
  else cache.clear();
}

const EMPTY: { mesh: RigMesh; weights: Influence[][] } = {
  mesh: { vertices: [], triangles: [], hull: 0 },
  weights: [],
};

/** Mesh + weights for one slot, memoised on (layer.revision, doc.density, bound-bone signature).
 *  The mesh depends only on the layer's pixels and density, not on bones — moving a bone reuses
 *  the same mesh object and only recomputes weights, which is what keeps bone-dragging responsive. */
export function deriveSlot(doc: RigDocument, slotName: string): { mesh: RigMesh; weights: Influence[][] } {
  const slot = doc.slots.find((s) => s.name === slotName);
  if (!slot) return EMPTY;
  const layer = doc.layers.find((l) => l.id === slot.layerId);
  if (!layer) return EMPTY;

  const bindNames = doc.binds.find((b) => b.slot === slotName)?.bones ?? defaultBind(doc, slot);
  const bones = doc.bones.filter((b) => bindNames.includes(b.name));

  const meshKey = `${layer.revision}|${doc.density}`;
  const key = `${meshKey}|${boneSignature(bones)}`;

  const cached = cache.get(slotName);
  if (cached && cached.key === key) return { mesh: cached.mesh, weights: cached.weights };

  const mesh =
    cached && cached.meshKey === meshKey ? cached.mesh : meshFromMask(maskFromCanvas(layer.canvas), doc.density);
  const weights = computeWeights(mesh, bones);

  cache.set(slotName, { key, meshKey, mesh, weights });
  return { mesh, weights };
}
