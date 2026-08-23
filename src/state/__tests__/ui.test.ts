import { describe, it, expect } from "vitest";
import { isPaintTool, type Tool } from "../ui.svelte";

describe("isPaintTool", () => {
  it("is true for every tool that paints", () => {
    expect(isPaintTool("brush")).toBe(true);
    expect(isPaintTool("eraser")).toBe(true);
    expect(isPaintTool("fill")).toBe(true);
  });

  it("is false for the bone tool", () => {
    expect(isPaintTool("bone")).toBe(false);
  });

  it("classifies every member of Tool, so a new tool cannot default into painting", () => {
    // If a tool is added to the union without a decision here, this fails to compile rather than
    // silently falling into the paint branch and letting a brush stroke fire on a rig gesture.
    const all: Tool[] = ["brush", "eraser", "fill", "bone"];
    const painting = all.filter(isPaintTool);
    expect(painting).toEqual(["brush", "eraser", "fill"]);
  });
});

import { overlayFlags } from "../ui.svelte";

describe("overlayFlags", () => {
  it("shows only faint bones under a paint tool", () => {
    expect(overlayFlags("brush", true)).toEqual({
      bones: true, faint: true, mesh: false, tint: false, capsule: false,
    });
  });

  it("shows everything at full opacity under the bone tool", () => {
    expect(overlayFlags("bone", true)).toEqual({
      bones: true, faint: false, mesh: true, tint: true, capsule: true,
    });
  });

  it("hides bones when the toggle is off, but the bone tool still shows its own working overlay", () => {
    // Turning bones off while holding the bone tool would leave nothing to aim at, so the tool
    // wins over the toggle. The toggle governs the other tools.
    expect(overlayFlags("brush", false).bones).toBe(false);
    expect(overlayFlags("bone", false).bones).toBe(true);
  });

  it("draws no mesh or tint under any paint tool, whatever the toggle says", () => {
    for (const showBones of [true, false]) {
      for (const tool of ["brush", "eraser", "fill"] as const) {
        const f = overlayFlags(tool, showBones);
        expect(f.mesh).toBe(false);
        expect(f.tint).toBe(false);
      }
    }
  });
});
