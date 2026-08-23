import { describe, it, expect } from "vitest";
import {
  snapshotRig,
  applyRig,
  pushRigCommand,
  addBone,
  moveBone,
  setBoneLength,
  setBoneRotation,
  insertJoint,
  setSlotBone,
  reorderLayer,
  duplicateLayer,
  document,
} from "../doc.svelte";
import { history } from "../history.svelte";
import { ui } from "../ui.svelte";
import type { Layer } from "../../rig/document";

// Regression for C1: setBoneLength used to seed bone.reach from whatever length it was first
// called with. Since it runs on every pointermove of the creation drag, that locked reach to the
// first pixel or two of hand motion instead of the drag's final length. Seeding now happens once,
// at drag end, in Canvas.svelte — setBoneLength must go back to touching only length.
describe("setBoneLength", () => {
  it("never sets reach, no matter how many times it's called or in what order", () => {
    const name = addBone("root", 0, 0)!;
    setBoneLength(name, 3); // the ~first-pixel-of-drag call that used to lock reach at 3
    setBoneLength(name, 300); // the drag's actual final length
    const bone = document.bones.find((b) => b.name === name)!;
    expect(bone.length).toBe(300);
    expect(bone.reach).toBeUndefined();
  });
});

describe("snapshotRig", () => {
  it("round-trips bones binds and slots, and undo restores a move", () => {
    const start = snapshotRig();
    const name = addBone("root", 10, 20)!;
    moveBone(name, 50, 60);
    const mid = snapshotRig();
    expect(document.bones.find((b) => b.name === name)?.x).toBe(50);

    applyRig(start);
    expect(document.bones.some((b) => b.name === name)).toBe(false);

    applyRig(mid);
    expect(document.bones.find((b) => b.name === name)?.x).toBe(50);

    applyRig(start);
  });

  it("pushRigCommand undoes and redoes, and ignores identical snapshots", () => {
    history.clear();
    const before = snapshotRig();
    const name = addBone("root", 0, 0)!;
    pushRigCommand(before, snapshotRig());
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(document.bones.some((b) => b.name === name)).toBe(false);

    history.redo();
    expect(document.bones.some((b) => b.name === name)).toBe(true);

    const same = snapshotRig();
    pushRigCommand(same, snapshotRig());
    history.undo(); // the add, not a no-op
    expect(document.bones.some((b) => b.name === name)).toBe(false);

    history.clear();
    applyRig(before);
  });

  it("keeps slots and binds created after the snapshot", () => {
    const saved = snapshotRig();
    const name = addBone("root", 10, 20)!;
    moveBone(name, 50, 60);
    const before = snapshotRig();
    moveBone(name, 70, 80);
    document.slots.push({ name: "later", layerId: 999, bone: "root", order: 99 });
    document.binds.push({ slot: "later", bones: ["x"] });
    applyRig(before);
    expect(document.bones.find((b) => b.name === name)?.x).toBe(50);
    expect(document.slots.some((s) => s.name === "later")).toBe(true);
    expect(document.binds.some((b) => b.slot === "later")).toBe(true);
    document.slots = document.slots.filter((s) => s.name !== "later");
    document.binds = document.binds.filter((b) => b.slot !== "later");
    applyRig(saved);
  });

  it("clears selectedBone when applyRig drops that bone", () => {
    const savedSel = ui.selectedBone;
    const before = snapshotRig();
    const name = addBone("root", 0, 0)!;
    ui.selectedBone = name;
    applyRig(before);
    expect(ui.selectedBone).toBe(null);
    ui.selectedBone = savedSel;
  });
});

function dummyLayer(id: number): Layer {
  return {
    id,
    name: `L${id}`,
    visible: true,
    opacity: 1,
    canvas: {} as HTMLCanvasElement,
    revision: 0,
  };
}

describe("insertJoint", () => {
  it("shortens the parent, adds a child covering the rest, and rehangs former children", () => {
    const saved = snapshotRig();
    const upper = addBone("root", 0, 0)!;
    setBoneLength(upper, 100);
    setBoneRotation(upper, 0);
    const hand = addBone(upper, 100, 0)!;
    setBoneLength(hand, 40);
    const mid = insertJoint(upper, 40, 0);
    expect(mid).toBeTruthy();
    const u = document.bones.find((b) => b.name === upper)!;
    const m = document.bones.find((b) => b.name === mid)!;
    const h = document.bones.find((b) => b.name === hand)!;
    expect(u.length).toBeCloseTo(40, 5);
    expect(m.x).toBeCloseTo(40, 5);
    expect(m.length).toBeCloseTo(60, 5);
    expect(m.parent).toBe(upper);
    expect(h.parent).toBe(mid);
    applyRig(saved);
  });

  it("returns null near an end so we do not invent a stub", () => {
    const saved = snapshotRig();
    const upper = addBone("root", 0, 0)!;
    setBoneLength(upper, 100);
    expect(insertJoint(upper, 2, 0)).toBeNull();
    applyRig(saved);
  });
});

describe("setSlotBone", () => {
  it("points the slot at a real bone and ignores a missing name", () => {
    const saved = snapshotRig();
    const arm = addBone("root", 0, 0)!;
    document.slots.push({ name: "hang", layerId: 1, bone: "root", order: 0 });
    setSlotBone("hang", arm);
    expect(document.slots.find((s) => s.name === "hang")?.bone).toBe(arm);
    setSlotBone("hang", "nope");
    expect(document.slots.find((s) => s.name === "hang")?.bone).toBe(arm);
    document.slots = document.slots.filter((s) => s.name !== "hang");
    applyRig(saved);
  });
});

describe("duplicateLayer", () => {
  it("returns null for a missing layer", () => {
    expect(duplicateLayer(-1)).toBeNull();
  });
});

describe("reorderLayer", () => {
  it("undo keeps a layer added after the reorder", () => {
    history.clear();
    const savedLayers = document.layers;
    document.layers = [dummyLayer(1), dummyLayer(2)];
    reorderLayer(1, 1);
    document.layers.push(dummyLayer(3));
    history.undo();
    expect(document.layers.map((l) => l.id)).toEqual([1, 2, 3]);
    document.layers = savedLayers;
    history.clear();
  });
});
