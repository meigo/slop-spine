import type { Tool, BrushType } from "../state/ui.svelte";
import type { CurvePoint } from "../core/pressure-curve";

/** Session tool/view prefs. Document pixels live in autosave, not here. */
export interface Preferences {
  tool: Tool;
  brushType: BrushType;
  brushSize: number;
  brushOpacity: number;
  brushValue: string;
  fillValue: string;
  brushPress: number;
  eraserPress: number;
  fillTolerance: number;
  fillExpand: number;
  fillGap: number;
  showBones: boolean;
  showDrawings: boolean;
  showMeshes: boolean;
  whiteBg: boolean;
  dockWidth: number;
  inspectorHeight: number;
  pressureCurve: { cp1: CurvePoint; cp2: CurvePoint };
}

export const PREFS_KEY = "slop-spine:prefs";
/** Pre-unified store: only dock/inspector. Read on load if the new key has no panel fields. */
export const LEGACY_PANEL_KEY = "slop-spine:panels";

/** Pure parse: null/garbage → {}, a JSON object → its (partial) contents. */
export function parsePreferences(raw: string | null): Partial<Preferences> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<Preferences>) : {};
  } catch {
    return {};
  }
}

export function loadPreferences(): Partial<Preferences> {
  try {
    const p = parsePreferences(localStorage.getItem(PREFS_KEY));
    if (typeof p.dockWidth !== "number" || typeof p.inspectorHeight !== "number") {
      const legacy = parsePreferences(localStorage.getItem(LEGACY_PANEL_KEY));
      if (typeof p.dockWidth !== "number" && typeof legacy.dockWidth === "number") {
        p.dockWidth = legacy.dockWidth;
      }
      if (typeof p.inspectorHeight !== "number" && typeof legacy.inspectorHeight === "number") {
        p.inspectorHeight = legacy.inspectorHeight;
      }
    }
    return p;
  } catch {
    return {};
  }
}

export function savePreferences(p: Preferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode */
  }
}
