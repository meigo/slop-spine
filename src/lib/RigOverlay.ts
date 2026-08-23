import type { Bone } from "../rig/document";
import type { RigMesh } from "../rig/mesh";
import type { Influence } from "../rig/weights";
import type { OverlayFlags } from "../state/ui.svelte";

/** One visible layer's derived slot, as the overlay needs it. */
export interface SlotOverlay {
  mesh: RigMesh;
  weights: Influence[][];
  /** True for the currently-selected layer's slot — drawn at full strength, on top. */
  selected: boolean;
}

export interface RigOverlayData {
  bones: Bone[];
  selectedBone: string | null;
  /** Every visible layer's derived slot. Weight tint for `selectedBone` is drawn against each of
   *  these in place — a slot whose bind list excludes that bone simply has no weight for it, so
   *  it stays untinted without this needing to filter by bind. May be empty when the mesh and
   *  tint are not being drawn. */
  slots: SlotOverlay[];
}

/** Fraction of full mesh-line opacity used for every mesh except the selected one — faint enough
 *  that the selected mesh reads as "in front", strong enough that the rest of the character (and
 *  any weight tint drawn on it) stays visible rather than vanishing. */
const DIM_FACTOR = 0.35;

/** Draws every visible slot's mesh (dimmed, selected slot on top at full strength), weight tint
 *  for the selected bone across all of them, and the bones. `zoom` is the viewport zoom so line
 *  widths and handle sizes stay a constant size on screen. */
export function drawRigOverlay(
  ctx: CanvasRenderingContext2D,
  data: RigOverlayData,
  zoom: number,
  flags: OverlayFlags,
) {
  const { bones, selectedBone, slots } = data;
  const screenPx = (px: number) => px / zoom;

  if (flags.mesh) {
    for (const slot of slots) {
      if (slot.selected || slot.mesh.vertices.length === 0) continue;
      drawMeshTriangles(ctx, slot.mesh, screenPx, DIM_FACTOR);
    }
    const selectedSlot = slots.find((s) => s.selected);
    if (selectedSlot && selectedSlot.mesh.vertices.length > 0) {
      drawMeshTriangles(ctx, selectedSlot.mesh, screenPx, 1);
    }
  }

  if (flags.tint) {
    if (selectedBone) {
      for (const slot of slots) {
        if (slot.mesh.vertices.length > 0) drawWeightTint(ctx, slot.mesh, slot.weights, selectedBone, screenPx);
      }
    }
  }

  if (flags.bones) {
    const prevAlpha = ctx.globalAlpha;
    if (flags.faint) ctx.globalAlpha = 0.35;
    for (const bone of bones) {
      // root is canvas-centre with no length — not a drawable/editable bone (see document.ts).
      if (bone.name === "root") continue;
      drawBone(ctx, bone, bone.name === selectedBone, screenPx);
    }
    ctx.globalAlpha = prevAlpha;
  }

  if (flags.capsule) {
    // Selected bone only, on top of everything else — drawing every bone's region at once makes
    // the canvas unreadable (Task 3 brief). A bone with reach === undefined draws nothing.
    const selected = bones.find((b) => b.name === selectedBone);
    if (selected && selected.reach !== undefined) {
      drawCapsule(ctx, selected, selected.reach, screenPx);
      drawReachHandle(ctx, selected, screenPx);
    }
  }
}

/** Capsule = the bone's segment offset by ±R, with semicircular caps at both ends. Standard
 *  two-arc capsule outline: walk one offset side out, cap around the far end, walk the other
 *  offset side back, cap around the near end. */
function drawCapsule(ctx: CanvasRenderingContext2D, bone: Bone, R: number, screenPx: (px: number) => number) {
  const rad = (bone.rotation * Math.PI) / 180;
  const x0 = bone.x;
  const y0 = bone.y;
  const x1 = bone.x + Math.cos(rad) * bone.length;
  const y1 = bone.y + Math.sin(rad) * bone.length;
  const perp = rad + Math.PI / 2;
  const ox = Math.cos(perp) * R;
  const oy = Math.sin(perp) * R;

  ctx.save();
  ctx.strokeStyle = "#38bdf8"; // same sky-blue as drawMeshTriangles' stroke, at full alpha
  ctx.lineWidth = screenPx(1.5);
  ctx.setLineDash([screenPx(5), screenPx(4)]);
  ctx.beginPath();
  ctx.moveTo(x0 + ox, y0 + oy);
  ctx.lineTo(x1 + ox, y1 + oy);
  ctx.arc(x1, y1, R, perp, perp - Math.PI, true);
  ctx.lineTo(x0 - ox, y0 - oy);
  ctx.arc(x0, y0, R, perp - Math.PI, perp, true);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** Where the drag handle sits: on the capsule edge, perpendicular to the bone at its midpoint.
 *  Exported so Canvas.svelte's hit-test uses the exact same point the handle is drawn at, rather
 *  than a second copy of this geometry that could drift from it. `undefined` reach (nothing to
 *  grab) and root (no length, and never selectable — see document.ts) both return null. */
export function reachHandlePosition(bone: Bone): Pt | null {
  if (bone.reach === undefined) return null;
  const rad = (bone.rotation * Math.PI) / 180;
  const midX = bone.x + Math.cos(rad) * (bone.length / 2);
  const midY = bone.y + Math.sin(rad) * (bone.length / 2);
  const perp = rad + Math.PI / 2;
  return { x: midX + Math.cos(perp) * bone.reach, y: midY + Math.sin(perp) * bone.reach };
}

function drawReachHandle(ctx: CanvasRenderingContext2D, bone: Bone, screenPx: (px: number) => number) {
  const pos = reachHandlePosition(bone);
  if (!pos) return;
  ctx.save();
  ctx.fillStyle = "#38bdf8";
  ctx.strokeStyle = "#0c4a6e";
  ctx.lineWidth = screenPx(1.5);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, screenPx(7), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMeshTriangles(
  ctx: CanvasRenderingContext2D,
  mesh: RigMesh,
  screenPx: (px: number) => number,
  alphaFactor: number,
) {
  ctx.save();
  ctx.strokeStyle = `rgba(56, 189, 248, ${0.55 * alphaFactor})`;
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
  const base = ctx.globalAlpha;
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
    ctx.globalAlpha = base * 0.25;
    ctx.fill();
    ctx.globalAlpha = base;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(bone.x, bone.y, screenPx(6), 0, Math.PI * 2);
  ctx.globalAlpha = base;
  ctx.fill();
  ctx.restore();
}

export interface Pt {
  x: number;
  y: number;
}

/** A single rigid pose gesture: rotate by `dtheta` about `pivot`, then translate by (dx, dy).
 *  `dtheta = 0` is a pure translation. */
export interface PoseDelta {
  pivot: Pt;
  dtheta: number;
  dx: number;
  dy: number;
}

/** Rest-pose vertices linear-blend-skinned by a single rigid pose gesture applied to `bones` (the
 *  dragged bone plus every descendant, which share one pivot/rotation/translation because
 *  rotating a bone carries its whole subtree rigidly — see moveBone's own dx/dy-to-descendants
 *  logic in doc.svelte.ts for the same idea applied to a plain move). Each vertex moves by its
 *  *combined* weight across `bones` toward the rigidly-posed position:
 *
 *    posed(v) = pivot + R(dtheta)*(v - pivot) + (dx, dy)
 *    v'       = v + w * (posed(v) - v),   w = sum of this vertex's weights for bones in `bones`
 *
 *  since every bone in `bones` shares the same posed(), this is exactly the general
 *  linear-blend-skinning sum "v + Σ wᵢ·(posedᵢ(v) − v)" collapsed by that equality. `dtheta = 0`
 *  reduces to the old translate-only preview exactly (rx, ry rotate to themselves, so posed(v) -
 *  v = (dx, dy) regardless of pivot). Never written back anywhere, so it costs nothing to get
 *  slightly wrong. */
export function poseDeform(mesh: RigMesh, weights: Influence[][], bones: string[], delta: PoseDelta): Pt[] {
  const { pivot, dtheta, dx, dy } = delta;
  const cos = Math.cos(dtheta);
  const sin = Math.sin(dtheta);
  const boneSet = new Set(bones);
  return mesh.vertices.map((v, i) => {
    let w = 0;
    for (const inf of weights[i] ?? []) {
      if (boneSet.has(inf.bone)) w += inf.weight;
    }
    if (w <= 0) return v;
    const rx = v.x - pivot.x;
    const ry = v.y - pivot.y;
    const posedX = pivot.x + rx * cos - ry * sin + dx;
    const posedY = pivot.y + rx * sin + ry * cos + dy;
    return { x: v.x + w * (posedX - v.x), y: v.y + w * (posedY - v.y) };
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
