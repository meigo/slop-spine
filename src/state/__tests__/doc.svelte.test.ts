import { describe, it, expect } from "vitest";
import { addBone, setBoneLength, document } from "../doc.svelte";

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
