import type { Bone, RigDocument } from "./document";
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
  // reach is included: it's a weights-only input (see computeWeights), but the cache's single
  // key covers both mesh and weights, so leaving it out would let a reach-only change (Task 3's
  // drag handle) return stale weights from cache instead of re-deriving them.
  return bones.map((b) => `${b.name}:${b.x}:${b.y}:${b.rotation}:${b.length}:${b.reach}`).join(",");
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

/** Every bone except root — the fallback for a slot whose stored bind list is empty (see below). */
function allNonRootBoneNames(doc: RigDocument): string[] {
  return doc.bones.filter((b) => b.name !== "root").map((b) => b.name);
}

/** Mesh + weights for one slot, memoised on (layer.revision, effective density, bound-bone
 *  signature). Effective density is slot.density ?? doc.density — a slot's override, or the
 *  document default when it has none. The mesh depends only on the layer's pixels and density,
 *  not on bones — moving a bone reuses the same mesh object and only recomputes weights, which is
 *  what keeps bone-dragging responsive. */
export function deriveSlot(doc: RigDocument, slotName: string): { mesh: RigMesh; weights: Influence[][] } {
  const slot = doc.slots.find((s) => s.name === slotName);
  if (!slot) return EMPTY;
  const layer = doc.layers.find((l) => l.id === slot.layerId);
  if (!layer) return EMPTY;

  // A stored bind list can be empty — not just absent — when the layer was created before any
  // bone existed (addLayer's defaultBind() call filters root out of an all-root bone list). An
  // empty list is "not yet bound", not "bound to nothing": fall back to every bone rather than
  // leaving the slot with zero influences, which collapses it to the skeleton origin on export.
  const stored = doc.binds.find((b) => b.slot === slotName)?.bones;
  const bindNames = stored?.length ? stored : allNonRootBoneNames(doc);
  const bones = doc.bones.filter((b) => bindNames.includes(b.name));

  const density = slot.density ?? doc.density;
  const meshKey = `${layer.revision}|${density}`;
  const key = `${meshKey}|${boneSignature(bones)}`;

  const cached = cache.get(slotName);
  if (cached && cached.key === key) return { mesh: cached.mesh, weights: cached.weights };

  const mesh =
    cached && cached.meshKey === meshKey ? cached.mesh : meshFromMask(maskFromCanvas(layer.canvas), density);
  const weights = computeWeights(mesh, bones);

  cache.set(slotName, { key, meshKey, mesh, weights });
  return { mesh, weights };
}
