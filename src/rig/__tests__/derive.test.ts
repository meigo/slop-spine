import { describe, it, expect } from "vitest";
import { bindNamesFor, bindListAfterToggle } from "../derive";
import type { RigDocument, Bone } from "../document";

const bone = (name: string, parent: string | null): Bone => ({
  name,
  parent,
  x: 0,
  y: 0,
  rotation: 0,
  length: 100,
  wobble: 0,
});

function docWithBinds(binds: RigDocument["binds"]): RigDocument {
  return {
    canvas: { width: 100, height: 100 },
    layers: [],
    slots: [],
    bones: [bone("root", null), bone("a", "root"), bone("b", "root")],
    binds,
    density: 24,
  };
}

describe("bindNamesFor", () => {
  it("falls back to every non-root bone when the slot has no bind entry at all", () => {
    const doc = docWithBinds([]);
    expect(bindNamesFor(doc, "s1")).toEqual(["a", "b"]);
  });

  it("falls back to every non-root bone when the stored bind list is empty", () => {
    const doc = docWithBinds([{ slot: "s1", bones: [] }]);
    expect(bindNamesFor(doc, "s1")).toEqual(["a", "b"]);
  });

  it("returns a non-empty stored bind list as-is, without expanding it", () => {
    const doc = docWithBinds([{ slot: "s1", bones: ["a"] }]);
    expect(bindNamesFor(doc, "s1")).toEqual(["a"]);
  });
});

describe("bindListAfterToggle", () => {
  const all = ["a", "b", "c"];

  it("empty stored list means every bone is included, so unchecking one writes the rest", () => {
    expect(bindListAfterToggle([], all, "b", false)).toEqual(["a", "c"]);
    expect(bindListAfterToggle(undefined, all, "b", false)).toEqual(["a", "c"]);
  });

  it("checking the last excluded bone returns [] (unrestricted again)", () => {
    expect(bindListAfterToggle(["a", "c"], all, "b", true)).toEqual([]);
  });

  it("refuses to uncheck the last included bone — empty storage means all, not none", () => {
    expect(bindListAfterToggle(["a"], all, "a", false)).toEqual(["a"]);
  });
});
