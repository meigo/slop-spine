import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parsePreferences,
  loadPreferences,
  savePreferences,
  LEGACY_PANEL_KEY,
} from "../preferences";
import type { Preferences } from "../preferences";

const mem = new Map<string, string>();
const fakeStorage: Storage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => {
    mem.set(k, String(v));
  },
  removeItem: (k) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

describe("parsePreferences", () => {
  it("null → {}", () => {
    expect(parsePreferences(null)).toEqual({});
  });
  it("invalid JSON → {}", () => {
    expect(parsePreferences("not json")).toEqual({});
  });
  it("a JSON object → its contents", () => {
    expect(parsePreferences('{"brushSize":24,"whiteBg":true}')).toEqual({
      brushSize: 24,
      whiteBg: true,
    });
  });
  it("valid JSON that isn't an object → {}", () => {
    expect(parsePreferences("5")).toEqual({});
  });
  it("a JSON array → {}", () => {
    expect(parsePreferences("[1,2]")).toEqual({});
  });
});

const sample: Preferences = {
  tool: "eraser",
  stroke: {
    brush: { brushType: "ink", size: 20, opacity: 80, smoothing: 40, streamline: 10, press: 4 },
    eraser: { brushType: "smooth", size: 30, opacity: 100, smoothing: 50, streamline: 0, press: 2 },
  },
  brushValue: "#ff00aa",
  drawBehind: true,
  taper: true,
  nibAngle: 30,
  nibFlatness: 0.5,
  dwellPool: 20,
  fillValue: "#00ff88",
  fillOpacity: 90,
  fillTolerance: 16,
  fillExpand: 1,
  fillGap: 3,
  showBones: false,
  showDrawings: true,
  showMeshes: true,
  whiteBg: true,
  dockWidth: 260,
  inspectorHeight: 180,
  curves: {
    brush: { cp1: { x: 0.1, y: 0.2 }, cp2: { x: 0.8, y: 0.9 } },
    eraser: { cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } },
  },
};

describe("loadPreferences / savePreferences", () => {
  beforeEach(() => {
    mem.clear();
    Object.defineProperty(globalThis, "localStorage", { value: fakeStorage, configurable: true });
  });
  afterEach(() => {
    mem.clear();
  });

  it("round-trips a full prefs object", () => {
    savePreferences(sample);
    expect(loadPreferences()).toEqual(sample);
  });

  it("fills dock size from the old panels key when the unified object has none", () => {
    localStorage.setItem(
      LEGACY_PANEL_KEY,
      JSON.stringify({ dockWidth: 300, inspectorHeight: 150 }),
    );
    expect(loadPreferences()).toEqual({ dockWidth: 300, inspectorHeight: 150 });
  });

  it("does not let the old panels key override a unified save", () => {
    savePreferences(sample);
    localStorage.setItem(LEGACY_PANEL_KEY, JSON.stringify({ dockWidth: 1, inspectorHeight: 1 }));
    expect(loadPreferences().dockWidth).toBe(260);
    expect(loadPreferences().inspectorHeight).toBe(180);
  });
});
