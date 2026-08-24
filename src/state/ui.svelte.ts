import { DEFAULT_DOCK_WIDTH, DEFAULT_INSPECTOR_HEIGHT } from "../core/panel-layout";

export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso" | "bone";
export type BrushType = "smooth" | "ink" | "pencil";
export type BoneMode = "edit" | "create" | "pose";

/** Keyboard → tool. `b` is brush (same as animator); bone is `r` because `b` is taken. */
export function toolFromKey(key: string): Tool | null {
  switch (key) {
    case "b":
      return "brush";
    case "e":
      return "eraser";
    case "g":
      return "fill";
    case "s":
      return "select";
    case "l":
      return "lasso";
    case "r":
      return "bone";
    default:
      return null;
  }
}

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
    case "select":
    case "lasso":
    case "bone":
      return false;
  }
}

export function isSelectTool(tool: Tool): boolean {
  switch (tool) {
    case "select":
    case "lasso":
      return true;
    case "brush":
    case "eraser":
    case "fill":
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
  /** Pen pressure multiplier (animator `sizeRange`): light → size/press, full → size*press. */
  brushPress: 3,
  eraserPress: 3,
  /** Fill tool. Same defaults as animator. */
  fillTolerance: 32,
  fillExpand: 2,
  fillGap: 0,
  /** Draw bones on canvas regardless of the active tool. Faint under a paint tool (see
   *  RigOverlay's flags), full opacity under the bone tool. The bone tool still draws bones
   *  when this is false — you cannot edit what you cannot see. */
  showBones: true,
  /** Draw layer pixels. Per-layer eyes still apply when this is on. */
  showDrawings: true,
  /** Opaque white page instead of the checkerboard. Editor only — export stays trimmed alpha. */
  whiteBg: false,
  /** Draw mesh wireframes. Independent of the tool. Default off. */
  showMeshes: false,
  /** Bone-tool sub-gesture. Shift still creates, Alt still poses; this is the iPad / no-key path. */
  boneMode: "edit" as BoneMode,
  /** Right dock width (px). Clamped on drag; default is the old `w-56`. */
  dockWidth: DEFAULT_DOCK_WIDTH,
  /** Inspector pane height (px) inside the dock. Layer list takes the rest. */
  inspectorHeight: DEFAULT_INSPECTOR_HEIGHT,
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
