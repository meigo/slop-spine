import { zipSync, unzipSync, strToU8, strFromU8, type ZipOptions } from "fflate";
import type { RigDocument, Layer, Slot, Bone, Bind } from "../rig/document";

/** JSON-safe mirror of Layer: `canvas` is replaced by a PNG path in the zip, `id`/`revision` kept
 *  so the load path can restore both the pixels and Task 10's derivation cache key. */
interface LayerJson {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  revision: number;
}

interface DocumentJson {
  canvas: { width: number; height: number };
  density: number;
  layers: LayerJson[];
  slots: Slot[];
  bones: Bone[];
  binds: Bind[];
}

function layerPngPath(id: number): string {
  return `layers/${id}.png`;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (b) => {
      if (!b) return reject(new Error("toBlob failed"));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, "image/png");
  });
}

/** Decodes PNG bytes into an <img>. Callers draw it themselves — this does not touch alpha. */
function decodePng(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("png decode failed"));
    };
    img.src = url;
  });
}

/** Zips the document: `document.json` plus one PNG per layer. PNG already carries its own
 *  DEFLATE compression, so it's stored (level 0) rather than re-compressed. */
export async function saveProject(doc: RigDocument): Promise<Blob> {
  const json: DocumentJson = {
    canvas: doc.canvas,
    density: doc.density,
    layers: doc.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, revision: l.revision })),
    slots: doc.slots,
    bones: doc.bones,
    binds: doc.binds,
  };
  const files: Record<string, Uint8Array | [Uint8Array, ZipOptions]> = {
    "document.json": strToU8(JSON.stringify(json)),
  };
  for (const layer of doc.layers) {
    files[layerPngPath(layer.id)] = [await canvasToPngBytes(layer.canvas), { level: 0 }];
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}

/** Rebuilds a RigDocument from a zip made by `saveProject`. Each layer's canvas is created blank
 *  (fully transparent — canvases start that way, and nothing here fills a background) and the PNG
 *  is drawn onto it, which is what keeps unpainted pixels at alpha 0 instead of turning opaque. */
export async function loadProject(file: Blob): Promise<RigDocument> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const json = JSON.parse(strFromU8(zip["document.json"])) as DocumentJson;

  const layers: Layer[] = [];
  for (const lj of json.layers) {
    const canvas = document.createElement("canvas");
    canvas.width = json.canvas.width;
    canvas.height = json.canvas.height;
    const bytes = zip[layerPngPath(lj.id)];
    if (bytes) {
      const img = await decodePng(bytes);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    layers.push({ id: lj.id, name: lj.name, visible: lj.visible, opacity: lj.opacity, canvas, revision: lj.revision });
  }

  return {
    canvas: json.canvas,
    density: json.density,
    layers,
    slots: json.slots,
    bones: json.bones,
    binds: json.binds,
  };
}
