import { describe, it, expect, afterEach } from "vitest";
import {
  isPaintTool,
  toolFromKey,
  type Tool,
  ui,
  applyPreferences,
  gatherPreferences,
  bumpCurve,
  whyNotEditable,
  editBlockLabel,
  needsEditableLayer,
} from "../ui.svelte";
import { pressureCurve } from "../../core/pressure-curve";

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

describe("whyNotEditable", () => {
  it("names no-layer when nothing is selected", () => {
    expect(whyNotEditable(null)).toBe("no-layer");
    expect(whyNotEditable(undefined)).toBe("no-layer");
  });
  it("names hidden before allowing edits", () => {
    expect(whyNotEditable({ visible: false })).toBe("hidden");
    expect(whyNotEditable({ visible: true })).toBeNull();
  });
});

describe("editBlockLabel", () => {
  it("tells the user how to unblock", () => {
    expect(editBlockLabel("no-layer")).toBe("Select a layer to edit");
    expect(editBlockLabel("hidden")).toBe("Layer hidden — show it to edit");
  });
});

describe("needsEditableLayer", () => {
  it("is true for paint and select, false for bone", () => {
    expect(needsEditableLayer("brush")).toBe(true);
    expect(needsEditableLayer("select")).toBe(true);
    expect(needsEditableLayer("bone")).toBe(false);
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
      bones: true,
      faint: true,
      mesh: false,
      tint: false,
      capsule: false,
    });
  });

  it("shows mesh wireframes under a paint tool when meshes are on, but not tint or capsule", () => {
    expect(overlayFlags("brush", true, true)).toEqual({
      bones: true,
      faint: true,
      mesh: true,
      tint: false,
      capsule: false,
    });
  });

  it("bone tool shows bones even when the bones toggle is off", () => {
    expect(overlayFlags("bone", false, false).bones).toBe(true);
    expect(overlayFlags("brush", false, false).bones).toBe(false);
  });

  it("bone tool does not imply mesh — that is the meshes toggle", () => {
    expect(overlayFlags("bone", true, false)).toEqual({
      bones: true,
      faint: false,
      mesh: false,
      tint: true,
      capsule: true,
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

describe("applyPreferences / gatherPreferences", () => {
  afterEach(() => {
    applyPreferences({
      tool: "brush",
      brushType: "smooth",
      brushSize: 12,
      brushOpacity: 100,
      brushValue: "#000000",
      brushPress: 3,
      eraserPress: 3,
      fillTolerance: 32,
      fillExpand: 2,
      fillGap: 0,
      showBones: true,
      showDrawings: true,
      showMeshes: false,
      whiteBg: false,
      dockWidth: 224,
      inspectorHeight: 200,
      pressureCurve: { cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } },
    });
    pressureCurve.reset();
    ui.curveVersion = 0;
    ui.selectedLayerId = null;
    ui.selectedBone = null;
    ui.boneMode = "edit";
  });

  it("applies known tool and brush fields and ignores junk", () => {
    applyPreferences({
      tool: "fill",
      brushSize: 40,
      brushValue: "#AABBCC",
      whiteBg: true,
    } as never);
    expect(ui.tool).toBe("fill");
    expect(ui.brushSize).toBe(40);
    expect(ui.brushValue).toBe("#aabbcc");
    expect(ui.whiteBg).toBe(true);
    applyPreferences({ tool: "not-a-tool", brushSize: 999, brushValue: "red" } as never);
    expect(ui.tool).toBe("fill");
    expect(ui.brushSize).toBe(64);
    expect(ui.brushValue).toBe("#aabbcc");
  });

  it("applies pressure-curve control points and rebuilds the lut", () => {
    applyPreferences({
      pressureCurve: { cp1: { x: 0.1, y: 0.9 }, cp2: { x: 0.8, y: 0.2 } },
    });
    expect(pressureCurve.cp1).toEqual({ x: 0.1, y: 0.9 });
    expect(pressureCurve.cp2).toEqual({ x: 0.8, y: 0.2 });
    expect(pressureCurve.evaluate(0.5)).not.toBeCloseTo(0.5, 2);
  });

  it("gather includes the curve and bumps when bumpCurve runs", () => {
    applyPreferences({
      brushSize: 8,
      pressureCurve: { cp1: { x: 0.2, y: 0.3 }, cp2: { x: 0.7, y: 0.6 } },
    });
    const before = ui.curveVersion;
    bumpCurve();
    expect(ui.curveVersion).toBe(before + 1);
    const g = gatherPreferences();
    expect(g.brushSize).toBe(8);
    expect(g.pressureCurve.cp1).toEqual({ x: 0.2, y: 0.3 });
    expect("selectedLayerId" in g).toBe(false);
    expect("selectedBone" in g).toBe(false);
  });
});
