import type { RigDocument, Layer, Slot } from "../rig/document";

function makeLayer(
  id: number,
  name: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  draw(ctx);
  return { id, name, visible: true, opacity: 1, canvas, revision: 0 };
}

/** A three-layer stick figure built in code, no drawing UI needed. */
export function buildFixture(): RigDocument {
  const width = 2048;
  const height = 2048;

  const body = makeLayer(1, "body", width, height, (ctx) => {
    ctx.beginPath();
    ctx.roundRect(950, 900, 1100 - 950, 1500 - 900, 40);
    ctx.fill();
  });
  const head = makeLayer(2, "head", width, height, (ctx) => {
    ctx.beginPath();
    ctx.arc(1024, 800, 180, 0, Math.PI * 2);
    ctx.fill();
  });
  const arm = makeLayer(3, "arm", width, height, (ctx) => {
    ctx.fillRect(1100, 950, 1400 - 1100, 1030 - 950);
  });

  const doc: RigDocument = {
    canvas: { width, height },
    layers: [body, head, arm],
    slots: [],
    bones: [
      {
        name: "root",
        parent: null,
        x: width / 2,
        y: height / 2,
        rotation: 0,
        length: 0,
        wobble: 0,
      },
      {
        name: "body",
        parent: "root",
        x: 1024,
        y: 1500,
        rotation: -90,
        length: 600,
        wobble: 0,
        reach: 600,
      },
      {
        name: "head",
        parent: "root",
        x: 1024,
        y: 900,
        rotation: -90,
        length: 300,
        wobble: 0.3,
        reach: 300,
      },
      {
        name: "arm",
        parent: "root",
        x: 1100,
        y: 990,
        rotation: 0,
        length: 300,
        wobble: 0.6,
        reach: 200,
      },
    ],
    binds: [],
    density: 48,
  };

  const slots: Slot[] = [
    { name: "body", layerId: body.id, bone: "body", order: 0 },
    { name: "head", layerId: head.id, bone: "head", order: 1 },
    { name: "arm", layerId: arm.id, bone: "arm", order: 2 },
  ];
  doc.slots = slots;
  doc.binds = slots.map((slot) => ({ slot: slot.name, bones: [] }));

  return doc;
}
