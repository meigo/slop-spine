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
  /** Draw order, ascending = drawn first (behind). */
  order: number;
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
    density: 48,
  };
}

/** Bones a slot is influenced by: its own bone, that bone's parent, and its children. */
export function defaultBind(doc: RigDocument, slot: Slot): string[] {
  const own = slot.bone;
  const bone = doc.bones.find((b) => b.name === own);
  const parent = bone?.parent ? [bone.parent] : [];
  const kids = doc.bones.filter((b) => b.parent === own).map((b) => b.name);
  return [own, ...parent, ...kids].filter((n) => n !== "root");
}
