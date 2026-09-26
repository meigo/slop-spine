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
  pressureCurves,
  slotFor,
  setTool,
} from "../ui.svelte";

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
    const all: Tool[] = ["brush", "eraser", "fill", "eyedropper", "select", "lasso", "bone"];
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

function resetSlot(size: number) {
  return {
    brushType: "smooth" as const,
    size,
    opacity: 100,
    smoothing: 50,
    streamline: 0,
    press: 3,
  };
}

describe("applyPreferences / gatherPreferences", () => {
  afterEach(() => {
    ui.tool = "brush";
    ui.stroke.brush = resetSlot(12);
    ui.stroke.eraser = resetSlot(20);
    ui.brushValue = "#000000";
    ui.fillValue = "#ffffff";
    ui.fillOpacity = 100;
    ui.whiteBg = false;
    pressureCurves.brush.reset();
    pressureCurves.eraser.reset();
    ui.curveVersion = 0;
    ui.selectedLayerId = null;
    ui.selectedBone = null;
    ui.boneMode = "edit";
  });

  it("applies known tool and brush fields and ignores junk", () => {
    applyPreferences({
      tool: "fill",
      stroke: { brush: { ...resetSlot(40), brushType: "calligraphy" }, eraser: resetSlot(6) },
      brushValue: "#AABBCC",
      whiteBg: true,
    } as never);
    expect(ui.tool).toBe("fill");
    expect(ui.stroke.brush.size).toBe(40);
    expect(ui.stroke.brush.brushType).toBe("calligraphy");
    expect(ui.stroke.eraser.size).toBe(6);
    expect(ui.brushValue).toBe("#aabbcc");
    expect(ui.whiteBg).toBe(true);
    applyPreferences({
      tool: "not-a-tool",
      stroke: { brush: { size: 999, brushType: "crayon" } },
      brushValue: "red",
    } as never);
    expect(ui.tool).toBe("fill");
    expect(ui.stroke.brush.size).toBe(80);
    expect(ui.stroke.brush.brushType).toBe("calligraphy");
    expect(ui.brushValue).toBe("#aabbcc");
  });

  it("snaps size to the slider's 0.5 step", () => {
    applyPreferences({ stroke: { brush: { size: 2.3 } } } as never);
    expect(ui.stroke.brush.size).toBe(2.5);
  });

  it("never restores the transient eyedropper", () => {
    applyPreferences({ tool: "eyedropper" });
    expect(ui.tool).toBe("brush");
  });

  it("migrates a save from before brush and eraser had their own settings", () => {
    applyPreferences({
      tool: "brush",
      brushType: "ink",
      brushSize: 20,
      brushOpacity: 70,
      brushPress: 4,
      eraserPress: 2,
      pressureCurve: { cp1: { x: 0.1, y: 0.9 }, cp2: { x: 0.8, y: 0.2 } },
    });
    expect(ui.stroke.brush).toMatchObject({ brushType: "ink", size: 20, opacity: 70, press: 4 });
    expect(ui.stroke.eraser).toMatchObject({ brushType: "ink", size: 20, opacity: 70, press: 2 });
    // Fill shared the brush's opacity then.
    expect(ui.fillOpacity).toBe(70);
    expect(pressureCurves.brush.cp1).toEqual({ x: 0.1, y: 0.9 });
    expect(pressureCurves.eraser.cp1).toEqual({ x: 0.1, y: 0.9 });
  });

  it("keeps the fill colour independent of the brush colour", () => {
    applyPreferences({ brushValue: "#112233", fillValue: "#445566" } as never);
    expect(ui.brushValue).toBe("#112233");
    expect(ui.fillValue).toBe("#445566");
    // Outlines in black, flats in white: changing one must never move the other.
    applyPreferences({ brushValue: "#000000" } as never);
    expect(ui.fillValue).toBe("#445566");
    expect(gatherPreferences().fillValue).toBe("#445566");
  });

  it("rejects a malformed fill colour and keeps the previous one", () => {
    applyPreferences({ fillValue: "#abcdef" } as never);
    applyPreferences({ fillValue: "white" } as never);
    expect(ui.fillValue).toBe("#abcdef");
  });

  it("applies each tool's own pressure curve and rebuilds its lut", () => {
    applyPreferences({
      curves: {
        brush: { cp1: { x: 0.1, y: 0.9 }, cp2: { x: 0.8, y: 0.2 } },
        eraser: { cp1: { x: 0.3, y: 0.3 }, cp2: { x: 0.6, y: 0.6 } },
      },
    });
    expect(pressureCurves.brush.cp1).toEqual({ x: 0.1, y: 0.9 });
    expect(pressureCurves.brush.evaluate(0.5)).not.toBeCloseTo(0.5, 2);
    expect(pressureCurves.eraser.cp1).toEqual({ x: 0.3, y: 0.3 });
  });

  it("gather includes both curves and bumps when bumpCurve runs", () => {
    applyPreferences({
      stroke: { brush: resetSlot(8), eraser: resetSlot(30) },
      curves: {
        brush: { cp1: { x: 0.2, y: 0.3 }, cp2: { x: 0.7, y: 0.6 } },
        eraser: { cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } },
      },
    });
    const before = ui.curveVersion;
    bumpCurve();
    expect(ui.curveVersion).toBe(before + 1);
    const g = gatherPreferences();
    expect(g.stroke.brush.size).toBe(8);
    expect(g.stroke.eraser.size).toBe(30);
    expect(g.curves.brush.cp1).toEqual({ x: 0.2, y: 0.3 });
    expect("selectedLayerId" in g).toBe(false);
    expect("selectedBone" in g).toBe(false);
    expect("selectionState" in g).toBe(false);
  });
});

describe("slotFor", () => {
  it("gives the eraser its own slot and every other tool the brush's", () => {
    expect(slotFor("eraser")).toBe("eraser");
    for (const t of ["brush", "fill", "eyedropper", "select", "lasso", "bone"] as Tool[]) {
      expect(slotFor(t)).toBe("brush");
    }
  });
});

describe("setTool", () => {
  afterEach(() => {
    ui.tool = "brush";
  });
  it("arms the eyedropper for the fill colour from the bucket, and remembers the tool", () => {
    ui.tool = "fill";
    setTool("eyedropper");
    expect(ui.tool).toBe("eyedropper");
    expect(ui.eyedropperTarget).toBe("fill");
    expect(ui.toolBeforeEyedropper).toBe("fill");
  });
  it("targets the brush colour from any other tool, and a second press keeps the first memory", () => {
    ui.tool = "eraser";
    setTool("eyedropper");
    setTool("eyedropper");
    expect(ui.eyedropperTarget).toBe("brush");
    expect(ui.toolBeforeEyedropper).toBe("eraser");
  });
});
