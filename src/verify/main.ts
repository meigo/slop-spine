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
  const report = {
    bones: data.bones.length,
    slots: data.slots.length,
    bounds: { x: b.x, y: b.y, w: b.width, h: b.height },
  };
  console.log("[verify]", JSON.stringify(report));
  (window as unknown as { __verify: unknown }).__verify = report;
}

main().catch((err) => {
  console.log("[verify] FAILED", err);
});
