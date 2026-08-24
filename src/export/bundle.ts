import { zipSync, strToU8 } from "fflate";
import type { RigDocument } from "../rig/document";
import type { RigMesh } from "../rig/mesh";
import type { Influence } from "../rig/weights";
import { deriveSlot } from "../rig/derive";
import { trimLayer } from "./trim";
import { packAtlas } from "./atlas";
import { writeSkeleton } from "./spine-json";

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/** spine-ts collapses every `boneCount: 0` vertex to the skeleton origin. A drawing-only
 *  document (root, no real bones) would export a valid zip of an invisible character. */
export function assertExportable(doc: RigDocument): void {
  if (!doc.bones.some((b) => b.name !== "root")) {
    throw new ExportError(
      "Add a bone before exporting. Spine collapses meshes with no bone weights.",
    );
  }
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

export async function exportBundle(doc: RigDocument): Promise<Blob> {
  assertExportable(doc);
  const meshes: Record<string, RigMesh> = {};
  const weights: Record<string, Influence[][]> = {};
  const items: { name: string; trim: ReturnType<typeof trimLayer> }[] = [];

  for (const slot of doc.slots) {
    const layer = doc.layers.find((l) => l.id === slot.layerId)!;
    // Same cache the rig overlay reads (Task 10) — export and the on-screen mesh/weights can
    // never disagree, since both derive from the identical (layer.revision, density, bind) key.
    const { mesh, weights: slotWeights } = deriveSlot(doc, slot.name);
    meshes[slot.name] = mesh;
    weights[slot.name] = slotWeights;
    items.push({ name: slot.name, trim: trimLayer(layer.canvas) });
  }

  const atlas = packAtlas(items, doc.canvas.width, doc.canvas.height);

  // Blit each trimmed layer onto the atlas page.
  const page = document.createElement("canvas");
  page.width = atlas.pageWidth;
  page.height = atlas.pageHeight;
  const pctx = page.getContext("2d")!;
  for (const r of atlas.regions) {
    const slot = doc.slots.find((s) => s.name === r.name)!;
    const layer = doc.layers.find((l) => l.id === slot.layerId)!;
    pctx.drawImage(
      layer.canvas,
      r.trim.x,
      r.trim.y,
      r.trim.width,
      r.trim.height,
      r.pageX,
      r.pageY,
      r.trim.width,
      r.trim.height,
    );
  }

  const skeleton = writeSkeleton({
    doc,
    meshes,
    weights,
    regions: atlas.regions,
    page: { width: atlas.pageWidth, height: atlas.pageHeight },
  });

  const files: Record<string, Uint8Array> = {
    "skeleton.spinejson": strToU8(JSON.stringify(skeleton)),
    "skeleton.atlas": strToU8(atlas.text),
    "skeleton.png": await blobBytes(await canvasBlob(page)),
  };
  for (const layer of doc.layers) {
    // Keyed on id, not name: layer names aren't unique (only slot names are uniquified), so two
    // layers named the same would collide on this key and one PNG would silently go missing.
    files[`layers/${layer.id}.png`] = await blobBytes(await canvasBlob(layer.canvas));
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}

function canvasBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}
