import { unzipSync, strFromU8 } from "fflate";
import { buildFixture } from "../export/fixture";
import { exportBundle } from "../export/bundle";
import { restore } from "../persist/autosave";
import type { RigDocument } from "../rig/document";

// Narrow shims for the CDN globals — just the surface this page touches.
interface PixiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PixiApplication {
  init(opts: { background?: number; resizeTo?: unknown }): Promise<void>;
  canvas: HTMLCanvasElement;
  screen: { width: number; height: number };
  stage: { addChild(child: unknown): void };
}
interface PixiNS {
  Application: new () => PixiApplication;
  Texture: { from(source: unknown): { source: unknown } };
}
interface SpineAtlasPage {
  setTexture(t: unknown): void;
}
interface SpineTextureAtlas {
  pages: SpineAtlasPage[];
}
interface SpineSkeletonData {
  bones: unknown[];
  slots: unknown[];
}
interface SpineFigure {
  scale: { set(v: number): void };
  x: number;
  y: number;
  update(dt: number): void;
  getBounds(): PixiBounds;
}
interface SpineNS {
  TextureAtlas: new (text: string) => SpineTextureAtlas;
  SpineTexture: { from(source: unknown): unknown };
  AtlasAttachmentLoader: new (atlas: SpineTextureAtlas) => unknown;
  SkeletonJson: new (loader: unknown) => { readSkeletonData(json: string): SpineSkeletonData };
  Spine: new (data: SpineSkeletonData) => SpineFigure;
}

const { PIXI, spine } = window as unknown as { PIXI: PixiNS; spine: SpineNS };

/** Default is the code-built fixture; `?source=autosave` restores the autosaved document from
 *  IndexedDB instead and runs it through the identical export chain — one verification path,
 *  not two, so this page always renders exactly the bytes `exportBundle` produced. */
async function loadDoc(): Promise<RigDocument> {
  const source = new URLSearchParams(location.search).get("source");
  if (source === "autosave") {
    const doc = await restore();
    if (!doc) throw new Error("no autosave found");
    return doc;
  }
  return buildFixture();
}

/** Decodes the exported atlas PNG and counts alpha values. Informational only (see
 *  `findFullCanvasRegions` for the actual transparency guard) — corner alpha and a 100%-opaque
 *  atlas are both unreachable as failure signals once padding gutters exist between packed
 *  regions (packAtlas always starts placement at PAD,PAD), so these counts are reported for
 *  visibility but never used as the alarm. */
function analyzeAlpha(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const actx = c.getContext("2d")!;
  actx.drawImage(img, 0, 0);
  const { data } = actx.getImageData(0, 0, c.width, c.height);
  const alpha = { transparent: 0, opaque: 0, partial: 0, cornerAlpha: data[3] };
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a === 0) alpha.transparent++;
    else if (a === 255) alpha.opaque++;
    else alpha.partial++;
  }
  return alpha;
}

/** The real transparency guard. A layer with a baked-in background is opaque everywhere, so
 *  `trimLayer` (export/trim.ts) returns the *entire* canvas as that layer's trim rect — packed
 *  into the atlas verbatim by `packAtlas` (export/atlas.ts) as that region's `bounds:` width and
 *  height. Ordinary art can't produce this: a trim only reaches the full canvas when every one of
 *  its four edges has an opaque pixel, which is exactly the broken case the spec warns about
 *  ("would trim to the full 2048x2048 page and destroy the atlas").
 *
 *  Reads `bounds:x,y,w,h` out of the already-fetched `skeleton.atlas` text (rather than changing
 *  `exportBundle`'s return shape) and compares each region's w,h against `doc.canvas` — not
 *  against the atlas's own `offsets:` line, whose trailing two fields are the same canvas
 *  dimensions duplicated on every region. `doc` is already in scope in `main`, so reading it
 *  directly is one fewer per-region parse than pulling the identical numbers back out of the
 *  atlas text a second time. */
function findFullCanvasRegions(atlasText: string, canvasW: number, canvasH: number): string[] {
  const lines = atlasText.split("\n");
  const names: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^bounds:\d+,\d+,(\d+),(\d+)$/);
    if (m && Number(m[1]) === canvasW && Number(m[2]) === canvasH) {
      names.push(lines[i - 1]); // packAtlas always writes the region name on the line before bounds:
    }
  }
  return names;
}

async function main() {
  const doc = await loadDoc();
  const bundle = await exportBundle(doc);
  const zip = unzipSync(new Uint8Array(await bundle.arrayBuffer()));

  const atlasText = strFromU8(zip["skeleton.atlas"]);
  const skeletonText = strFromU8(zip["skeleton.spinejson"]);
  const pngUrl = URL.createObjectURL(new Blob([zip["skeleton.png"]], { type: "image/png" }));

  const img = new Image();
  img.src = pngUrl;
  await img.decode();

  const alpha = analyzeAlpha(img);

  const app = new PIXI.Application();
  await app.init({ background: 0xffffff, resizeTo: window });
  document.body.appendChild(app.canvas);

  const texture = PIXI.Texture.from(img);
  const atlas = new spine.TextureAtlas(atlasText);
  atlas.pages[0].setTexture(spine.SpineTexture.from(texture.source));

  const attachmentLoader = new spine.AtlasAttachmentLoader(atlas);
  const skeletonJson = new spine.SkeletonJson(attachmentLoader);
  const data = skeletonJson.readSkeletonData(skeletonText);

  const fig = new spine.Spine(data);
  fig.scale.set(0.35);
  fig.x = app.screen.width / 2;
  fig.y = app.screen.height / 2;
  app.stage.addChild(fig);
  fig.update(0);

  const b = fig.getBounds();
  const fullCanvasRegions = findFullCanvasRegions(atlasText, doc.canvas.width, doc.canvas.height);
  const report = {
    bones: data.bones.length,
    slots: data.slots.length,
    bounds: { x: b.x, y: b.y, w: b.width, h: b.height },
    alpha,
    fullCanvasRegions,
  };
  console.log("[verify]", JSON.stringify(report));
  (window as unknown as { __verify: unknown }).__verify = report;
  if (fullCanvasRegions.length > 0) {
    console.log("[verify] ALPHA FAIL", JSON.stringify(fullCanvasRegions));
  }
}

main().catch((err) => {
  console.log("[verify] FAILED", err);
});
