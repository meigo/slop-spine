# Family look and paint parity — design

Date: 2026-09-26. Reference app: slop-paint (slop-animator has converged on the same look).

## Intent

slop-spine should look and behave like a slop-family app, and get the painting features from
slop-paint that help draw a character to rig. It stays "not a general drawing app": no layer
groups, reference layers, PSD export, Outline tool, or selection flip.

Decided with the user:

- Approach: restyle spine's own components to paint's spec; copy only small shared pieces and the
  pure brush engines. No wholesale copy of paint's Toolbar/LayerPanel, no shared package.
- Selection actions move from the floating bar into toolbar row 2, as paint.
- Paint scope: brush parity, draw behind + alpha lock, eyedropper + nib cursor.

## Part A — visual alignment

1. **Tokens** (`app.css`): paint's dark-only `@theme` (surface `#1e1e22`, accent `#5b8cff`,
   `warn`, `surface-raised`), `.ui-on` / `.ui-selected`, paint's range slider (4px track, fill via
   `lib/slider-fill.ts`), focus ring in the accent. The `.dark` class and the light tokens go.
   `.paper-checker` / `.paper-white` stay (they are the artwork's page, not chrome).
   `.color-well` and `.curve-popup` go with the controls that used them.
2. **Toolbar row 1** (48px, `px-4`): 36px tool buttons with 20px icons, `.ui-on` for the active
   one, in spine's families — Brush, Eraser, Fill, Eyedropper │ Select, Lasso │ Rig. Then the
   drawings/bones/meshes toggles (kept on the bar; restored there on purpose in `ed1b0a3`),
   Undo/Redo (`aria-disabled`, reason in the title), zoom readout, and the menus:
   - **File**: New…, Open… `Ctrl+O`, Save `Ctrl+S` │ Import PSD…, Paste image as layer │ Export Spine…
   - **Edit** (new): Undo, Redo │ Cut, Copy, Paste, Delete │ Select all, Deselect │ Clear layer
   - **View**: Fit to view `0`, Actual size `1` │ drawings / bones / meshes │ White page / Checkerboard
   No Document menu: spine has no project name or canvas resize.
3. **Toolbar row 2** (min 40px, wraps, `gap-x-3`): options for the active tool, paint's control
   sizes (28px controls, `w-16` sliders with readouts). Colour is one swatch opening paint's
   24-swatch palette + native picker (`lib/ColorSwatch.svelte`). Select/Lasso carry every
   selection action: Copy, Cut, Paste, Delete, Deselect, Select all │ Free transform, Distort,
   Mesh │ while warping: −, N×N, +, FFD/Rigid, Reset pins │ Apply, Cancel. Buttons that can't act
   are dimmed with the reason (`aria-disabled`, never `disabled`). Any other tool shows paint's
   amber Deselect chip while a marquee exists. Bone keeps its mode radio and Delete/Dissolve.
   `SelectionActions.svelte` and `core/selection-anchor.ts` are deleted.
4. **Layer panel**: 40px header ("Layers" + add/duplicate/clear/delete); a props strip for the
   selected layer (Blend icon + opacity slider + value, rename pencil); one-line rows — grip, 20px
   thumbnail, name, then fixed 20px columns for alpha lock and eye; `.ui-selected` for the current
   row; rename on double-click and double-tap. The dock and the Inspector stay; the Inspector is
   restyled with the tokens only.
5. **Status bar** (new, 28px, bottom): left shows `ui.statusMessage` (from `flashStatus`), else
   `ui.statusHint` (the `title` under the pointer, also on touch via capture-phase pointerdown);
   right shows the tool name. Every `alert()` becomes a `flashStatus`. The New dialog's
   `window.confirm` becomes a warn line inside the dialog.

## Part B — painting

1. **Engines**: copy paint's `brush.ts`, `ink-brush.ts` (full-redraw, pooling),
   `calligraphy-brush.ts`, `stamp-brush.ts` into `src/core/`, with their tests. `pressure-curve.ts`
   keeps spine's version minus the singleton, with paint's accent colour.
2. **Settings**: six brush types in a `<select>`. Brush and eraser each keep type, size (1–80,
   step 0.5), opacity, smoothing, stream and Press (`ui.stroke.brush` / `ui.stroke.eraser`,
   `slotFor(tool)`), and their own pressure curve. Size presets `1 2 3 5 8 12 20 40 80`. The gear
   popover holds Smooth + Taper (Smooth), Stream, Nib angle/flatness (Calligraphy), Pool (Ink) and
   the curve editor for the active tool. Fill gets its own opacity. Old preferences migrate: the
   old type/size/opacity seed both slots, `eraserPress` the eraser's Press, the one curve both
   curves.
3. **Dispatch** (`draw-dispatch.ts`): smooth / ink / calligraphy redraw the whole stroke from the
   scratch copy each frame; stamps draw incrementally. Streamline goes through `setupInput`'s
   option (brush/eraser only).
4. **Draw behind**: toggle on row 2, brush only (`destination-over`).
5. **Alpha lock**: `Layer.alphaLock?: boolean`, saved in the project zip and autosave, toggled in
   the layer row. Brushes use `source-atop`; the bucket composites `source-atop` with expand 0;
   Fill enclosed refuses with a status message.
6. **Eyedropper** (`I`): samples the drawings composite (bones and meshes never), shows a preview
   swatch above-left of the pen while dragging, picks on release into the brush or fill colour
   (whichever tool was active) and returns to that tool. Transparent pixels pick nothing.
7. **Nib cursor**: for brush/eraser on mouse/pen hover, the nominal width at the current zoom,
   the flattened, rotated nib for Calligraphy, dashed for the eraser, plus a centre dot. Hidden
   while panning, drawing, or when the layer can't be edited.

## Testing

Pure logic gets tests: the copied engines' tests, `slotFor`/preference migration, `sliderFill`,
the alpha-lock project round-trip. UI is verified by `npm run check`, `npm run build` and a manual
pass (not by default in Chrome; see memory).
