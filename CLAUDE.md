# slop-spine

Draw a simple character, rig a few bones, export Spine 4.2 for programmatic animation. See
`README.md` for what it does and `docs/superpowers/` for build logs, plans and specs.

Its drawing engine (`src/core/`: brushes, fill, selection, input, history, touch gestures,
viewport) was copied from slop-paint (`../slop-paint`) around 2026-09-26, so fixes made there
usually apply here too.

## Port from slop-paint

Queued 2026-09-29, from an audit made by READING this code against slop-paint's commits (the app
was not run): nothing from slop-paint after 2026-09-27 is here. Commit ids are slop-paint's
(`git -C ../slop-paint show <id>`); its `CLAUDE.md` describes each feature as it now works.
slop-animator carries the same list in its `CLAUDE.md` ("Port from slop-paint").

### Bugs here now — fix first

1. **A finger can extend or end a Pencil stroke.** `src/core/input.ts:125` (`onPointerMove`) and
   `onPointerUp` don't check `pointerId`, so a resting finger's moves add points and its lift ends
   the stroke. Also no `lostpointercapture` listener (`:198-201`), and the lift point takes
   `pointerup`'s pressure, which a pen reports as 0 (`:175`). slop-paint: `e61dc5a`, `c242e3e`.
2. **Pencil TIP double-tap still toggles the eraser** (`src/lib/Canvas.svelte:1507`, detection in
   `input.ts:21-27,172-186`) beside the one-finger double-tap (`:1494`); both taps draw dots first,
   a blob at large sizes. slop-paint `907b20b` removed the tip version. Delete it.
3. **Save and Export do nothing in the iPad Home Screen app**, and download in the browser
   (`src/lib/Toolbar.svelte:148-176`): iOS can't download from a standalone web app. Port
   slop-paint's `share.ts` (`saveToFilesAvailable`, `isStandalone`, `canShareFile`, `shareFile`),
   `download.ts` and `lib/ShareReadyDialog.svelte` (`af06e1d`, and the Save to Files commits before
   it): on iPad, exports and (in the Home Screen app) Save go to the share sheet. Also
   `downloadBlob` here revokes its URL at once; slop-paint waits 60 s, as an immediate revoke can
   kill a large download on iPad.

### Worth porting

- **Stream and Smooth** (`0ad830e`, `c13ed06`, `7bd3b8e`, `b158081`, `0a38872`, `699d772`,
  `9180de3`, `2b7f465`): Stream here is the old per-event average (`input.ts:48-53,131-146`),
  which weakens as the pointer rate rises; Smooth still feeds perfect-freehand's `smoothing`
  (`core/brush.ts:78,137`), which is only outline spacing. slop-paint: a screen-space rope with a
  Hermite catch-up on pause and lift, points stamped with the pen's time (`trailTimeAt`), and
  Smooth averaging the path, with optional Sharp corners (`stroke-smoothing.ts`, `input.ts`,
  `brush.ts`). Settings in `state/ui.svelte.ts:22-46,302`; wiring at `Canvas.svelte:1501`. Keep
  `2b7f465`'s rule (a move that adds no point doesn't call `onStroke`), or undo leaves the first dot
- **Bridge for the bucket** (`ccd6bd1`): the Bridge slider (`ui.fillGap`, `Toolbar.svelte:885-911`)
  reaches only Fill enclosed. slop-paint's `fillMask` / `growWithin` (`src/fill.ts`, tested) let
  one setting close line breaks for the bucket too. Its traps: grow back in 8-connected steps (a
  round dilation leaves inside corners unfilled), and refuse a diagonal step between two wall pixels
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
  doesn't wait for the pen, there's no save on tab hide, and a failure only reaches the console.
  The zip save is mostly async, so hitches rather than one long freeze
- **Clipboard paste** (`f388495`, `b5e837b`): errors are generic (`Canvas.svelte:1133-1135`), and a
  clipboard item with no `image/*` type says "No image found". slop-paint gives the browser's
  reason, lists what the clipboard holds, and fetches an image copied only as its address
  (`imageUrlFromClipboard` in `paste.ts`)
- **Shortcuts after touching a slider** (`c7d3e8a`; read, not tested): `Canvas.svelte:598-599`
  ignores keys while any `<input>` has focus, and a slider keeps focus after a drag. Copy
  slop-paint's `lib/text-entry.ts` `isTextEntry`
- **Open picker on iPad Safari** (`313496d`): `accept=".psd"` / `".zip"` only
  (`Toolbar.svelte:327-328`) can grey the files out; add the MIME types
- **Select the whole text on focus** (`085d9af`, `lib/select-on-focus.ts`): layer rename
  (`LayerPanel.svelte:251`), New doc width/height (`NewDocDialog.svelte:61,72`), bone name
  (`Inspector.svelte:151`)
- **iPad keyboard scroll reset** (`e019115`): snap the page back to 0 on `focusout`,
  visual-viewport resize and window `scroll` (see `../CLAUDE.md` on Chrome for iPad)
- **Undo memory** (`610d67d`, low priority): strokes store only their rect
  (`draw-dispatch.ts:392-400`), but fill, selection commit and Clear store the whole layer
  (`:348,363`, `Canvas.svelte:928,1177`, `doc.svelte.ts:168`). slop-paint keeps only the changed
  64-px tiles (`changedTiles` / `cropPixels`)
- **Touch gestures**, when syncing the file: `core/touch-gestures.ts:~107` resets `gestureDidMove`
  on every finger-down, so a finger joining a moved pan can read as a tap (slop-paint `e61dc5a`)

### Doesn't apply

Blend modes, groups and Ctrl+G, text layers and fonts, reference layers, Outline, the mesh density
stepper, Spine tag chips: slop-spine has none of them. The undo minifier bug (an exported `let`
reassigned by a setter): not present. The `persist/db.ts` open promise: already fixed here. Save /
Save as to a real file in Chrome and Edge (`89f810f`): optional, as the project is a zip.
