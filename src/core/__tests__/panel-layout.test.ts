import { describe, it, expect } from "vitest";
import {
  clampDockWidth,
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

  it("DEFAULT matches the old fixed w-56", () => {
    expect(DEFAULT_DOCK_WIDTH).toBe(224);
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
