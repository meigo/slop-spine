import { readPsd } from "ag-psd";
import { emptyDocument, type RigDocument, type Layer, type Slot, type Bind } from "../rig/document";

/** Minimal PSD tree for flattening. Matches ag-psd's Layer shape. */
export interface PsdNode {
  name?: string;
  hidden?: boolean;
  opacity?: number;
  canvas?: HTMLCanvasElement | null;
  left?: number;
  top?: number;
  children?: PsdNode[];
}

export interface FlatPsdLayer {
  name: string;
  visible: boolean;
  opacity: number;
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
}

function ignored(name: string): boolean {
  return /\[ignore\]/i.test(name);
}

/** Strip Spine-style `[slot][mesh]` prefixes so the layer/slot name is the Photoshop base. */
export function psdBaseName(name: string): string {
  return name.replace(/^(\[[a-zA-Z]+\])+/g, "").trim() || "Layer";
}

/** Walk a PSD layer tree bottom-to-top, flattening groups. `[ignore]` drops a node and its kids. */
export function flattenPsdLayers(nodes: PsdNode[] | undefined): FlatPsdLayer[] {
  const out: FlatPsdLayer[] = [];
  function walk(list: PsdNode[]) {
    for (const n of list) {
      const raw = n.name ?? "";
      if (ignored(raw)) continue;
      if (n.children && n.children.length > 0) {
        walk(n.children);
        continue;
      }
      if (!n.canvas) continue;
      out.push({
        name: psdBaseName(raw),
        visible: !n.hidden,
        opacity: Math.max(0, Math.min(1, n.opacity ?? 1)),
        canvas: n.canvas,
        left: n.left ?? 0,
        top: n.top ?? 0,
      });
    }
  }
  if (nodes?.length) walk(nodes);
  return out;
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Build a rig document from a PSD: one layer+slot per pixel layer, root bone only.
 *  Groups are flattened. Canvas size is the PSD size (max 8192). */
export function importPsd(buffer: ArrayBuffer): RigDocument {
  const psd = readPsd(buffer);
  const w = psd.width;
  const h = psd.height;
  if (!w || !h) throw new Error("PSD has no size");
  if (w > 8192 || h > 8192) throw new Error(`PSD is ${w}×${h}; max canvas is 8192`);

  let flat = flattenPsdLayers(psd.children);
  if (flat.length === 0 && psd.canvas) {
    flat = [{ name: "Background", visible: true, opacity: 1, canvas: psd.canvas, left: 0, top: 0 }];
  }

  const doc = emptyDocument(w, h);
  const layers: Layer[] = [];
  const slots: Slot[] = [];
  const binds: Bind[] = [];
  const taken = new Set<string>();
  let id = 1;
  let order = 0;
  for (const src of flat) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(src.canvas, src.left, src.top);
    const name = uniqueName(src.name, taken);
    taken.add(name);
    layers.push({
      id,
      name,
      visible: src.visible,
      opacity: src.opacity,
      canvas,
      revision: 0,
    });
    slots.push({ name, layerId: id, bone: "root", order: order++ });
    binds.push({ slot: name, bones: [] });
    id++;
  }
  doc.layers = layers;
  doc.slots = slots;
  doc.binds = binds;
  return doc;
}
