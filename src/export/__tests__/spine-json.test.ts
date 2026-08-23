import { describe, it, expect } from "vitest";
import { toSkeletonSpace, boneWorld, toBoneLocal, writeSkeleton } from "../spine-json";
import type { Bone } from "../../rig/document";

const bones: Bone[] = [
  { name: "root", parent: null, x: 1024, y: 1024, rotation: 0, length: 0, wobble: 0 },
  { name: "body", parent: "root", x: 1024, y: 1524, rotation: -90, length: 400, wobble: 0 },
];

describe("coordinate conversion", () => {
  it("maps canvas centre to the skeleton origin", () => {
    expect(toSkeletonSpace({ width: 2048, height: 2048 }, 1024, 1024)).toEqual({ x: 0, y: 0 });
  });

  it("flips y", () => {
    expect(toSkeletonSpace({ width: 2048, height: 2048 }, 1024, 1524)).toEqual({ x: 0, y: -500 });
  });

  it("round-trips a point through a rotated bone's local space", () => {
    const w = boneWorld({ width: 2048, height: 2048 }, bones[1]);
    const p = { x: 137, y: -412 };
    const local = toBoneLocal(w, p);
    const rad = (w.rotation * Math.PI) / 180;
    const back = {
      x: w.x + local.x * Math.cos(rad) - local.y * Math.sin(rad),
      y: w.y + local.x * Math.sin(rad) + local.y * Math.cos(rad),
    };
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });
});

describe("relative bone transform (non-degenerate parent rotation)", () => {
  // "arm" is the parent (canvas rotation -90 -> world rotation 90), "hand" is its child, offset
  // and rotated in canvas space. The root->arm parent is irrelevant here; we only assert the
  // arm->hand relative transform, which is the case the original fixture's rotation-0 parent
  // could not distinguish from a bug that used world-space deltas or swapped toBoneLocal's args.
  const rotBones: Bone[] = [
    { name: "root", parent: null, x: 1024, y: 1024, rotation: 0, length: 0, wobble: 0 },
    { name: "arm", parent: "root", x: 1024, y: 1524, rotation: -90, length: 200, wobble: 0 },
    { name: "hand", parent: "arm", x: 1124, y: 1424, rotation: 30, length: 50, wobble: 0 },
  ];
  const input = {
    doc: {
      canvas: { width: 2048, height: 2048 },
      layers: [],
      slots: [],
      bones: rotBones,
      binds: [],
      density: 48,
    },
    meshes: {},
    weights: {},
    regions: [],
    page: { width: 2048, height: 256 },
  };

  it("expresses the child's emitted x,y,rotation in the parent's rotated frame, not world space", () => {
    const s = writeSkeleton(input) as any;
    const hand = s.bones.find((b: { name: string }) => b.name === "hand");
    // Hand derivation (see task-6-report.md for the full arithmetic):
    // arm world  = { x: 0,   y: -500, rotation: 90 }
    // hand world = { x: 100, y: -400, rotation: -30 }
    // local = R(-90deg) * (100 - 0, -400 - (-500)) = R(-90deg) * (100, 100) = (100, -100)
    // rotation = -30 - 90 = -120
    expect(hand.x).toBeCloseTo(100, 6);
    expect(hand.y).toBeCloseTo(-100, 6);
    expect(hand.rotation).toBeCloseTo(-120, 6);
  });
});

describe("writeSkeleton", () => {
  const input = {
    doc: {
      canvas: { width: 2048, height: 2048 },
      layers: [],
      slots: [{ name: "body", layerId: 1, bone: "body", order: 0 }],
      bones,
      binds: [{ slot: "body", bones: ["body"] }],
      density: 48,
    },
    meshes: { body: { vertices: [{ x: 1000, y: 1400 }, { x: 1100, y: 1400 }, { x: 1050, y: 1300 }], triangles: [[0, 1, 2] as [number, number, number]], hull: 3 } },
    weights: { body: [[{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }]] },
    regions: [{ name: "body", trim: { x: 1000, y: 1300, width: 101, height: 101 }, pageX: 2, pageY: 2 }],
    page: { width: 2048, height: 256 },
  };

  it("emits 4.2 with the expected top-level shape", () => {
    const s = writeSkeleton(input) as any;
    expect(s.skeleton.spine).toBe("4.2");
    expect(s.bones.map((b: { name: string }) => b.name)).toEqual(["root", "body"]);
    // `as any` above is deliberate: the return value is a file format, not an API, so it has no
    // declared interface. Tests live under src/ and `npm run build` typechecks them.
    expect(s.slots[0]).toEqual({ name: "body", bone: "body", attachment: "body" });
  });

  it("emits a weighted mesh: boneCount then (index,x,y,weight) per influence", () => {
    const s = writeSkeleton(input) as any;
    const mesh = s.skins[0].attachments.body.body;
    expect(mesh.type).toBe("mesh");
    expect(mesh.hull).toBe(3);
    // 3 vertices, 1 influence each => 3 * (1 + 4) = 15 entries
    expect(mesh.vertices.length).toBe(15);
    expect(mesh.vertices[0]).toBe(1);
    expect(mesh.uvs.length).toBe(6);
    for (const uv of mesh.uvs) { expect(uv).toBeGreaterThanOrEqual(0); expect(uv).toBeLessThanOrEqual(1); }
    // Exact uv for vertex 0, hand-derived from the fixture's canvas (see report): Spine mesh uvs
    // are normalized against the ORIGINAL untrimmed canvas, y-down — not the trimmed region and
    // not the atlas page (the runtime's own AtlasAttachmentLoader remaps region-local uvs into the
    // packed atlas using the .atlas file's offsets/bounds; doing that remapping here as well would
    // double-apply it). Vertex (1000,1400) on a 2048x2048 canvas gives uv = (1000/2048, 1400/2048).
    // Asserted exactly (not toBeCloseTo): the denominator is a power of two, so the division is
    // exact in double precision. This would catch a v-flip (e.g. using canvas.height - v.y), which
    // `toBeGreaterThanOrEqual(0)`/`toBeLessThanOrEqual(1)` alone cannot.
    expect(mesh.uvs[0]).toBe(1000 / 2048);
    expect(mesh.uvs[1]).toBe(1400 / 2048);
  });

  it("emits physics only for bones with wobble", () => {
    const s = writeSkeleton(input) as any;
    expect(s.physics ?? []).toEqual([]);
  });

  it("exports null attachment for hidden layers, normal attachment for visible ones", () => {
    const inputWithLayers = {
      doc: {
        canvas: { width: 2048, height: 2048 },
        layers: [
          { id: 1, name: "body_layer", visible: true, opacity: 1, canvas: {} as any, revision: 0 },
          { id: 2, name: "hidden_layer", visible: false, opacity: 1, canvas: {} as any, revision: 0 },
        ],
        slots: [
          { name: "body", layerId: 1, bone: "body", order: 0 },
          { name: "hidden", layerId: 2, bone: "body", order: 1 },
        ],
        bones,
        binds: [
          { slot: "body", bones: ["body"] },
          { slot: "hidden", bones: ["body"] },
        ],
        density: 48,
      },
      meshes: {
        body: { vertices: [{ x: 1000, y: 1400 }, { x: 1100, y: 1400 }, { x: 1050, y: 1300 }], triangles: [[0, 1, 2] as [number, number, number]], hull: 3 },
        hidden: { vertices: [{ x: 1000, y: 1400 }, { x: 1100, y: 1400 }, { x: 1050, y: 1300 }], triangles: [[0, 1, 2] as [number, number, number]], hull: 3 },
      },
      weights: {
        body: [[{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }]],
        hidden: [[{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }]],
      },
      regions: [
        { name: "body", trim: { x: 1000, y: 1300, width: 101, height: 101 }, pageX: 2, pageY: 2 },
        { name: "hidden", trim: { x: 1000, y: 1300, width: 101, height: 101 }, pageX: 2, pageY: 2 },
      ],
      page: { width: 2048, height: 256 },
    };
    const s = writeSkeleton(inputWithLayers) as any;
    const visibleSlot = s.slots.find((sl: { name: string }) => sl.name === "body");
    const hiddenSlot = s.slots.find((sl: { name: string }) => sl.name === "hidden");
    expect(visibleSlot).toEqual({ name: "body", bone: "body", attachment: "body" });
    expect(hiddenSlot.attachment).toBe(null);
  });
});

describe("physics", () => {
  // Two bones with non-zero wobble in a parent/child relationship. "root" keeps wobble 0 (it
  // always does in every fixture in this plan), so physics should contain exactly "upper" and
  // "lower", in that order.
  const wobbleBones: Bone[] = [
    { name: "root", parent: null, x: 1024, y: 1024, rotation: 0, length: 0, wobble: 0 },
    { name: "upper", parent: "root", x: 1024, y: 1400, rotation: -90, length: 200, wobble: 0.4 },
    { name: "lower", parent: "upper", x: 1024, y: 1600, rotation: 0, length: 150, wobble: 0.8 },
  ];
  const input = {
    doc: {
      canvas: { width: 2048, height: 2048 },
      layers: [],
      slots: [],
      bones: wobbleBones,
      binds: [],
      density: 48,
    },
    meshes: {},
    weights: {},
    regions: [],
    page: { width: 2048, height: 256 },
  };

  it("includes only the wobbling bones, with inertia scaled from wobble and parent-before-child order", () => {
    const s = writeSkeleton(input) as any;
    expect(s.physics).toEqual([
      { name: "upper", order: 0, bone: "upper", rotate: 1, inertia: 0.2, damping: 0.85 },
      { name: "lower", order: 1, bone: "lower", rotate: 1, inertia: 0.4, damping: 0.85 },
    ]);
  });
});
