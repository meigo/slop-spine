import type { RigDocument, Bone, Slot } from "../rig/document";
import type { RigMesh } from "../rig/mesh";
import type { Influence } from "../rig/weights";
import type { Region } from "./atlas";

export interface SkeletonInput {
  doc: RigDocument;
  meshes: Record<string, RigMesh>;
  weights: Record<string, Influence[][]>;
  regions: Region[];
  page: { width: number; height: number };
}

const DEG = Math.PI / 180;

/** Canvas (y-down, top-left origin) → skeleton space (y-up, canvas-centre origin). */
export function toSkeletonSpace(canvas: { width: number; height: number }, x: number, y: number) {
  return { x: x - canvas.width / 2, y: canvas.height / 2 - y };
}

export interface World { x: number; y: number; rotation: number }

/** A bone's setup-pose transform in skeleton space. Because bones are stored with ABSOLUTE canvas
 *  position and rotation, this is a straight conversion — no parent chain walk. Scale is always 1. */
export function boneWorld(canvas: { width: number; height: number }, b: Bone): World {
  const p = toSkeletonSpace(canvas, b.x, b.y);
  return { x: p.x, y: p.y, rotation: -b.rotation };
}

/** World point → the bone's local space. Inverse of R(rotation) * local + (x,y). */
export function toBoneLocal(w: World, p: { x: number; y: number }) {
  const r = w.rotation * DEG;
  const dx = p.x - w.x;
  const dy = p.y - w.y;
  return { x: Math.cos(r) * dx + Math.sin(r) * dy, y: -Math.sin(r) * dx + Math.cos(r) * dy };
}

export function writeSkeleton(input: SkeletonInput) {
  const { doc, meshes, weights, regions } = input;
  const canvas = doc.canvas;
  const conv = (x: number, y: number) => toSkeletonSpace(canvas, x, y);

  // Bones, parents before children (document order is maintained by the editor).
  // Spine wants each bone's rotation relative to its parent, and its position in the parent's
  // rotated frame — which is exactly toBoneLocal of the child's world position.
  const byName = new Map(doc.bones.map((b) => [b.name, b]));
  const outBones = doc.bones.map((b) => {
    if (!b.parent) return { name: b.name };
    const wb = boneWorld(canvas, b);
    const wp = boneWorld(canvas, byName.get(b.parent)!);
    const local = toBoneLocal(wp, { x: wb.x, y: wb.y });
    return {
      name: b.name,
      parent: b.parent,
      length: b.length,
      rotation: wb.rotation - wp.rotation,
      x: local.x,
      y: local.y,
    };
  });

  const boneIndex = new Map(doc.bones.map((b, i) => [b.name, i]));
  // doc.layers array order is what the canvas already draws (and what the layer panel's drag
  // reorder mutates) — sort by that instead of slot.order, which is assigned once at layer
  // creation and never rewritten by a reorder (see Slot.order's comment in rig/document.ts).
  const layerIndex = (s: Slot) => doc.layers.findIndex((l) => l.id === s.layerId);
  const slots = [...doc.slots]
    .sort((a, b) => layerIndex(a) - layerIndex(b))
    .map((s) => ({ name: s.name, bone: s.bone, attachment: s.name }));

  const attachments: Record<string, Record<string, unknown>> = {};
  for (const slot of doc.slots) {
    const mesh = meshes[slot.name];
    const w = weights[slot.name];
    const region = regions.find((r) => r.name === slot.name);
    if (!mesh || !w || !region || mesh.vertices.length === 0) continue;

    const uvs: number[] = [];
    const verts: number[] = [];
    mesh.vertices.forEach((v, i) => {
      // Spine mesh uvs are normalized against the ORIGINAL untrimmed canvas, y-down — not the
      // trimmed region and not the atlas page. The runtime's own AtlasAttachmentLoader remaps
      // these into the packed region using the .atlas file's offsets/bounds; baking any of that
      // placement into the uvs here double-applies it.
      uvs.push(v.x / canvas.width, v.y / canvas.height);

      const world = conv(v.x, v.y);
      const infl = w[i];
      verts.push(infl.length);
      for (const inf of infl) {
        const local = toBoneLocal(boneWorld(canvas, byName.get(inf.bone)!), world);
        verts.push(boneIndex.get(inf.bone)!, local.x, local.y, inf.weight);
      }
    });

    attachments[slot.name] = {
      [slot.name]: {
        type: "mesh",
        uvs,
        triangles: mesh.triangles.flat(),
        vertices: verts,
        hull: mesh.hull,
      },
    };
  }

  const physics = doc.bones
    .filter((b) => b.wobble > 0)
    .map((b, i) => ({
      name: b.name,
      order: i,
      bone: b.name,
      rotate: 1,
      inertia: 0.5 * b.wobble,
      damping: 0.85,
    }));

  return {
    skeleton: { spine: "4.2", x: -canvas.width / 2, y: -canvas.height / 2, width: canvas.width, height: canvas.height },
    bones: outBones,
    slots,
    ...(physics.length ? { physics } : {}),
    skins: [{ name: "default", attachments }],
    animations: { setup: {} },
  };
}
