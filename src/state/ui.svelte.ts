import { DEFAULT_DOCK_WIDTH, DEFAULT_INSPECTOR_HEIGHT } from "../core/panel-layout";
import { clampGap } from "../core/fill-holes";
import { PressureCurve, type CurvePoint } from "../core/pressure-curve";
import { clampPress, PRESS_DEFAULT } from "../core/brush";
import { MAX_NIB_FLATNESS } from "../core/calligraphy-brush";
import type { Preferences, LegacyPreferences, CurvePrefs } from "../persist/preferences";

export type Tool = "brush" | "eraser" | "fill" | "eyedropper" | "select" | "lasso" | "bone";
/** The seven brushes slop-paint offers, in its order. */
export type BrushType =
  "smooth" | "ink" | "calligraphy" | "dry" | "pencil" | "charcoal" | "airbrush";
export type BoneMode = "edit" | "create" | "pose";
export type SelectionState = "idle" | "selected" | "transforming" | "warping";

/** Stroke settings that brush and eraser each keep their own copy of (as slop-paint's
 *  tool-settings.ts). Colour, draw-behind and the per-brush options are the brush's alone. */
export interface StrokeSlot {
  brushType: BrushType;
  /** Nominal width in document px, 1–80 in 0.5 steps. */
  size: number;
  /** 1–100. */
  opacity: number;
  /** perfect-freehand outline smoothing, 0–100 (Smooth brush). */
  smoothing: number;
  /** Pointer-path smoothing, 0–100. */
  streamline: number;
  /** Pen pressure multiplier: light → size/press, full → size*press. */
  press: number;
}
export type SlotName = "brush" | "eraser";

/** The eraser has its own slot; every other tool draws with (or shows) the brush's. */
export function slotFor(tool: Tool): SlotName {
  return tool === "eraser" ? "eraser" : "brush";
}

export const SIZE_MIN = 1;
export const SIZE_MAX = 80;
export const SIZE_PRESETS = [1, 2, 3, 5, 8, 12, 20, 40, 80] as const;

function defaultSlot(size: number): StrokeSlot {
  return {
    brushType: "smooth",
    size,
    opacity: 100,
    smoothing: 50,
    streamline: 0,
    press: PRESS_DEFAULT,
  };
}

/** Keyboard → tool. `b` is brush (same as animator); bone is `r` because `b` is taken. */
export function toolFromKey(key: string): Tool | null {
  switch (key) {
    case "i":
      return "eyedropper";
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
    case "eyedropper":
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
    case "eyedropper":
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
    case "eyedropper":
    case "bone":
      return false;
  }
}

export const ui = $state({
  selectedLayerId: null as number | null,
  selectedBone: null as string | null,
  tool: "brush" as Tool,
  /** The brush's and the eraser's own settings; the toolbar edits `stroke[slotFor(tool)]`. */
  stroke: {
    brush: defaultSlot(12),
    eraser: defaultSlot(20),
  } as Record<SlotName, StrokeSlot>,
  brushValue: "#000000",
  /** Paint goes under what is already on the layer (flats under line art). Brush only. */
  drawBehind: false,
  /** Smooth brush: taper the stroke ends to a point instead of capping them. */
  taper: false,
  /** Calligraphy nib: angle in degrees and flatness (0 round … MAX_NIB_FLATNESS). */
  nibAngle: 45,
  nibFlatness: 0.35,
  /** Ink: 0–100, how much the mark swells where the pen lingers. */
  dwellPool: 0,
  /** Dry brush: 0–100, how short of paint the bristles are, and how long each hair tapers. */
  dryness: 50,
  dryTaper: 10,
  /** Fill's colour, independent of the brush's. Fills land BEHIND the strokes (fillRegionBehind),
   *  so the two tools are painting different things — outlines in one colour, flats in another —
   *  and sharing one swatch meant re-picking on every switch, or silently inking a line in the
   *  fill colour. Defaults to white because a fill behind black outlines is what this is for. */
  fillValue: "#ffffff",
  /** Fill's own opacity, as slop-paint (it used to share the brush's). */
  fillOpacity: 100,
  /** Fill tool. Same defaults as animator. */
  fillTolerance: 32,
  fillExpand: 2,
  fillGap: 0,
  /** Which colour the eyedropper replaces, and the tool it hands back to. Set by setTool. */
  eyedropperTarget: "brush" as "brush" | "fill",
  toolBeforeEyedropper: "brush" as Tool,
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
  /** Mirror of the canvas Selection, for the toolbar's select row. Transient view state, never
   *  persisted: gatherPreferences lists its fields explicitly. Set by Canvas from
   *  Selection.onStateChange / onChange. */
  selectionState: "idle" as SelectionState,
  warpRows: 2,
  warpCols: 2,
  deformMode: "ffd" as "ffd" | "rigid",
  /** Zoom readout for the toolbar, written by Canvas on every viewport change. */
  zoomText: "100%",
  /** Status bar: an explicit message (flashStatus) beats the hint for what the pointer is on. */
  statusMessage: "",
  statusHint: "",
  /** Bumped when an (imperative) pressure curve changes so the prefs $effect re-runs. */
  curveVersion: 0,
});

/** One curve per stroke tool: the eraser has its own so a tuned brush feel isn't shared. Not
 *  reactive — the curve editor is an imperative canvas widget; changes bump `ui.curveVersion`. */
export const pressureCurves: Record<SlotName, PressureCurve> = {
  brush: new PressureCurve(),
  eraser: new PressureCurve(),
};

/** Signal that a pressure curve changed, so the preferences save effect re-runs. */
export function bumpCurve() {
  ui.curveVersion++;
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** Say something in the status bar — use it when an action does nothing, so a no-op isn't silent.
 *  `ms = 0` keeps it until the next message. */
export function flashStatus(message: string, ms = 4000) {
  ui.statusMessage = message;
  clearTimeout(statusTimer);
  if (ms > 0) statusTimer = setTimeout(() => (ui.statusMessage = ""), ms);
}

/** Pick a tool. Arming the eyedropper remembers which colour it replaces (the fill's from the
 *  bucket, else the brush's) and the tool it returns to after a pick. */
export function setTool(tool: Tool) {
  if (tool === "eyedropper" && ui.tool !== "eyedropper") {
    ui.eyedropperTarget = ui.tool === "fill" ? "fill" : "brush";
    ui.toolBeforeEyedropper = ui.tool;
  }
  ui.tool = tool;
}

export const TOOL_LABELS: Record<Tool, string> = {
  brush: "Brush",
  eraser: "Eraser",
  fill: "Fill",
  eyedropper: "Eyedropper",
  select: "Rect select",
  lasso: "Lasso",
  bone: "Rig",
};

const TOOLS: readonly Tool[] = ["brush", "eraser", "fill", "eyedropper", "select", "lasso", "bone"];
const BRUSH_TYPES: readonly BrushType[] = [
  "smooth",
  "ink",
  "calligraphy",
  "dry",
  "pencil",
  "charcoal",
  "airbrush",
];

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
/** Size snaps to the slider's 0.5 step. */
function sizeIn(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(v * 2) / 2));
}
function pressIn(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return clampPress(v);
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

/** Field-by-field, keeping `into`'s value wherever the saved one is missing or malformed. */
function applySlot(into: StrokeSlot, raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Record<string, unknown>;
  if (isBrushType(r.brushType)) into.brushType = r.brushType;
  const size = sizeIn(r.size);
  if (size !== null) into.size = size;
  const opacity = intIn(r.opacity, 1, 100);
  if (opacity !== null) into.opacity = opacity;
  const smoothing = intIn(r.smoothing, 0, 100);
  if (smoothing !== null) into.smoothing = smoothing;
  const streamline = intIn(r.streamline, 0, 100);
  if (streamline !== null) into.streamline = streamline;
  const press = pressIn(r.press);
  if (press !== null) into.press = press;
}

function applyCurve(curve: PressureCurve, raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const r = raw as { cp1?: unknown; cp2?: unknown };
  const cp1 = asPoint(r.cp1);
  const cp2 = asPoint(r.cp2);
  if (cp1) curve.cp1 = cp1;
  if (cp2) curve.cp2 = cp2;
  if (cp1 || cp2) curve.buildLUT();
}

function curvePrefs(c: PressureCurve): CurvePrefs {
  return { cp1: { ...c.cp1 }, cp2: { ...c.cp2 } };
}

/** Snapshot the persisted-preference fields from live state. */
export function gatherPreferences(): Preferences {
  void ui.curveVersion;
  return {
    tool: ui.tool,
    stroke: { brush: { ...ui.stroke.brush }, eraser: { ...ui.stroke.eraser } },
    brushValue: ui.brushValue,
    drawBehind: ui.drawBehind,
    taper: ui.taper,
    nibAngle: ui.nibAngle,
    nibFlatness: ui.nibFlatness,
    dwellPool: ui.dwellPool,
    dryness: ui.dryness,
    dryTaper: ui.dryTaper,
    fillValue: ui.fillValue,
    fillOpacity: ui.fillOpacity,
    fillTolerance: ui.fillTolerance,
    fillExpand: ui.fillExpand,
    fillGap: ui.fillGap,
    showBones: ui.showBones,
    showDrawings: ui.showDrawings,
    showMeshes: ui.showMeshes,
    whiteBg: ui.whiteBg,
    dockWidth: ui.dockWidth,
    inspectorHeight: ui.inspectorHeight,
    curves: { brush: curvePrefs(pressureCurves.brush), eraser: curvePrefs(pressureCurves.eraser) },
  };
}

/** Apply stored preferences over the current state, field-by-field with type guards. Saves from
 *  before brush and eraser had their own settings are read too: their one brush type, size and
 *  opacity seed both slots, the old Press fields go to their own tool, the one curve to both. */
export function applyPreferences(p: Partial<Preferences> & Partial<LegacyPreferences>): void {
  // The eyedropper is transient: a reload lands on the tool it would have handed back to.
  if (isTool(p.tool)) ui.tool = p.tool === "eyedropper" ? "brush" : p.tool;

  const legacy = {
    brushType: p.brushType,
    size: p.brushSize,
    opacity: p.brushOpacity,
  };
  applySlot(ui.stroke.brush, { ...legacy, press: p.brushPress });
  applySlot(ui.stroke.eraser, { ...legacy, press: p.eraserPress });
  // Before the split, fill shared the brush's opacity.
  const legacyOpacity = intIn(p.brushOpacity, 1, 100);
  if (legacyOpacity !== null) ui.fillOpacity = legacyOpacity;
  if (p.pressureCurve) {
    applyCurve(pressureCurves.brush, p.pressureCurve);
    applyCurve(pressureCurves.eraser, p.pressureCurve);
  }

  if (p.stroke && typeof p.stroke === "object") {
    applySlot(ui.stroke.brush, p.stroke.brush);
    applySlot(ui.stroke.eraser, p.stroke.eraser);
  }
  if (p.curves && typeof p.curves === "object") {
    applyCurve(pressureCurves.brush, p.curves.brush);
    applyCurve(pressureCurves.eraser, p.curves.eraser);
  }

  if (isHexColor(p.brushValue)) ui.brushValue = p.brushValue.toLowerCase();
  if (isHexColor(p.fillValue)) ui.fillValue = p.fillValue.toLowerCase();
  if (typeof p.drawBehind === "boolean") ui.drawBehind = p.drawBehind;
  if (typeof p.taper === "boolean") ui.taper = p.taper;
  const angle = intIn(p.nibAngle, 0, 180);
  if (angle !== null) ui.nibAngle = angle;
  const flat = finiteNum(p.nibFlatness);
  if (flat !== null) ui.nibFlatness = Math.min(MAX_NIB_FLATNESS, Math.max(0, flat));
  const pool = intIn(p.dwellPool, 0, 100);
  if (pool !== null) ui.dwellPool = pool;
  const dryness = intIn(p.dryness, 0, 100);
  if (dryness !== null) ui.dryness = dryness;
  const dryTaper = intIn(p.dryTaper, 0, 100);
  if (dryTaper !== null) ui.dryTaper = dryTaper;
  const fillOpacity = intIn(p.fillOpacity, 1, 100);
  if (fillOpacity !== null) ui.fillOpacity = fillOpacity;
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
}

export interface OverlayFlags {
  bones: boolean;
  /** Draw bones at reduced alpha — a reference while painting, not the thing being edited. */
  faint: boolean;
  mesh: boolean;
  tint: boolean;
  capsule: boolean;
}

/** What the rig overlay draws, given the active tool and the visibility toggles. Pure.
 *  `posing`: a pose drag (or its wobble settling) is live. The weight tint and the reach capsule
 *  (with its handle) are drawn at REST — the mesh's rest vertices, the bone's rest span — so while
 *  the art deforms they would sit where the drawing no longer is, and hide the pose you are
 *  judging. Both come back when the pose ends. */
export function overlayFlags(
  tool: Tool,
  showBones: boolean,
  showMeshes = false,
  posing = false,
): OverlayFlags {
  const rigging = tool === "bone";
  return {
    bones: rigging || showBones,
    faint: !rigging,
    mesh: showMeshes,
    tint: rigging && !posing,
    capsule: rigging && !posing,
  };
}
