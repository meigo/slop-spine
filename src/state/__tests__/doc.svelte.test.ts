import { describe, it, expect } from "vitest";
import { snapshotRig, applyRig, pushRigCommand, addBone, moveBone, setBoneLength, document } from "../doc.svelte";
import { history } from "../history.svelte";

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
});
