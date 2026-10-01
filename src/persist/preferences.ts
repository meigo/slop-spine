import type { Tool, StrokeSlot } from "../state/ui.svelte";
import type { CurvePoint } from "../core/pressure-curve";

export interface CurvePrefs {
  cp1: CurvePoint;
  cp2: CurvePoint;
}

/** Session tool/view prefs. Document pixels live in autosave, not here. */
export interface Preferences {
  tool: Tool;
  stroke: { brush: StrokeSlot; eraser: StrokeSlot };
  brushValue: string;
  drawBehind: boolean;
  taper: boolean;
  nibAngle: number;
  nibFlatness: number;
  dwellPool: number;
  dryness: number;
  dryTaper: number;
  fillValue: string;
  fillOpacity: number;
  fillTolerance: number;
  fillExpand: number;
  fillGap: number;
  showBones: boolean;
  showDrawings: boolean;
  showMeshes: boolean;
  whiteBg: boolean;
  dockWidth: number;
  inspectorHeight: number;
  curves: { brush: CurvePrefs; eraser: CurvePrefs };
}

/** Fields saved before brush and eraser had their own settings (2026-09-26). Still read, so an
 *  existing setup carries over; never written. */
export interface LegacyPreferences {
  brushType: string;
  brushSize: number;
  brushOpacity: number;
  brushPress: number;
  eraserPress: number;
  pressureCurve: CurvePrefs;
}

/** What a load can hand back: the current fields, and a pre-split save's old ones. */
export type StoredPreferences = Partial<Preferences> & Partial<LegacyPreferences>;

export const PREFS_KEY = "slop-spine:prefs";
/** Pre-unified store: only dock/inspector. Read on load if the new key has no panel fields. */
export const LEGACY_PANEL_KEY = "slop-spine:panels";

/** Pure parse: null/garbage → {}, a JSON object → its (partial) contents. */
export function parsePreferences(raw: string | null): StoredPreferences {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StoredPreferences) : {};
  } catch {
    return {};
  }
}

export function loadPreferences(): StoredPreferences {
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
