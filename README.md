# slop-spine

A **very limited** browser app for one job: draw a simple character, put a handful of bones on it, and export a **Spine 4.2** skeleton for **programmatic animation** — a runtime that sets bone transforms from code each frame, not a timeline of keys. Side view, ~10 bones, optional physics wobble.

**It is not a general Spine editor, not a general drawing app, and not an animation tool.** There is no timeline, no IK, no skins, no constraints beyond a cheap wobble preview, no professional mesh editing. Meshes and weights are **derived** from the silhouette and the bones, not stored per vertex — so you can redraw a limb without repairing a rig. That is the whole point. If you need Spine's actual editor, use Spine.

**▶ Try it: [slop-spine.meigo.workers.dev](https://slop-spine.meigo.workers.dev)** — iPad + Apple Pencil works; mouse/desktop too.

Built with Svelte 5, TypeScript, Vite, Tailwind 4. Export is `skeleton.spinejson` + atlas + PNG, loadable by `spine-pixi-v8`.

## What it does

- Draw and rig in one document (brush / eraser / fill / eyedropper, layers, bones)
- slop-paint's brushes: Smooth, Ink (with pooling), Calligraphy, Dry brush (bristle stripes broken
  where the paint runs out, with Dryness and Taper), Pencil (grades 4H–8B), Charcoal (textures
  Rough–Dense), Airbrush; brush and eraser each keep their own size, opacity, Press and pressure
  curve; draw behind; per-layer alpha lock
- Stream trails the line behind the pen on a string (small wobbles never reach it; it catches up
  at a pause and on lift); Smooth averages the Smooth brush's path with no lag, optionally keeping
  sharp corners where you pause
- The slop family look (dark, File / Edit / View menus, tool-options row, status bar) shared with
  slop-paint and slop-animator
- PSD import (flattened pixel layers) and zip project save/load
- File ▸ Resize…: Crop / extend the canvas around an anchor (the drawing and bones keep their size
  and place), or Scale drawing (with Keep ratio always on: bones, reach and mesh density scale with
  it). The Spine export's origin stays at the canvas centre
- Select / transform / warp on pixels
- Pose preview with rotation wobble (optional translation)
- Derived mesh + Euclidean weights, reach capsules, per-layer bone excludes
- Spine 4.2 export for programmatic animation (runtime pokes bones; no baked clips)
- On iPad, Export goes to the share sheet (Save to Files), and so does Save in the Home Screen
  app, where iOS can't download

## What it does not do

- Edit or round-trip a Spine project from the official editor
- Animate on a timeline — motion is supposed to happen in your code
- Guarantee a “correct” deformation — “good enough that it doesn't tear” is the bar

## Development

```bash
npm install
npm run dev
npm test
npm run test:ipad   # the app in WebKit at iPad size with touch (first: npx playwright install webkit)
npm run check
npm run build
npm run deploy   # Cloudflare Workers static assets
```

## License

MIT. See [LICENSE](LICENSE).
