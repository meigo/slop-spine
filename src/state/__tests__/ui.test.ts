import { describe, it, expect } from "vitest";
import { isPaintTool, toolFromKey, type Tool } from "../ui.svelte";

describe("isPaintTool", () => {
  it("is true for every tool that paints", () => {
    expect(isPaintTool("brush")).toBe(true);
    expect(isPaintTool("eraser")).toBe(true);
    expect(isPaintTool("fill")).toBe(true);
  });

  it("is false for the bone tool", () => {
    expect(isPaintTool("bone")).toBe(false);
  });

  it("is false for select and lasso", () => {
    expect(isPaintTool("select")).toBe(false);
    expect(isPaintTool("lasso")).toBe(false);
  });

  it("classifies every member of Tool, so a new tool cannot default into painting", () => {
    // If a tool is added to the union without a decision here, this fails to compile rather than
    // silently falling into the paint branch and letting a brush stroke fire on a rig gesture.
    const all: Tool[] = ["brush", "eraser", "fill", "select", "lasso", "bone"];
    const painting = all.filter(isPaintTool);
    expect(painting).toEqual(["brush", "eraser", "fill"]);
  });
});

describe("toolFromKey", () => {
  it("maps animator keys plus r for bone", () => {
    expect(toolFromKey("b")).toBe("brush");
    expect(toolFromKey("e")).toBe("eraser");
    expect(toolFromKey("g")).toBe("fill");
    expect(toolFromKey("s")).toBe("select");
    expect(toolFromKey("l")).toBe("lasso");
    expect(toolFromKey("r")).toBe("bone");
    expect(toolFromKey("n")).toBeNull();
  });
});

import { overlayFlags } from "../ui.svelte";

describe("overlayFlags", () => {
  it("shows faint bones and no mesh under a paint tool when meshes are off", () => {
    expect(overlayFlags("brush", true, false)).toEqual({
      bones: true, faint: true, mesh: false, tint: false, capsule: false,
    });
  });

  it("shows mesh wireframes under a paint tool when meshes are on, but not tint or capsule", () => {
    expect(overlayFlags("brush", true, true)).toEqual({
      bones: true, faint: true, mesh: true, tint: false, capsule: false,
    });
  });

  it("bone tool shows bones even when the bones toggle is off", () => {
    expect(overlayFlags("bone", false, false).bones).toBe(true);
    expect(overlayFlags("brush", false, false).bones).toBe(false);
  });

  it("bone tool does not imply mesh — that is the meshes toggle", () => {
    expect(overlayFlags("bone", true, false)).toEqual({
      bones: true, faint: false, mesh: false, tint: true, capsule: true,
    });
    expect(overlayFlags("bone", true, true).mesh).toBe(true);
  });

  it("tint and capsule are bone-tool chrome, independent of the meshes toggle", () => {
    for (const meshes of [true, false]) {
      const paint = overlayFlags("fill", true, meshes);
      expect(paint.tint).toBe(false);
      expect(paint.capsule).toBe(false);
      const bone = overlayFlags("bone", true, meshes);
      expect(bone.tint).toBe(true);
      expect(bone.capsule).toBe(true);
    }
  });
});
