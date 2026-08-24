import { DEFAULT_DOCK_WIDTH, DEFAULT_INSPECTOR_HEIGHT } from "../core/panel-layout";
import { clampGap } from "../core/fill-holes";
import { pressureCurve, type CurvePoint } from "../core/pressure-curve";
import type { Preferences } from "../persist/preferences";

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

/** Why a layer-bound tool (paint / select) refuses. Bone does not consult this. */
export type LayerEditBlock = "no-layer" | "hidden";

export function whyNotEditable(
  layer: { visible: boolean } | null | undefined,
): LayerEditBlock | null {
  if (layer == null) return "no-layer";
  if (!layer.visible) return "hidden";
  return null;
}

export function editBlockLabel(block: LayerEditBlock): string {
  switch (block) {
    case "no-layer":
      return "Select a layer to edit";
    case "hidden":
      return "Layer hidden — show it to edit";
  }
}

/** Tools that write or lift pixels and therefore need an editable layer. Bone is excluded. */
export function needsEditableLayer(tool: Tool): boolean {
  switch (tool) {
    case "brush":
    case "eraser":
    case "fill":
    case "select":
    case "lasso":
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
  /** True while a plain marquee is up (not a lifted float). Transient view state, never persisted:
   *  gatherPreferences lists its fields explicitly. Set by Canvas from Selection.onStateChange so
   *  the toolbar's select-tool row can enable Copy/Cut/Delete/Deselect. */
  selectionActive: false,
  /** Bumped when the imperative pressure curve changes so the prefs $effect re-runs. */
  curveVersion: 0,
});

/** Signal that the (imperative) pressure curve changed, so the preferences save effect re-runs. */
export function bumpCurve() {
  ui.curveVersion++;
}

const TOOLS: readonly Tool[] = ["brush", "eraser", "fill", "select", "lasso", "bone"];
const BRUSH_TYPES: readonly BrushType[] = ["smooth", "ink", "pencil"];

function isTool(v: unknown): v is Tool {
  return TOOLS.includes(v as Tool);
}
function isBrushType(v: unknown): v is BrushType {
  return BRUSH_TYPES.includes(v as BrushType);
}
function intIn(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}
function pressIn(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(8, Math.max(1, Math.round(v * 2) / 2));
}
function finiteNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}
function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
function asPoint(v: unknown): CurvePoint | null {
  if (!v || typeof v !== "object") return null;
  const p = v as { x?: unknown; y?: unknown };
  if (typeof p.x !== "number" || typeof p.y !== "number") return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

/** Snapshot the persisted-preference fields from live state. */
export function gatherPreferences(): Preferences {
  void ui.curveVersion;
  return {
    tool: ui.tool,
    brushType: ui.brushType,
    brushSize: ui.brushSize,
    brushOpacity: ui.brushOpacity,
    brushValue: ui.brushValue,
    brushPress: ui.brushPress,
    eraserPress: ui.eraserPress,
    fillTolerance: ui.fillTolerance,
    fillExpand: ui.fillExpand,
    fillGap: ui.fillGap,
    showBones: ui.showBones,
    showDrawings: ui.showDrawings,
    showMeshes: ui.showMeshes,
    whiteBg: ui.whiteBg,
    dockWidth: ui.dockWidth,
    inspectorHeight: ui.inspectorHeight,
    pressureCurve: { cp1: { ...pressureCurve.cp1 }, cp2: { ...pressureCurve.cp2 } },
  };
}

/** Apply stored preferences over the current state, field-by-field with type guards. */
export function applyPreferences(p: Partial<Preferences>): void {
  if (isTool(p.tool)) ui.tool = p.tool;
  if (isBrushType(p.brushType)) ui.brushType = p.brushType;
  const size = intIn(p.brushSize, 1, 64);
  if (size !== null) ui.brushSize = size;
  const opacity = intIn(p.brushOpacity, 1, 100);
  if (opacity !== null) ui.brushOpacity = opacity;
  if (isHexColor(p.brushValue)) ui.brushValue = p.brushValue.toLowerCase();
  const bp = pressIn(p.brushPress);
  if (bp !== null) ui.brushPress = bp;
  const ep = pressIn(p.eraserPress);
  if (ep !== null) ui.eraserPress = ep;
  const tol = intIn(p.fillTolerance, 0, 128);
  if (tol !== null) ui.fillTolerance = tol;
  const expand = intIn(p.fillExpand, 0, 8);
  if (expand !== null) ui.fillExpand = expand;
  if (p.fillGap !== undefined) ui.fillGap = clampGap(p.fillGap);
  if (typeof p.showBones === "boolean") ui.showBones = p.showBones;
  if (typeof p.showDrawings === "boolean") ui.showDrawings = p.showDrawings;
  if (typeof p.showMeshes === "boolean") ui.showMeshes = p.showMeshes;
  if (typeof p.whiteBg === "boolean") ui.whiteBg = p.whiteBg;
  const dock = finiteNum(p.dockWidth);
  if (dock !== null) ui.dockWidth = dock;
  const inspector = finiteNum(p.inspectorHeight);
  if (inspector !== null) ui.inspectorHeight = inspector;
  if (p.pressureCurve && typeof p.pressureCurve === "object") {
    const cp1 = asPoint(p.pressureCurve.cp1);
    const cp2 = asPoint(p.pressureCurve.cp2);
    if (cp1) pressureCurve.cp1 = cp1;
    if (cp2) pressureCurve.cp2 = cp2;
    if (cp1 || cp2) pressureCurve.buildLUT();
  }
}

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
