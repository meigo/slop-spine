import { describe, it, expect } from "vitest";
import { flattenPsdLayers, psdBaseName, type PsdNode } from "../psd";

function leaf(name: string, extra: Partial<PsdNode> = {}): PsdNode {
  return { name, canvas: {} as HTMLCanvasElement, ...extra };
}

describe("psdBaseName", () => {
  it("strips Spine tag prefixes", () => {
    expect(psdBaseName("[mesh]head")).toBe("head");
    expect(psdBaseName("[slot][mesh]arm")).toBe("arm");
    expect(psdBaseName("body")).toBe("body");
  });
});

describe("flattenPsdLayers", () => {
  it("walks groups in order and skips folders themselves", () => {
    const tree: PsdNode[] = [
      leaf("bottom"),
      { name: "group", children: [leaf("mid"), leaf("top")] },
    ];
    expect(flattenPsdLayers(tree).map((l) => l.name)).toEqual(["bottom", "mid", "top"]);
  });

  it("drops [ignore] nodes and their children", () => {
    const tree: PsdNode[] = [
      leaf("keep"),
      { name: "[ignore]guides", children: [leaf("guide")] },
      leaf("[ignore]overlay"),
    ];
    expect(flattenPsdLayers(tree).map((l) => l.name)).toEqual(["keep"]);
  });

  it("skips adjustment-style leaves with no canvas", () => {
    expect(flattenPsdLayers([{ name: "curves" }])).toEqual([]);
  });

  it("copies visibility and opacity", () => {
    const [a] = flattenPsdLayers([leaf("x", { hidden: true, opacity: 0.5, left: 10, top: 20 })]);
    expect(a.visible).toBe(false);
    expect(a.opacity).toBe(0.5);
    expect(a.left).toBe(10);
    expect(a.top).toBe(20);
  });
});
