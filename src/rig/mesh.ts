import { boundaryPoints, interiorPoints, type Mesh, type Pt } from "../core/triangulate";
import Delaunator from "delaunator";

export interface Mask {
  width: number;
  height: number;
  at(x: number, y: number): boolean;
}

export interface RigMesh extends Mesh {
  /** Count of leading vertices that lie on the silhouette. */
  hull: number;
}

/** Silhouette → triangulated mesh. Hull (boundary) vertices first, as Spine requires.
 *  Pure: same mask + density always gives the same mesh.
 *
 *  This duplicates `triangulateSilhouette` from core/ on purpose: that one REINDEXES and compacts
 *  vertices at the end, which destroys the boundary-first ordering Spine's `hull` depends on. Do
 *  not "simplify" this back to a call into core/. Unreferenced vertices are kept rather than
 *  compacted, for the same reason; a few unused entries are harmless. */
export function meshFromMask(mask: Mask, density: number): RigMesh {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.at(x, y);

  // density still spaces the interior grid; the hull is a simplified contour (corners and
  // spikes kept, long edges collapsed) so a coarse slider does not facet the silhouette.
  const hullPts = boundaryPoints(inside, mask.width, mask.height, density);
  const innerPts = interiorPoints(inside, mask.width, mask.height, density, hullPts);
  const vertices: Pt[] = [...hullPts, ...innerPts];
  if (vertices.length < 3) return { vertices: [], triangles: [], hull: 0 };

  const d = Delaunator.from(
    vertices,
    (p) => p.x,
    (p) => p.y,
  );
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < d.triangles.length; i += 3) {
    const [a, b, c] = [d.triangles[i], d.triangles[i + 1], d.triangles[i + 2]];
    // Drop triangles whose centroid falls outside — Delaunay fills concavities.
    const cx = (vertices[a].x + vertices[b].x + vertices[c].x) / 3;
    const cy = (vertices[a].y + vertices[b].y + vertices[c].y) / 3;
    if (inside(Math.round(cx), Math.round(cy))) triangles.push([a, b, c]);
  }
  return { vertices, triangles, hull: hullPts.length };
}

/** Build a Mask from a layer canvas: opaque enough counts as inside. */
export function maskFromCanvas(canvas: HTMLCanvasElement, alphaThreshold = 8): Mask {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  return {
    width,
    height,
    at: (x, y) => data[(y * width + x) * 4 + 3] > alphaThreshold,
  };
}
