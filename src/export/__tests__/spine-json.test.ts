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
  });

  it("emits physics only for bones with wobble", () => {
    const s = writeSkeleton(input) as any;
    expect(s.physics ?? []).toEqual([]);
  });
});
