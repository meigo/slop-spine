import { emptyDocument, defaultBind, type RigDocument, type Layer, type Slot, type Bone } from "../rig/document";
import { invalidate } from "../rig/derive";
import { ui } from "./ui.svelte";
import { history } from "./history.svelte";

/** The single open document. Mutated in place (push/splice/property writes) so the
 *  exported binding never needs reassigning — see the mutations below. */
export let document = $state<RigDocument>(emptyDocument());

let nextLayerId = 1;
let nextBoneIndex = 1;
// Monotonic, not derived from document.slots.length — a slot can be removed (see removeLayer),
// so array length is not a stable draw-order value across an add/remove/add cycle. Only relative
// order matters, not contiguity, so a plain counter that never decreases is sufficient.
let nextSlotOrder = 0;

function createLayer(name: string): Layer {
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = document.canvas.width;
  canvas.height = document.canvas.height;
  return {
    id: nextLayerId++,
    name,
    visible: true,
    opacity: 1,
    canvas,
    revision: 0,
  };
}

/** Slot.name must be unique (see document.ts); layer names aren't, so a colliding layer name
 *  gets a numeric suffix on its slot rather than silently overwriting another slot's attachment. */
function uniqueSlotName(base: string): string {
  let name = base;
  let i = 2;
  while (document.slots.some((s) => s.name === name)) name = `${base}-${i++}`;
  return name;
}

/** Adds a new layer on top of the stack (end of the array), plus the one slot every layer has
 *  (bound to root by default — override its influencing bones via setBind). Returns the layer id. */
export function addLayer(name: string): number {
  const layer = createLayer(name);
  document.layers.push(layer);
  const slot: Slot = { name: uniqueSlotName(name), layerId: layer.id, bone: "root", order: nextSlotOrder++ };
  document.slots.push(slot);
  document.binds.push({ slot: slot.name, bones: defaultBind(document, slot) });
  return layer.id;
}

/** Undoable: pushes a command that re-inserts the layer, its slot (at its original `order` —
 *  see Slot.order's comment) and its bind at their original array indices. The layer's `canvas`
 *  is retained by the closure, so undo brings the pixels back for free.
 *
 *  `document.layers`' position is re-anchored to the id of the preceding layer rather than
 *  trusting `index`: `reorderLayer` mutates that array without going through history, so by undo
 *  time `index` may no longer describe where the layer was. Slots/binds keep their original
 *  indices since nothing reorders those arrays. */
export function removeLayer(id: number) {
  const index = document.layers.findIndex((l) => l.id === id);
  if (index === -1) return;
  const slotIndex = document.slots.findIndex((s) => s.layerId === id);
  if (slotIndex === -1) return;
  const prevLayerId = index > 0 ? document.layers[index - 1].id : null;
  const [layer] = document.layers.splice(index, 1);
  const [slot] = document.slots.splice(slotIndex, 1);
  const bindIndex = document.binds.findIndex((b) => b.slot === slot.name);
  const [bind] = bindIndex === -1 ? [undefined] : document.binds.splice(bindIndex, 1);
  invalidate(slot.name);
  history.push({
    undo() {
      const p = prevLayerId === null ? -1 : document.layers.findIndex((l) => l.id === prevLayerId);
      const at = prevLayerId === null ? 0 : p === -1 ? document.layers.length : p + 1;
      document.layers.splice(at, 0, layer);
      document.slots.splice(slotIndex, 0, slot);
      if (bind !== undefined) document.binds.splice(bindIndex, 0, bind);
      markLayerDirty(id);
    },
    redo() {
      document.layers.splice(document.layers.findIndex((l) => l.id === id), 1);
      document.slots.splice(document.slots.findIndex((s) => s.name === slot.name), 1);
      document.binds = document.binds.filter((b) => b.slot !== slot.name);
      invalidate(slot.name);
    },
  });
}

/** Moves the layer to array index `index` (0 = bottom of the stack). */
export function reorderLayer(id: number, index: number) {
  const from = document.layers.findIndex((l) => l.id === id);
  if (from === -1) return;
  const [layer] = document.layers.splice(from, 1);
  const clamped = Math.max(0, Math.min(index, document.layers.length));
  document.layers.splice(clamped, 0, layer);
}

export function renameLayer(id: number, name: string) {
  const layer = document.layers.find((l) => l.id === id);
  if (layer) layer.name = name;
}

export function toggleVisible(id: number) {
  const layer = document.layers.find((l) => l.id === id);
  if (layer) layer.visible = !layer.visible;
}

/** Sets a layer's opacity (0-1, clamped). Honoured by Canvas.svelte's redraw (`ctx.globalAlpha`)
 *  and, below 1, by the Spine writer (emits slot `color` alpha — see spine-json.ts). */
export function setLayerOpacity(id: number, opacity: number) {
  const layer = document.layers.find((l) => l.id === id);
  if (layer) layer.opacity = Math.max(0, Math.min(1, opacity));
}

/** Bumps a layer's revision. Call after any operation that changes its pixels — Task 10's
 *  derivation cache keys on this to know when to regenerate the mesh and weights. */
export function markLayerDirty(id: number) {
  const l = document.layers.find((x) => x.id === id);
  if (l) l.revision += 1;
}

// --- Bones -------------------------------------------------------------------------------------
// Two invariants the Spine writer (Task 6) silently depends on:
//  1. doc.bones lists parents before children — enforced by construction for addBone/removeBone
//     (addBone always appends, removeBone always takes its descendants with it), and by
//     setParent re-sorting the whole array (see sortBonesByHierarchy) after every parent change.
//     The writer itself is never touched — the invariant is kept true here, not repaired there.
//  2. root stays at canvas centre with rotation 0 — moveBone, removeBone and setBoneRotation all
//     refuse to touch it. The UI (Canvas.svelte) also never offers it as a drag target.

/** All bones transitively parented under `name` (not including `name` itself). Exported for
 *  RigPanel.svelte, which needs the same set to exclude invalid parent choices from its dropdown. */
export function descendantsOf(name: string): Bone[] {
  const result: Bone[] = [];
  const stack = [name];
  while (stack.length > 0) {
    const parent = stack.pop()!;
    for (const b of document.bones) {
      if (b.parent === parent) {
        result.push(b);
        stack.push(b.name);
      }
    }
  }
  return result;
}

/** Adds a child of `parent` at (x, y), length 0, rotation 0. Appends to doc.bones, which is what
 *  keeps parents ahead of children — a bone can only be created from one that already exists.
 *  Returns the new bone's name, or null if `parent` doesn't exist. */
export function addBone(parent: string, x: number, y: number): string | null {
  if (!document.bones.some((b) => b.name === parent)) return null;
  let name = `bone${nextBoneIndex++}`;
  while (document.bones.some((b) => b.name === name)) name = `bone${nextBoneIndex++}`;
  document.bones.push({ name, parent, x, y, rotation: 0, length: 0, wobble: 0 });
  return name;
}

/** Sets a bone's absolute position and drags its descendants by the same delta — bones are
 *  stored absolute, so without this a moved limb's children would separate from it. Refuses root. */
export function moveBone(name: string, x: number, y: number) {
  if (name === "root") return;
  const bone = document.bones.find((b) => b.name === name);
  if (!bone) return;
  const dx = x - bone.x;
  const dy = y - bone.y;
  bone.x = x;
  bone.y = y;
  for (const child of descendantsOf(name)) {
    child.x += dx;
    child.y += dy;
  }
}

export function setBoneLength(name: string, len: number) {
  const bone = document.bones.find((b) => b.name === name);
  if (!bone) return;
  bone.length = Math.max(0, len);
  // Seed reach here, not in addBone: addBone always creates length 0 (length arrives from the
  // drag that follows creation), so seeding there would seed reach at zero — and Bone.reach's own
  // semantics treat 0 as "unlimited," so every vertex would silently fall through to the
  // nearest-bone fallback instead of actually being limited. `bone.reach === undefined` is true
  // only for a bone that has never had its reach set (by this seed or by setReach), so an existing
  // bone's length can be resized later without this clobbering a reach the user already dragged.
  if (bone.reach === undefined) bone.reach = Math.max(MIN_REACH, bone.length);
}

/** Degrees, screen-space CCW-positive (matches Bone.rotation). Refuses root: its rotation must
 *  stay 0 because the Spine writer emits it as a bare `{ name }` with no transform. */
export function setBoneRotation(name: string, deg: number) {
  if (name === "root") return;
  const bone = document.bones.find((b) => b.name === name);
  if (bone) bone.rotation = deg;
}

/** Removes a bone and everything parented under it, directly or transitively — otherwise a
 *  surviving bone's `parent` would dangle. Refuses root. Also strips the removed names out of
 *  any bind list and resets any slot pointing at one back to root, so nothing is left dangling. */
export function removeBone(name: string) {
  if (name === "root") return;
  if (!document.bones.some((b) => b.name === name)) return;
  const removed = new Set([name, ...descendantsOf(name).map((b) => b.name)]);
  document.bones = document.bones.filter((b) => !removed.has(b.name));
  for (const bind of document.binds) {
    bind.bones = bind.bones.filter((n) => !removed.has(n));
  }
  for (const slot of document.slots) {
    if (removed.has(slot.bone)) slot.bone = "root";
  }
}

/** Stable topological sort: repeatedly moves every bone whose parent has already been placed (or
 *  has no parent) into the result, in passes. Within a pass, bones are appended in their existing
 *  relative order, so siblings that become placeable together keep their existing relative order —
 *  the result is "parents before children" with everything else left as it was. Assumes no cycles
 *  (setParent refuses them before this ever runs); if one somehow slipped through, the affected
 *  bones would simply never become ready and the loop stops rather than spinning forever. */
function sortBonesByHierarchy(bones: Bone[]): Bone[] {
  const result: Bone[] = [];
  const placed = new Set<string>();
  let remaining = bones;
  while (remaining.length > 0) {
    const ready: Bone[] = [];
    const rest: Bone[] = [];
    for (const b of remaining) {
      (b.parent === null || placed.has(b.parent) ? ready : rest).push(b);
    }
    if (ready.length === 0) break;
    for (const b of ready) placed.add(b.name);
    result.push(...ready);
    remaining = rest;
  }
  return result;
}

/** Changes a bone's parent, then re-sorts doc.bones back into parents-before-children order (see
 *  invariant 1 above) so the Spine writer never has to. Refuses root (it has no parent — the
 *  writer emits it as a bare `{ name }` with no transform) and refuses a cycle: parenting a bone
 *  to itself or to any of its own descendants, which would leave that part of the tree impossible
 *  to order and would make export malformed. Bones store ABSOLUTE position and rotation (see
 *  Bone's fields), so this is purely a hierarchy edit — no coordinates change here. */
export function setParent(name: string, newParent: string) {
  if (name === "root" || newParent === name) return;
  const bone = document.bones.find((b) => b.name === name);
  if (!bone) return;
  if (!document.bones.some((b) => b.name === newParent)) return;
  if (descendantsOf(name).some((b) => b.name === newParent)) return;
  bone.parent = newParent;
  document.bones = sortBonesByHierarchy(document.bones);
}

/** Renames a bone and every reference to it (children's `parent`, binds, slots). Refuses root
 *  (its literal name is load-bearing — document.ts's defaultBind filters on the string "root")
 *  and refuses a name collision. */
export function renameBone(oldName: string, newName: string) {
  const trimmed = newName.trim();
  if (!trimmed || oldName === "root" || trimmed === oldName) return;
  if (document.bones.some((b) => b.name === trimmed)) return;
  const bone = document.bones.find((b) => b.name === oldName);
  if (!bone) return;
  bone.name = trimmed;
  for (const b of document.bones) {
    if (b.parent === oldName) b.parent = trimmed;
  }
  for (const bind of document.binds) {
    bind.bones = bind.bones.map((n) => (n === oldName ? trimmed : n));
  }
  for (const slot of document.slots) {
    if (slot.bone === oldName) slot.bone = trimmed;
  }
}

export function setWobble(name: string, v: number) {
  const bone = document.bones.find((b) => b.name === name);
  if (bone) bone.wobble = Math.max(0, Math.min(1, v));
}

// Canvas px. Bone.reach's own doc comment (rig/document.ts) and computeWeights' guard (`R > 0`,
// src/rig/weights.ts) both treat 0 as "unlimited," not "no influence" — so the drag handle must
// never be able to reach exactly 0. Matches the distance floor weights.ts already uses for the
// same reason (`Math.max(d, 1)`) rather than inventing a second arbitrary constant.
const MIN_REACH = 1;

/** Sets a bone's influence radius (Task 3's drag handle). Clamped above zero — see MIN_REACH. */
export function setReach(name: string, reach: number) {
  const bone = document.bones.find((b) => b.name === name);
  if (bone) bone.reach = Math.max(MIN_REACH, reach);
}

/** Replaces the set of bones that influence `slotName`'s weights (see rig/derive.ts). */
export function setBind(slotName: string, bones: string[]) {
  const bind = document.binds.find((b) => b.slot === slotName);
  if (bind) bind.bones = bones;
  else document.binds.push({ slot: slotName, bones });
}

/** Sets a slot's mesh density override, or clears it (`undefined`) to fall back to inheriting
 *  doc.density — see rig/derive.ts's effective-density lookup. */
export function setSlotDensity(slotName: string, density: number | undefined) {
  const slot = document.slots.find((s) => s.name === slotName);
  if (slot) slot.density = density;
}

// --- Persistence (Task 11) ----------------------------------------------------------------------

/** Replaces the live document's contents in place — keeps the same $state object so existing
 *  bindings stay wired, only its fields change — and fast-forwards the id counters past whatever
 *  is in `doc`. Without this, a reloaded document whose highest layer id (or slot order) exceeds
 *  the reset-to-1 counters would collide with restored ids on the next add. */
export function loadDocument(doc: RigDocument) {
  document.canvas = doc.canvas;
  document.density = doc.density;
  document.layers = doc.layers;
  document.slots = doc.slots;
  document.bones = doc.bones;
  document.binds = doc.binds;
  invalidate();
  // Otherwise a coincidental id match against the new document carries the old selection onto
  // an unrelated layer/bone — nothing crashes (consumers degrade via `?? null`), but strokes can
  // land on a layer that's hidden behind an opaque one.
  ui.selectedLayerId = null;
  ui.selectedBone = null;
  // Otherwise every retained command still holds a ctx for the previous document's detached
  // canvases — undoing after a load is a silent no-op that dirties whatever layer in the new
  // document happens to share the old command's layer id.
  history.clear();

  nextLayerId = doc.layers.reduce((m, l) => Math.max(m, l.id), 0) + 1;
  nextSlotOrder = doc.slots.reduce((m, s) => Math.max(m, s.order), -1) + 1;
  const boneIndices = doc.bones
    .map((b) => /^bone(\d+)$/.exec(b.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  nextBoneIndex = boneIndices.length > 0 ? Math.max(...boneIndices) + 1 : 1;
}
