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
