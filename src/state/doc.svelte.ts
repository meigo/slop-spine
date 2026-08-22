import { emptyDocument, type RigDocument, type Layer } from "../rig/document";

/** The single open document. Mutated in place (push/splice/property writes) so the
 *  exported binding never needs reassigning — see the mutations below. */
export let document = $state<RigDocument>(emptyDocument());

let nextLayerId = 1;

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

/** Adds a new layer on top of the stack (end of the array). Returns its id. */
export function addLayer(name: string): number {
  const layer = createLayer(name);
  document.layers.push(layer);
  return layer.id;
}

export function removeLayer(id: number) {
  const index = document.layers.findIndex((l) => l.id === id);
  if (index === -1) return;
  document.layers.splice(index, 1);
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
