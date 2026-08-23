export type Tool = "brush" | "eraser" | "fill" | "bone";
export type BrushType = "smooth" | "ink" | "pencil";

/** Tools that lay down pixels. The rig gestures are the complement, so a gesture can never be
 *  claimed by both halves of the canvas dispatch. Written as an explicit switch rather than an
 *  array membership test so adding a member to `Tool` is a compile error here, not a silent
 *  fall-through into painting. */
export function isPaintTool(tool: Tool): boolean {
  switch (tool) {
    case "brush":
    case "eraser":
    case "fill":
      return true;
    case "bone":
      return false;
  }
}

export const ui = $state({
  selectedLayerId: null as number | null,
  selectedBone: null as string | null,
  tool: "brush" as Tool,
  brushType: "smooth" as BrushType,
  brushSize: 12,
  brushOpacity: 100,
  brushValue: "#000000",
  /** Draw bones on canvas regardless of the active tool. Faint under a paint tool (see
   *  RigOverlay's flags), full opacity under the bone tool. The bone tool still draws bones
   *  when this is false — you cannot edit what you cannot see. */
  showBones: true,
  /** Draw layer pixels. Per-layer eyes still apply when this is on. */
  showDrawings: true,
  /** Draw mesh wireframes. Independent of the tool. Default off. */
  showMeshes: false,
});

export interface OverlayFlags {
  bones: boolean;
  /** Draw bones at reduced alpha — a reference while painting, not the thing being edited. */
  faint: boolean;
  mesh: boolean;
  tint: boolean;
  capsule: boolean;
}

/** What the rig overlay draws, given the active tool and the visibility toggles. Pure. */
export function overlayFlags(tool: Tool, showBones: boolean, showMeshes = false): OverlayFlags {
  const rigging = tool === "bone";
  return {
    bones: rigging || showBones,
    faint: !rigging,
    mesh: showMeshes,
    tint: rigging,
    capsule: rigging,
  };
}
