import { emptyDocument, defaultBind, type RigDocument, type Layer, type Slot, type Bone } from "../rig/document";
import { invalidate } from "../rig/derive";
import { ui } from "./ui.svelte";

/** The single open document. Mutated in place (push/splice/property writes) so the
 *  exported binding never needs reassigning — see the mutations below. */
export let document = $state<RigDocument>(emptyDocument());

// Task 7's milestone found 48 (emptyDocument's own default, used by export fixtures/tests) too
// coarse for thin limbs; Task 10's slider defaults new documents to 24 instead. Not changed in
// document.ts itself, which fixture.ts and the spine-json tests pin to 48 independently.
document.density = 24;

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

export function removeLayer(id: number) {
  const index = document.layers.findIndex((l) => l.id === id);
  if (index === -1) return;
  document.layers.splice(index, 1);
  const slotIndex = document.slots.findIndex((s) => s.layerId === id);
  if (slotIndex === -1) return;
  const [slot] = document.slots.splice(slotIndex, 1);
  document.binds = document.binds.filter((b) => b.slot !== slot.name);
  invalidate(slot.name);
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
//  1. doc.bones lists parents before children — enforced here by construction: addBone always
//     appends, removeBone always takes its descendants with it. There is no setParent; if
//     re-parenting is ever added, the writer needs a topological sort first.
//  2. root stays at canvas centre with rotation 0 — moveBone, removeBone and setBoneRotation all
//     refuse to touch it. The UI (Canvas.svelte) also never offers it as a drag target.

/** All bones transitively parented under `name` (not including `name` itself). */
function descendantsOf(name: string): Bone[] {
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
  if (bone) bone.length = Math.max(0, len);
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

/** Replaces the set of bones that influence `slotName`'s weights (see rig/derive.ts). */
export function setBind(slotName: string, bones: string[]) {
  const bind = document.binds.find((b) => b.slot === slotName);
  if (bind) bind.bones = bones;
  else document.binds.push({ slot: slotName, bones });
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

  nextLayerId = doc.layers.reduce((m, l) => Math.max(m, l.id), 0) + 1;
  nextSlotOrder = doc.slots.reduce((m, s) => Math.max(m, s.order), -1) + 1;
  const boneIndices = doc.bones
    .map((b) => /^bone(\d+)$/.exec(b.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  nextBoneIndex = boneIndices.length > 0 ? Math.max(...boneIndices) + 1 : 1;
}
