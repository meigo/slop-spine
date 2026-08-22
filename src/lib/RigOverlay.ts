import type { Bone } from "../rig/document";
import type { RigMesh } from "../rig/mesh";
import type { Influence } from "../rig/weights";

export interface RigOverlayData {
  bones: Bone[];
  selectedBone: string | null;
  /** The selected layer's slot mesh/weights, or null if that layer has no slot yet. */
  mesh: RigMesh | null;
  weights: Influence[][] | null;
}

/** Draws the mesh, bones and (when a bone is selected) its weight tint on top of the canvas.
 *  `zoom` is the viewport zoom so line widths and handle sizes stay a constant size on screen. */
export function drawRigOverlay(ctx: CanvasRenderingContext2D, data: RigOverlayData, zoom: number) {
  const { bones, selectedBone, mesh, weights } = data;
  const screenPx = (px: number) => px / zoom;

  if (mesh && mesh.vertices.length > 0) {
    drawMeshTriangles(ctx, mesh, screenPx);
    if (selectedBone && weights) drawWeightTint(ctx, mesh, weights, selectedBone, screenPx);
  }

  for (const bone of bones) {
    // root is canvas-centre with no length — not a drawable/editable bone (see document.ts).
    if (bone.name === "root") continue;
    drawBone(ctx, bone, bone.name === selectedBone, screenPx);
  }
}

function drawMeshTriangles(ctx: CanvasRenderingContext2D, mesh: RigMesh, screenPx: (px: number) => number) {
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
  ctx.lineWidth = screenPx(1);
  for (const [a, b, c] of mesh.triangles) {
    const va = mesh.vertices[a];
    const vb = mesh.vertices[b];
    const vc = mesh.vertices[c];
    ctx.beginPath();
    ctx.moveTo(va.x, va.y);
    ctx.lineTo(vb.x, vb.y);
    ctx.lineTo(vc.x, vc.y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawWeightTint(
  ctx: CanvasRenderingContext2D,
  mesh: RigMesh,
  weights: Influence[][],
  boneName: string,
  screenPx: (px: number) => number,
) {
  ctx.save();
  ctx.fillStyle = "#ff3060";
  for (let i = 0; i < mesh.vertices.length; i++) {
    const weight = weights[i]?.find((inf) => inf.bone === boneName)?.weight ?? 0;
    if (weight <= 0) continue;
    const v = mesh.vertices[i];
    ctx.globalAlpha = weight;
    ctx.beginPath();
    ctx.arc(v.x, v.y, screenPx(5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBone(ctx: CanvasRenderingContext2D, bone: Bone, selected: boolean, screenPx: (px: number) => number) {
  const rad = (bone.rotation * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const tipX = bone.x + dx * bone.length;
  const tipY = bone.y + dy * bone.length;
  const color = selected ? "#ffd23f" : "#4fd1c5";

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = screenPx(selected ? 2.5 : 1.5);

  if (bone.length > 0) {
    // A simple tapered kite: origin -> two "ears" a short way along the bone -> tip.
    const earDist = Math.min(bone.length * 0.15, screenPx(14));
    const earWidth = Math.min(bone.length * 0.12, screenPx(8));
    const px = -dy;
    const py = dx;
    const earX = bone.x + dx * earDist;
    const earY = bone.y + dy * earDist;
    ctx.beginPath();
    ctx.moveTo(bone.x, bone.y);
    ctx.lineTo(earX + px * earWidth, earY + py * earWidth);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(earX - px * earWidth, earY - py * earWidth);
    ctx.closePath();
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(bone.x, bone.y, screenPx(6), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export interface Pt {
  x: number;
  y: number;
}

/** Rest-pose vertices offset by (dx, dy) scaled by each vertex's weight for `bone` — a
 *  translate-only linear-blend-skinning approximation. Good enough to preview whether a pose
 *  tears; never written back anywhere, so it costs nothing to get slightly wrong. */
export function poseDeform(mesh: RigMesh, weights: Influence[][], bone: string, dx: number, dy: number): Pt[] {
  return mesh.vertices.map((v, i) => {
    const t = weights[i]?.find((inf) => inf.bone === bone)?.weight ?? 0;
    return { x: v.x + dx * t, y: v.y + dy * t };
  });
}

/** Draws `source` warped so each mesh triangle's rest position maps onto `deformed`, by sampling
 *  the source through a per-triangle affine transform (solve M, t with M*s_i + t = d_i for the
 *  triangle's three vertices, then clip + drawImage). `source` itself is never modified. */
export function drawWarpedLayer(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  mesh: RigMesh,
  deformed: Pt[],
) {
  for (const [a, b, c] of mesh.triangles) {
    const s0 = mesh.vertices[a];
    const s1 = mesh.vertices[b];
    const s2 = mesh.vertices[c];
    const d0 = deformed[a];
    const d1 = deformed[b];
    const d2 = deformed[c];

    const s1x = s1.x - s0.x;
    const s1y = s1.y - s0.y;
    const s2x = s2.x - s0.x;
    const s2y = s2.y - s0.y;
    const d1x = d1.x - d0.x;
    const d1y = d1.y - d0.y;
    const d2x = d2.x - d0.x;
    const d2y = d2.y - d0.y;

    const det = s1x * s2y - s2x * s1y;
    if (Math.abs(det) < 1e-6) continue; // degenerate triangle, skip

    const a11 = (d1x * s2y - d2x * s1y) / det;
    const a21 = (d1y * s2y - d2y * s1y) / det;
    const a12 = (d2x * s1x - d1x * s2x) / det;
    const a22 = (d2y * s1x - d1y * s2x) / det;
    const tx = d0.x - (a11 * s0.x + a12 * s0.y);
    const ty = d0.y - (a21 * s0.x + a22 * s0.y);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a11, a21, a12, a22, tx, ty);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
}
