import Delaunator from "delaunator";

export interface Pt {
  x: number;
  y: number;
}
export interface Mesh {
  vertices: Pt[];
  triangles: [number, number, number][];
}

type Inside = (x: number, y: number) => boolean;

const N8: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Max distance, in pixels, from the pixel silhouette to a chord of the simplified outline.
 *  Small enough that stairsteps collapse and corners survive; independent of `spacing` so a
 *  coarse interior grid does not facet the hull. */
const OUTLINE_EPS = 1.5;

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function isEdge(inside: Inside, width: number, height: number, x: number, y: number): boolean {
  if (!inBounds(x, y, width, height) || !inside(x, y)) return false;
  return !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
}

function key(x: number, y: number): number {
  return y * 1e7 + x;
}

function distPointToSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function rdpOpen(pts: Pt[], eps: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  let maxD = 0;
  let idx = -1;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPointToSeg(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps || idx < 0) return [a, b];
  const left = rdpOpen(pts.slice(0, idx + 1), eps);
  const right = rdpOpen(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

function simplifyClosed(pts: Pt[], eps: number): Pt[] {
  let ring = pts;
  if (ring.length >= 2 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return ring.slice();
  let idx = 1;
  let maxD = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  const first = rdpOpen(ring.slice(0, idx + 1), eps);
  const second = rdpOpen(ring.slice(idx).concat([ring[0]]), eps);
  return first.slice(0, -1).concat(second.slice(0, -1));
}

/** Walk the 8-connected edge starting at `(sx, sy)`. `visited` is shared across contours. */
function traceContour(
  inside: Inside,
  width: number,
  height: number,
  sx: number,
  sy: number,
  visited: Set<number>,
): Pt[] {
  const pts: Pt[] = [];
  let x = sx;
  let y = sy;
  let dir = 0;
  for (let i = 0; i < 8; i++) {
    if (!isEdge(inside, width, height, x + N8[i][0], y + N8[i][1]) && !inside(x + N8[i][0], y + N8[i][1])) {
      dir = i;
      break;
    }
  }
  const limit = width * height;
  for (let n = 0; n < limit; n++) {
    pts.push({ x, y });
    visited.add(key(x, y));
    const begin = (dir + 5) % 8;
    let found = false;
    for (let k = 0; k < 8; k++) {
      const i = (begin + k) % 8;
      const nx = x + N8[i][0];
      const ny = y + N8[i][1];
      if (isEdge(inside, width, height, nx, ny)) {
        dir = i;
        x = nx;
        y = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (x === sx && y === sy && pts.length > 2) break;
  }
  return pts;
}

/** Ordered silhouette vertices: contour-trace each blob, then Douglas–Peucker so long
 *  straight edges collapse to their endpoints and corners/spikes stay. `spacing` is unused
 *  here (it still drives interior sampling); kept on the signature because meshFromMask
 *  and the existing tests pass it. */
export function boundaryPoints(
  inside: Inside,
  width: number,
  height: number,
  _spacing: number,
): Pt[] {
  const visited = new Set<number>();
  const kept: Pt[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited.has(key(x, y))) continue;
      if (!isEdge(inside, width, height, x, y)) continue;
      const contour = traceContour(inside, width, height, x, y, visited);
      const simple = simplifyClosed(contour, OUTLINE_EPS);
      if (simple.length >= 3) kept.push(...simple);
    }
  }
  return kept;
}

/** Interior grid samples (inside, at `spacing`), excluding any within ~spacing/2 of a boundary point. */
export function interiorPoints(
  inside: Inside,
  width: number,
  height: number,
  spacing: number,
  boundary: Pt[],
): Pt[] {
  const min = (spacing / 2) * (spacing / 2);
  const out: Pt[] = [];
  for (let y = spacing; y < height; y += spacing) {
    for (let x = spacing; x < width; x += spacing) {
      if (!inside(x, y)) continue;
      let tooClose = false;
      for (const b of boundary) {
        const dx = b.x - x,
          dy = b.y - y;
        if (dx * dx + dy * dy < min) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) out.push({ x, y });
    }
  }
  return out;
}

/** Triangulate the silhouette of a binary alpha mask into a conforming triangle mesh (pixel space). */
export function triangulateSilhouette(
  inside: Inside,
  width: number,
  height: number,
  opts: { spacing?: number } = {},
): Mesh {
  const spacing = Math.max(2, opts.spacing ?? 16);
  const boundary = boundaryPoints(inside, width, height, spacing);
  const interior = interiorPoints(inside, width, height, spacing, boundary);
  const pts = boundary.concat(interior);
  if (pts.length < 3) return { vertices: [], triangles: [] };

  const d = Delaunator.from(
    pts,
    (p) => p.x,
    (p) => p.y,
  );
  const tris: [number, number, number][] = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t],
      b = d.triangles[t + 1],
      c = d.triangles[t + 2];
    const cx = (pts[a].x + pts[b].x + pts[c].x) / 3;
    const cy = (pts[a].y + pts[b].y + pts[c].y) / 3;
    if (inside(Math.round(cx), Math.round(cy))) tris.push([a, b, c]);
  }

  // Reindex: keep only referenced vertices, compact.
  const remap = new Map<number, number>();
  const vertices: Pt[] = [];
  const triangles: [number, number, number][] = tris.map(([a, b, c]) => {
    const m = (i: number) => {
      let n = remap.get(i);
      if (n === undefined) {
        n = vertices.length;
        remap.set(i, n);
        vertices.push(pts[i]);
      }
      return n;
    };
    return [m(a), m(b), m(c)];
  });
  return { vertices, triangles };
}
