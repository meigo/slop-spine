export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  /** Full-canvas RGBA. Trimmed only at export. */
  canvas: HTMLCanvasElement;
  /** Bumped on every stroke. Task 10's derivation cache keys on it. */
  revision: number;
}

export interface Slot {
  /** Spine slot name; also the attachment name. Unique. */
  name: string;
  layerId: number;
  /** Bone this slot hangs from. */
  bone: string;
  /** No longer read anywhere — the Spine writer sorts slots by the slot's layer's index in
   *  doc.layers instead, since that's the one array a layer reorder actually mutates. Kept on
   *  the type rather than removed (a later cleanup); don't trust it for draw order. */
  order: number;
  /** Boundary point spacing in pixels, overriding doc.density for this slot only. Absent means
   *  "inherit the document default" — see rig/derive.ts's effective-density lookup. */
  density?: number;
}

export interface Bone {
  name: string;
  parent: string | null;
  /** Canvas pixels, y-down, relative to canvas top-left. Converted at export. */
  x: number;
  y: number;
  /** Degrees, screen-space CCW-positive. Converted at export. */
  rotation: number;
  length: number;
  /** 0 = rigid, 1 = full physics wobble. */
  wobble: number;
  /** When true, wobble also springs translation (Spine `x`/`y` mix). Default / omitted is
   *  rotation only (`rotate: 1`), which existing project files already match. */
  wobbleMove?: boolean;
  /** Canvas px; hard cutoff on this bone's influence in computeWeights. `undefined` means
   *  unlimited, so existing project files (saved before this field existed) load unchanged.
   *  `0` also means unlimited — it falls through the `reach > 0` guard, matching poseWeights'
   *  own semantics — so a UI control (Task 3) must clamp above zero, not allow it, or a slider
   *  bottomed out at 0 would silently mean "no cutoff" instead of "no influence." */
  reach?: number;
}

export interface Bind {
  slot: string;
  bones: string[];
}

export interface RigDocument {
  canvas: { width: number; height: number };
  layers: Layer[];
  slots: Slot[];
  bones: Bone[];
  binds: Bind[];
  /** Boundary point spacing in pixels. One global value. */
  density: number;
}

export function emptyDocument(width = 2048, height = 2048): RigDocument {
  return {
    canvas: { width, height },
    layers: [],
    slots: [],
    bones: [{ name: "root", parent: null, x: width / 2, y: height / 2, rotation: 0, length: 0, wobble: 0 }],
    binds: [],
    density: 24,
  };
}
