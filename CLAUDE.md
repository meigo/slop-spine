# slop-spine

Draw a simple character, rig a few bones, export Spine 4.2 for programmatic animation. See
`README.md` for what it does and `docs/superpowers/` for build logs, plans and specs.

Its drawing engine (`src/core/`: brushes, fill, selection, input, history, touch gestures,
viewport) was copied from slop-paint (`../slop-paint`) around 2026-09-26, so fixes made there
usually apply here too.

## Testing

- `npm test` — vitest, the pure modules.
- `npm run test:ipad` — iPad smoke check (`tools/ipad-smoke.mjs`, Playwright, ported from
  slop-paint 2026-10-01): the app in WebKit at iPad Pro 11 with touch, in a fresh PERSISTENT temp
  profile (ephemeral WebKit refuses Blobs in IndexedDB, so every autosave failed). Starts its own
  dev server; `npm run test:ipad -- <url>` checks a URL. ~20 checks: first layer, pen stroke, undo/redo
  and two-finger-tap undo, fingers, Ctrl+Z and Clear layer during a pen stroke, Undo with a lifted selection, a typed bone name kept on a click or Pencil tap on another bone, a failing autosave said in the status bar, a long frozen Ink and Calligraphy stroke (same pixels as a full redraw, one Undo), the Dry brush against Smooth, Watercolour (rim, self-crossing, glaze), Pencil and Charcoal stamps, Pencil grades and Charcoal textures, the Blend tool (smudges, one Undo, its own size; its time against the brush's is printed), bucket, the fill's Soft edge (in the fill gear), Distort and Mesh warp applied unmoved leave no seams, eraser (and its Opacity), pinch, Export refused with no bones, Create two bones,
  Pose bends the drawing, Export Spine (the zip is unzipped: bones, mesh, atlas, PNG), Resize (Crop / extend and Scale drawing, the rig follows), add layer,
  double-tap rename, a hidden layer refuses the pen and Clear layer, Duplicate with a lifted
  selection, the layer-row finger drag (ghost, gap,
  reorder), Save, Open, autosave across a reload, portrait layout, no page errors. Pen strokes and
  multi-finger gestures are dispatched pointer events (`[sim]`); taps are Playwright's real
  touchscreen. Screenshots in `test-results/ipad/` (gitignored, cleared each run). First run per
  machine: `npx playwright install webkit`. In the sandbox the dev server needs local port binding.
  It is desktop WebKit, not iPadOS: the real Pencil, the share sheet, the keyboard and memory limits
  stay owed on the device. Run it after UI or input changes. The hidden-layer, Clear, Duplicate and layer-drag
  checks were seen to FAIL with the behaviour broken on purpose, and the Blend check.

## Workflow

As slop-paint and slop-vector-editor: branch off `main` (`fix/…`, `feat/…`, `chore/…`, `docs/…`),
one commit per task with a conventional subject (`fix:`, `feat:`, `chore:`, `docs:`), and merge
into `main` with `--no-ff` ("Merge <what>") only when the user says so. Keep README.md current
with every user-visible change.

## Port from slop-paint

Queued 2026-09-29, from an audit made by READING this code against slop-paint's commits (the app
was not run): nothing from slop-paint after 2026-09-27 is here. Commit ids are slop-paint's
(`git -C ../slop-paint show <id>`); its `CLAUDE.md` describes each feature as it now works.
slop-animator carries the same list in its `CLAUDE.md` ("Port from slop-paint").

### Worth porting

- **More from slop-paint's code review** (added 2026-09-30, slop-paint `1c8b5fd`): (a) done
  2026-10-21 with slop-paint's second review (below). Check too (these depend on each app's own code): (b) a structural undo step pushed when nothing changed (merge with nothing below, deleting the last layer) wipes redo — slop-paint skips it (`sameStructure`) and says why; (c) deleted/merged layers kept alive by undo but not counted in the memory budget (`detachedLayerBytes`); (d) opening a project that fails partway should leave the open document untouched (build aside, swap at the end); (e) Space-to-pan re-activates the last clicked button in Chrome unless Space's default is claimed; (f) done 2026-10-21 (`blurTextEntry`, with `isTextEntry`, which also ended the slider-keeps-shortcuts-dead item, `c7d3e8a`).
- **Autosave copies and a blank-layers guard** (`2c53625`, added 2026-09-30): on iPad a
  backgrounded 40-layer slop-paint document came back with every layer listed and EMPTY (iOS
  reclaimed the page's image memory), and the next autosave would have replaced the only copy.
  Here autosave is one `autosave` slot too (`persist/autosave.ts`). slop-paint now keeps up to 3
  checkpoints at least 5 min apart plus a kept copy, listed in File ▸ Restore autosave…
  (`persist/autosave.ts`, pure `persist/autosave-plan.ts`, `lib/RestoreDialog.svelte`); before each
  autosave and on return from the background it checks which layers have pixels (a 256-px probe
  per layer) against the last save, and more layers emptied than undo steps since pauses autosave
  and offers the restore. It also shows the layers' memory in the Document menu, warning on iPad
  above 600 MB
- **Lifted selection drawn inside its layer** (`f15dbf6`): the float here is drawn on the overlay,
  above every layer and ignoring its layer's opacity (`core/selection.ts:~893`); the compositor
  (`Canvas.svelte:286-306`) never sees it. Draw layer + float in the layer's slot; the overlay keeps
  the handles. At Apply/Cancel, drop the preview BEFORE redrawing (slop-paint drew it twice for a
  frame)
- **Float on a layer switch** (`847f7ee`): Apply/Cancel already act on the float's own layer
  (`selLayerId`, `Canvas.svelte:908,1171-1206`), but picking another layer leaves the float and its
  handles open over it. slop-paint applies it on the switch, with a status message (Apply is
  undoable, Cancel isn't)
- **Autosave** (`4064b59`): the 2 s debounce here (`persist/autosave.ts:6-20`, `App.svelte:123-128`)
  doesn't wait for the pen and there's no save on tab hide (a failure is said in the status bar since
  2026-10-21).
  The zip save is mostly async, so hitches rather than one long freeze
- **Clipboard paste** (`f388495`, `b5e837b`): errors are generic (`Canvas.svelte:1133-1135`), and a
  clipboard item with no `image/*` type says "No image found". slop-paint gives the browser's
  reason, lists what the clipboard holds, and fetches an image copied only as its address
  (`imageUrlFromClipboard` in `paste.ts`)
- **Open picker on iPad Safari** (`313496d`): `accept=".psd"` / `".zip"` only
  (`Toolbar.svelte:358-359`) can grey the files out; add the MIME types
- **Select the whole text on focus** (`085d9af`, `lib/select-on-focus.ts`): layer rename
  (`LayerPanel.svelte:251`), New doc width/height (`NewDocDialog.svelte:61,72`), bone name
  (`Inspector.svelte:151`)
- **iPad keyboard scroll reset** (`e019115`): snap the page back to 0 on `focusout`,
  visual-viewport resize and window `scroll` (see `../CLAUDE.md` on Chrome for iPad)
- **Undo memory** (`610d67d`, low priority): strokes store only their rect
  (`draw-dispatch.ts:391-399`), but fill, selection commit and Clear store the whole layer
  (`:347,362`, `Canvas.svelte:928,1177`, `doc.svelte.ts:168`). slop-paint keeps only the changed
  64-px tiles (`changedTiles` / `cropPixels`)
- **Not taken from slop-paint's second review** (`fix/code-review`, 2026-10-17..21, ported here
  2026-10-21 on `fix/paint-code-review`): `e24e250`'s open half (`readPsd` decodes the thumbnail and composite too: `skipCompositeImageData`
  would leave a file of only empty/ignored layers with none); `addLayer`
  pushes no undo step, so an image pasted as a layer can't be undone.
- **Layer tint** (`806daba`, offered 2026-10-26, not taken for now): a layer drawn in one flat
  colour, pixels untouched. Here the Spine export reads the pixels, so it would need baking into a
  copy at export and a field in the project zip; Spine's slot colour multiplies, so it is only the
  same on white/grey art.
- **Blend tool on a GPU layer** (ported 2026-10-26 from `db26300`, `7c8e8e1`, `7449d2a`): its
  engine reads the layer under every dab (`getImageData`). slop-paint's layers are CPU canvases
  (`willReadFrequently`); these aren't (`createLayer` in `doc.svelte.ts`). In desktop WebKit a
  60-point stroke took ~1.2 s against the brush's ~0.5 s (test:ipad prints both). Not measured on
  an iPad; if it lags there, try `willReadFrequently` on the layers (it changes how every layer is
  drawn, so measure the compositor too).

### Doesn't apply

Blend modes, groups and Ctrl+G, text layers and fonts, reference layers, Outline, the mesh density
stepper, Spine tag chips: slop-spine has none of them. The undo minifier bug (an exported `let`
reassigned by a setter): not present. The `persist/db.ts` open promise: already fixed here. Save /
Save as to a real file in Chrome and Edge (`89f810f`): optional, as the project is a zip.
