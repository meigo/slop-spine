import { describe, it, expect } from "vitest";
import {
  clampDockWidth,
  panelBesideToolOptions,
  TOOL_OPTIONS_WIDTH,
  MIN_DOCK_WIDTH,
  DEFAULT_DOCK_WIDTH,
  clampInspectorHeight,
  MIN_INSPECTOR_HEIGHT,
  DEFAULT_INSPECTOR_HEIGHT,
} from "../panel-layout";

describe("clampDockWidth", () => {
  it("returns a value within range unchanged", () => {
    expect(clampDockWidth(300, 1400)).toBe(300);
  });

  it("floors at MIN", () => {
    expect(clampDockWidth(50, 1400)).toBe(MIN_DOCK_WIDTH);
  });

  it("caps at 50% of the viewport", () => {
    expect(clampDockWidth(1200, 1400)).toBe(700);
  });

  it("keeps MIN even when 50% of a tiny viewport is below MIN", () => {
    expect(clampDockWidth(500, 200)).toBe(MIN_DOCK_WIDTH);
  });

  it("DEFAULT matches slop-paint's and slop-animator's panel", () => {
    expect(DEFAULT_DOCK_WIDTH).toBe(280);
    expect(clampDockWidth(DEFAULT_DOCK_WIDTH, 1400)).toBe(DEFAULT_DOCK_WIDTH);
  });
});

describe("clampInspectorHeight", () => {
  it("returns a value within range unchanged", () => {
    expect(clampInspectorHeight(180, 800)).toBe(180);
  });

  it("floors at MIN", () => {
    expect(clampInspectorHeight(10, 800)).toBe(MIN_INSPECTOR_HEIGHT);
  });

  it("caps at 60% of the column", () => {
    expect(clampInspectorHeight(900, 800)).toBe(480);
  });

  it("keeps MIN when 60% of a short column is below MIN", () => {
    expect(clampInspectorHeight(400, 100)).toBe(MIN_INSPECTOR_HEIGHT);
  });

  it("DEFAULT is within the sane range", () => {
    expect(DEFAULT_INSPECTOR_HEIGHT).toBeGreaterThanOrEqual(MIN_INSPECTOR_HEIGHT);
    expect(clampInspectorHeight(DEFAULT_INSPECTOR_HEIGHT, 800)).toBe(DEFAULT_INSPECTOR_HEIGHT);
  });
});

describe("panelBesideToolOptions", () => {
  it("puts the dock beside the options row when the row still fits", () => {
    expect(panelBesideToolOptions(1440, DEFAULT_DOCK_WIDTH)).toBe(true);
    expect(panelBesideToolOptions(TOOL_OPTIONS_WIDTH + 300, 300)).toBe(true);
  });
  it("starts the dock below the row when it would squeeze it (portrait iPad, 1024 or less)", () => {
    expect(panelBesideToolOptions(1024, DEFAULT_DOCK_WIDTH)).toBe(false);
    expect(panelBesideToolOptions(TOOL_OPTIONS_WIDTH + 299, 300)).toBe(false);
  });
});
